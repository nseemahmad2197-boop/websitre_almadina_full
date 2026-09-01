import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { appendOrderTrackingEvent, appendOrderTrackingNote, createSeedDatabase, createTrackingEvent, getDeliveryFee, getOrderDimensions, getOrderOversizeFee, getOrderTrackingEvents, getWeightFee, normalizeWeightOption, removeLegacyDemoData, resolveDeliveryRegion, uid, type CollectionInvoice, type Database, type Notice, type Order, type Preferences, type Recipient, type User } from "./data";

const SESSION_COOKIE = "almadina_session";
const PASSKEY_LOGIN_COOKIE = "almadina_passkey_login";
const SESSION_DURATION = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 100_000;
const APP_LOCK_CHALLENGE_DURATION = 5 * 60;
const APP_LOCK_MAX_FAILED_ATTEMPTS = 5;
const APP_LOCK_COOLDOWN = 5 * 60;
const PASSKEY_RATE_LIMIT_WINDOW = 5 * 60;
const PASSKEY_OPTIONS_RATE_LIMIT = 30;
const PASSKEY_VERIFY_RATE_LIMIT = 60;
const initializedDatabases = new WeakMap<D1Database, Promise<void>>();

type StateRow = { payload: string; revision: number };
type SessionRow = { user_id: string; expires_at: number };
type StoredState = { database: Database; revision: number };
type AuthenticatedSession = { account: User; state: StoredState; token: string };
type WebAuthnChallengeKind = "registration" | "authentication" | "login";
type AppLockRow = {
  user_id: string;
  pin_hash: string;
  enabled: number;
  biometric_enabled: number;
  failed_attempts: number;
  locked_until: number;
};
type WebAuthnCredentialRow = {
  credential_id: Base64URLString;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string;
  device_type: string;
  backed_up: number;
};
type WebAuthnChallengeRow = {
  challenge: string;
  origin: string;
  rp_id: string;
  expires_at: number;
};
type AppLockStatus = {
  enabled: boolean;
  biometricEnabled: boolean;
  biometricLoginReady: boolean;
};
type RateLimitRow = { request_count: number; reset_at: number };

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(payload, {
    status,
    headers: responseHeaders,
  });
}

function cookieHeaders(...cookies: string[]): Headers {
  const headers = new Headers();
  cookies.forEach((cookie) => headers.append("Set-Cookie", cookie));
  return headers;
}

function toHex(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[\da-f]+$/i.test(value) || value.length % 2) throw new Error("Invalid hexadecimal value.");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2:${PASSWORD_ITERATIONS}:${toHex(salt)}:${toHex(derived)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationValue, saltValue, expectedValue] = stored.split(":");
  if (algorithm !== "pbkdf2" || !iterationValue || !saltValue || !expectedValue) return false;

  const iterations = Number(iterationValue);
  if (!Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > 1_000_000) return false;

  try {
    const salt = fromHex(saltValue);
    const expected = fromHex(expectedValue);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expected.length * 8));
    if (actual.length !== expected.length) return false;

    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
    return difference === 0;
  } catch {
    return false;
  }
}

async function initializeDatabase(database: D1Database): Promise<void> {
  await database.batch([
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_state (
      id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      revision INTEGER DEFAULT 0 NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_sessions_user_id_idx ON almadina_sessions (user_id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_app_locks (
      user_id TEXT PRIMARY KEY NOT NULL,
      pin_hash TEXT NOT NULL,
      enabled INTEGER DEFAULT 1 NOT NULL,
      biometric_enabled INTEGER DEFAULT 0 NOT NULL,
      failed_attempts INTEGER DEFAULT 0 NOT NULL,
      locked_until INTEGER DEFAULT 0 NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_webauthn_credentials (
      credential_id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER DEFAULT 0 NOT NULL,
      transports TEXT NOT NULL,
      device_type TEXT NOT NULL,
      backed_up INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_webauthn_credentials_user_id_idx ON almadina_webauthn_credentials (user_id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_passkey_login_credentials (
      credential_id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_passkey_login_credentials_user_id_idx ON almadina_passkey_login_credentials (user_id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_webauthn_challenges (
      session_hash TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      challenge TEXT NOT NULL,
      origin TEXT NOT NULL,
      rp_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_hash, kind)
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_rate_limits (
      key_hash TEXT PRIMARY KEY NOT NULL,
      action TEXT NOT NULL,
      request_count INTEGER DEFAULT 0 NOT NULL,
      reset_at INTEGER NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_rate_limits_reset_at_idx ON almadina_rate_limits (reset_at)"),
  ]);

  const existing = await database.prepare("SELECT revision FROM almadina_state WHERE id = ?").bind("main").first<{ revision: number }>();
  if (existing) return;

  const initial = createSeedDatabase();
  initial.users = await Promise.all(initial.users.map(async (account) => ({ ...account, password: await hashPassword(account.password) })));
  await database.prepare("INSERT INTO almadina_state (id, payload, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
    .bind("main", JSON.stringify(initial), 0, new Date().toISOString()).run();
}

async function ensureDatabase(database: D1Database): Promise<void> {
  let initialization = initializedDatabases.get(database);
  if (!initialization) {
    initialization = initializeDatabase(database);
    initializedDatabases.set(database, initialization);
  }

  try {
    await initialization;
  } catch (error) {
    initializedDatabases.delete(database);
    throw error;
  }
}

async function readState(database: D1Database): Promise<StoredState> {
  const row = await database.prepare("SELECT payload, revision FROM almadina_state WHERE id = ?").bind("main").first<StateRow>();
  if (!row) throw new Error("The shared application state was not initialized.");
  return { database: removeLegacyDemoData(JSON.parse(row.payload) as Database), revision: row.revision };
}

async function saveState(database: D1Database, state: Database, revision: number): Promise<boolean> {
  const result = await database.prepare("UPDATE almadina_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .bind(JSON.stringify(removeLegacyDemoData(state)), new Date().toISOString(), "main", revision).run();
  return (result.meta?.changes ?? 0) === 1;
}

function getCookie(request: Request, cookieName: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === cookieName) return parts.join("=") || null;
  }
  return null;
}

function getSessionToken(request: Request): string | null {
  return getCookie(request, SESSION_COOKIE);
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_DURATION): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function passkeyLoginCookie(request: Request, token: string, maxAge = APP_LOCK_CHALLENGE_DURATION): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PASSKEY_LOGIN_COOKIE}=${token}; Path=/api/almadina; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function enforcePublicPasskeyRateLimit(database: D1Database, request: Request, action: "options" | "verify", limit: number): Promise<void> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  // Render sets the first X-Forwarded-For entry to the real client address.
  // A Cloudflare-specific address is trusted only when the runtime supplies the
  // non-header `request.cf` property, which an HTTP client cannot forge.
  const cloudflareAddress = "cf" in request ? request.headers.get("cf-connecting-ip")?.trim() : "";
  const clientAddress = (cloudflareAddress || forwarded.at(0) || "unknown").slice(0, 128).toLowerCase();
  const keyHash = await sha256(`passkey-login:${action}:${clientAddress}`);
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + PASSKEY_RATE_LIMIT_WINDOW;

  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();
  const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      action = excluded.action,
      request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
      reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
    RETURNING request_count, reset_at`)
    .bind(keyHash, `passkey-login-${action}`, resetAt, now, now).first<RateLimitRow>();
  if (!rate || rate.request_count > limit) throw new ApiRequestError("محاولات كثيرة. انتظر بضع دقائق ثم حاول مجددًا.", 429);
}

async function createSession(database: D1Database, userId: string): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;
  await database.prepare("INSERT INTO almadina_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, userId, expiresAt, new Date().toISOString()).run();
  return token;
}

async function authenticate(database: D1Database, request: Request): Promise<AuthenticatedSession | null> {
  const token = getSessionToken(request);
  if (!token) return null;

  const session = await database.prepare("SELECT user_id, expires_at FROM almadina_sessions WHERE token_hash = ?")
    .bind(await sha256(token)).first<SessionRow>();

  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) return null;

  const state = await readState(database);
  const account = state.database.users.find((user) => user.id === session.user_id);
  return account ? { account, state, token } : null;
}

function normalizePin(value: unknown): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return typeof value === "string"
    ? value.trim().replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    : "";
}

function parseTransports(value: string): AuthenticatorTransportFuture[] {
  const allowed = new Set<AuthenticatorTransportFuture>(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is AuthenticatorTransportFuture => typeof item === "string" && allowed.has(item as AuthenticatorTransportFuture)) : [];
  } catch {
    return [];
  }
}

async function readAppLock(database: D1Database, userId: string): Promise<AppLockRow | null> {
  return database.prepare("SELECT user_id, pin_hash, enabled, biometric_enabled, failed_attempts, locked_until FROM almadina_app_locks WHERE user_id = ?")
    .bind(userId).first<AppLockRow>();
}

async function readWebAuthnCredentials(database: D1Database, userId: string): Promise<WebAuthnCredentialRow[]> {
  const result = await database.prepare("SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM almadina_webauthn_credentials WHERE user_id = ?")
    .bind(userId).all<WebAuthnCredentialRow>();
  return result.results ?? [];
}

async function appLockStatus(database: D1Database, userId: string): Promise<AppLockStatus> {
  const lock = await readAppLock(database, userId);
  if (!lock || lock.enabled !== 1) return { enabled: false, biometricEnabled: false, biometricLoginReady: false };
  const credential = await database.prepare("SELECT credential_id FROM almadina_webauthn_credentials WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ credential_id: string }>();
  const loginCredential = await database.prepare("SELECT credential_id FROM almadina_passkey_login_credentials WHERE user_id = ? LIMIT 1")
    .bind(userId).first<{ credential_id: string }>();
  return {
    enabled: true,
    biometricEnabled: lock.biometric_enabled === 1 && Boolean(credential),
    biometricLoginReady: lock.biometric_enabled === 1 && Boolean(loginCredential),
  };
}

async function requireValidAppLockPin(database: D1Database, userId: string, submittedPin: unknown): Promise<AppLockRow> {
  const pin = normalizePin(submittedPin);
  if (!/^\d{4}$/.test(pin)) throw new ApiRequestError("أدخل رمز القفل المكوّن من 4 أرقام.", 400);

  const lock = await readAppLock(database, userId);
  if (!lock || lock.enabled !== 1) throw new ApiRequestError("قفل التطبيق غير مفعّل لهذا الحساب.", 409);

  const now = Math.floor(Date.now() / 1000);
  if (lock.locked_until > now) {
    const remainingMinutes = Math.max(1, Math.ceil((lock.locked_until - now) / 60));
    throw new ApiRequestError(`تم إيقاف المحاولات مؤقتًا. حاول بعد ${remainingMinutes} دقيقة.`, 429);
  }

  if (!await verifyPassword(pin, lock.pin_hash)) {
    const failedAttempts = lock.failed_attempts + 1;
    const lockedUntil = failedAttempts >= APP_LOCK_MAX_FAILED_ATTEMPTS ? now + APP_LOCK_COOLDOWN : 0;
    await database.prepare("UPDATE almadina_app_locks SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE user_id = ?")
      .bind(lockedUntil ? 0 : failedAttempts, lockedUntil, new Date().toISOString(), userId).run();
    if (lockedUntil) throw new ApiRequestError("تم إيقاف المحاولات لمدة 5 دقائق لحماية حسابك.", 429);
    throw new ApiRequestError(`رمز القفل غير صحيح. تبقّت ${APP_LOCK_MAX_FAILED_ATTEMPTS - failedAttempts} محاولات.`, 403);
  }

  if (lock.failed_attempts || lock.locked_until) {
    await database.prepare("UPDATE almadina_app_locks SET failed_attempts = 0, locked_until = 0, updated_at = ? WHERE user_id = ?")
      .bind(new Date().toISOString(), userId).run();
  }
  return lock;
}

async function createAppLock(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const payload = await request.json() as { pin?: unknown };
  const pin = normalizePin(payload.pin);
  if (!/^\d{4}$/.test(pin)) return json({ error: "أدخل رمز قفل جديدًا من 4 أرقام." }, 400);
  const existing = await readAppLock(database, session.account.id);
  if (existing?.enabled === 1) return json({ error: "قفل التطبيق مفعّل بالفعل. أوقفه أولًا إذا أردت تعيين رمز جديد." }, 409);

  const now = new Date().toISOString();
  const pinHash = await hashPassword(pin);
  await database.prepare(`INSERT INTO almadina_app_locks (user_id, pin_hash, enabled, biometric_enabled, failed_attempts, locked_until, updated_at)
    VALUES (?, ?, 1, 0, 0, 0, ?)
    ON CONFLICT (user_id) DO UPDATE SET pin_hash = excluded.pin_hash, enabled = 1, biometric_enabled = 0, failed_attempts = 0, locked_until = 0, updated_at = excluded.updated_at`)
    .bind(session.account.id, pinHash, now).run();
  await database.prepare("DELETE FROM almadina_webauthn_credentials WHERE user_id = ?").bind(session.account.id).run();
  await database.prepare("DELETE FROM almadina_passkey_login_credentials WHERE user_id = ?").bind(session.account.id).run();
  await database.prepare("DELETE FROM almadina_webauthn_challenges WHERE user_id = ?").bind(session.account.id).run();
  return json(await appLockStatus(database, session.account.id));
}

async function verifyAppLockPinRequest(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const payload = await request.json() as { pin?: unknown };
  await requireValidAppLockPin(database, session.account.id, payload.pin);
  return json({ verified: true });
}

async function disableAppLock(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const payload = await request.json() as { pin?: unknown };
  await requireValidAppLockPin(database, session.account.id, payload.pin);
  await database.batch([
    database.prepare("DELETE FROM almadina_webauthn_credentials WHERE user_id = ?").bind(session.account.id),
    database.prepare("DELETE FROM almadina_passkey_login_credentials WHERE user_id = ?").bind(session.account.id),
    database.prepare("DELETE FROM almadina_webauthn_challenges WHERE user_id = ?").bind(session.account.id),
    database.prepare("DELETE FROM almadina_app_locks WHERE user_id = ?").bind(session.account.id),
  ]);
  return json({ enabled: false, biometricEnabled: false, biometricLoginReady: false });
}

function webAuthnContext(request: Request): { origin: string; rpID: string } {
  const url = new URL(request.url);
  return { origin: url.origin, rpID: url.hostname };
}

async function rememberStoredWebAuthnChallenge(database: D1Database, sessionHash: string, userId: string, kind: WebAuthnChallengeKind, challenge: string, origin: string, rpID: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await database.prepare("DELETE FROM almadina_webauthn_challenges WHERE expires_at <= ?").bind(now).run();
  await database.prepare(`INSERT INTO almadina_webauthn_challenges (session_hash, user_id, kind, challenge, origin, rp_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_hash, kind) DO UPDATE SET user_id = excluded.user_id, challenge = excluded.challenge, origin = excluded.origin, rp_id = excluded.rp_id, expires_at = excluded.expires_at, created_at = excluded.created_at`)
    .bind(sessionHash, userId, kind, challenge, origin, rpID, now + APP_LOCK_CHALLENGE_DURATION, new Date().toISOString()).run();
}

async function consumeStoredWebAuthnChallenge(database: D1Database, sessionHash: string, userId: string, kind: WebAuthnChallengeKind): Promise<WebAuthnChallengeRow> {
  const challenge = await database.prepare(`DELETE FROM almadina_webauthn_challenges
    WHERE session_hash = ? AND user_id = ? AND kind = ?
    RETURNING challenge, origin, rp_id, expires_at`)
    .bind(sessionHash, userId, kind).first<WebAuthnChallengeRow>();
  if (!challenge || challenge.expires_at <= Math.floor(Date.now() / 1000)) throw new ApiRequestError("انتهت صلاحية طلب حماية الجهاز. حاول مجددًا.", 400);
  return challenge;
}

async function rememberWebAuthnChallenge(database: D1Database, session: AuthenticatedSession, kind: "registration" | "authentication", challenge: string, origin: string, rpID: string): Promise<void> {
  await rememberStoredWebAuthnChallenge(database, await sha256(session.token), session.account.id, kind, challenge, origin, rpID);
}

async function consumeWebAuthnChallenge(database: D1Database, session: AuthenticatedSession, kind: "registration" | "authentication"): Promise<WebAuthnChallengeRow> {
  return consumeStoredWebAuthnChallenge(database, await sha256(session.token), session.account.id, kind);
}

async function webAuthnRegistrationOptions(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const payload = await request.json() as { pin?: unknown };
  const lock = await readAppLock(database, session.account.id);
  if (!lock || lock.enabled !== 1) return json({ error: "فعّل قفل التطبيق وحدد رمزًا قبل تفعيل البصمة." }, 409);
  await requireValidAppLockPin(database, session.account.id, payload.pin);
  const credentials = await readWebAuthnCredentials(database, session.account.id);
  const { origin, rpID } = webAuthnContext(request);
  const options = await generateRegistrationOptions({
    rpName: "Almadina Express",
    rpID,
    userName: session.account.email,
    userDisplayName: session.account.name,
    userID: new TextEncoder().encode(session.account.id),
    timeout: 60_000,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({ id: credential.credential_id, transports: parseTransports(credential.transports) })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
  });
  await rememberWebAuthnChallenge(database, session, "registration", options.challenge, origin, rpID);
  return json(options);
}

async function verifyWebAuthnRegistration(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const response = await request.json() as RegistrationResponseJSON;
  if (!response || typeof response.id !== "string") return json({ error: "استجابة حماية الجهاز غير صالحة." }, 400);
  const challenge = await consumeWebAuthnChallenge(database, session, "registration");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rp_id,
    requireUserVerification: true,
  });
  if (!verification.verified) return json({ error: "لم يتم التحقق من حماية الجهاز." }, 400);

  const owner = await database.prepare("SELECT user_id FROM almadina_webauthn_credentials WHERE credential_id = ?")
    .bind(verification.registrationInfo.credential.id).first<{ user_id: string }>();
  if (owner && owner.user_id !== session.account.id) return json({ error: "حماية هذا الجهاز مرتبطة بحساب آخر." }, 409);

  const credential = verification.registrationInfo.credential;
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO almadina_webauthn_credentials (credential_id, user_id, public_key, counter, transports, device_type, backed_up, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (credential_id) DO UPDATE SET public_key = excluded.public_key, counter = excluded.counter, transports = excluded.transports, device_type = excluded.device_type, backed_up = excluded.backed_up, updated_at = excluded.updated_at`)
      .bind(
        credential.id,
        session.account.id,
        toHex(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        verification.registrationInfo.credentialDeviceType,
        verification.registrationInfo.credentialBackedUp ? 1 : 0,
        now,
        now,
      ),
    database.prepare(`INSERT INTO almadina_passkey_login_credentials (credential_id, user_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT (credential_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at`)
      .bind(credential.id, session.account.id, now),
    database.prepare("UPDATE almadina_app_locks SET biometric_enabled = 1, updated_at = ? WHERE user_id = ?")
      .bind(now, session.account.id),
  ]);
  return json(await appLockStatus(database, session.account.id));
}

async function webAuthnAuthenticationOptions(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const lock = await readAppLock(database, session.account.id);
  const credentials = await readWebAuthnCredentials(database, session.account.id);
  if (!lock || lock.enabled !== 1 || lock.biometric_enabled !== 1 || !credentials.length) {
    return json({ error: "الدخول بالبصمة غير مفعّل لهذا الحساب على هذا الجهاز." }, 409);
  }
  const { origin, rpID } = webAuthnContext(request);
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({ id: credential.credential_id, transports: parseTransports(credential.transports) })),
  });
  await rememberWebAuthnChallenge(database, session, "authentication", options.challenge, origin, rpID);
  return json(options);
}

async function verifyWebAuthnAuthentication(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const response = await request.json() as AuthenticationResponseJSON;
  if (!response || typeof response.id !== "string") return json({ error: "استجابة حماية الجهاز غير صالحة." }, 400);
  const challenge = await consumeWebAuthnChallenge(database, session, "authentication");
  const credential = await database.prepare("SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM almadina_webauthn_credentials WHERE credential_id = ? AND user_id = ?")
    .bind(response.id, session.account.id).first<WebAuthnCredentialRow>();
  if (!credential) return json({ error: "لم نعثر على حماية الجهاز المسجلة لهذا الحساب." }, 404);

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: challenge.origin,
    expectedRPID: challenge.rp_id,
    credential: {
      id: credential.credential_id,
      publicKey: fromHex(credential.public_key),
      counter: credential.counter,
      transports: parseTransports(credential.transports),
    },
    requireUserVerification: true,
  });
  if (!verification.verified) return json({ error: "لم يتم التحقق من حماية الجهاز." }, 403);
  await database.prepare("UPDATE almadina_webauthn_credentials SET counter = ?, updated_at = ? WHERE credential_id = ? AND user_id = ?")
    .bind(verification.authenticationInfo.newCounter, new Date().toISOString(), credential.credential_id, session.account.id).run();
  return json({ verified: true });
}

async function disableWebAuthn(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const payload = await request.json() as { pin?: unknown };
  await requireValidAppLockPin(database, session.account.id, payload.pin);
  await database.batch([
    database.prepare("DELETE FROM almadina_webauthn_credentials WHERE user_id = ?").bind(session.account.id),
    database.prepare("DELETE FROM almadina_passkey_login_credentials WHERE user_id = ?").bind(session.account.id),
    database.prepare("DELETE FROM almadina_webauthn_challenges WHERE user_id = ?").bind(session.account.id),
    database.prepare("UPDATE almadina_app_locks SET biometric_enabled = 0, updated_at = ? WHERE user_id = ?").bind(new Date().toISOString(), session.account.id),
  ]);
  return json(await appLockStatus(database, session.account.id));
}

async function publicPasskeyLoginOptions(database: D1Database, request: Request): Promise<Response> {
  await enforcePublicPasskeyRateLimit(database, request, "options", PASSKEY_OPTIONS_RATE_LIMIT);
  const { origin, rpID } = webAuthnContext(request);
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 60_000,
    userVerification: "required",
    allowCredentials: [],
  });
  const ceremonyToken = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await rememberStoredWebAuthnChallenge(database, await sha256(ceremonyToken), "", "login", options.challenge, origin, rpID);
  return json(options, 200, { "Set-Cookie": passkeyLoginCookie(request, ceremonyToken) });
}

async function verifyPublicPasskeyLogin(database: D1Database, request: Request): Promise<Response> {
  await enforcePublicPasskeyRateLimit(database, request, "verify", PASSKEY_VERIFY_RATE_LIMIT);
  const genericMessage = "تعذّر تسجيل الدخول بحماية الجهاز. استخدم كلمة المرور أو أعد ربط البصمة من الإعدادات.";
  const clearCeremonyCookie = { "Set-Cookie": passkeyLoginCookie(request, "", 0) };
  const ceremonyToken = getCookie(request, PASSKEY_LOGIN_COOKIE);

  try {
    const response = await request.json() as AuthenticationResponseJSON;
    if (!ceremonyToken || !response || typeof response.id !== "string") return json({ error: genericMessage }, 401, clearCeremonyCookie);

    const challenge = await consumeStoredWebAuthnChallenge(database, await sha256(ceremonyToken), "", "login");
    const credential = await database.prepare(`SELECT credentials.credential_id, credentials.user_id, credentials.public_key, credentials.counter,
      credentials.transports, credentials.device_type, credentials.backed_up
      FROM almadina_webauthn_credentials AS credentials
      INNER JOIN almadina_passkey_login_credentials AS login_credentials ON login_credentials.credential_id = credentials.credential_id
      WHERE credentials.credential_id = ?`)
      .bind(response.id).first<WebAuthnCredentialRow>();
    if (!credential) return json({ error: genericMessage }, 401, clearCeremonyCookie);

    const lock = await readAppLock(database, credential.user_id);
    const state = await readState(database);
    const account = state.database.users.find((entry) => entry.id === credential.user_id);
    if (!account || !lock || lock.enabled !== 1 || lock.biometric_enabled !== 1) {
      return json({ error: genericMessage }, 401, clearCeremonyCookie);
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.origin,
      expectedRPID: challenge.rp_id,
      credential: {
        id: credential.credential_id,
        publicKey: fromHex(credential.public_key),
        counter: credential.counter,
        transports: parseTransports(credential.transports),
      },
      requireUserVerification: true,
    });
    if (!verification.verified) return json({ error: genericMessage }, 401, clearCeremonyCookie);

    await database.prepare("UPDATE almadina_webauthn_credentials SET counter = ?, updated_at = ? WHERE credential_id = ? AND user_id = ?")
      .bind(verification.authenticationInfo.newCounter, new Date().toISOString(), credential.credential_id, credential.user_id).run();
    const sessionToken = await createSession(database, credential.user_id);
    return json(snapshot(state, account), 200, cookieHeaders(
      sessionCookie(request, sessionToken),
      passkeyLoginCookie(request, "", 0),
    ));
  } catch (error) {
    if (!(error instanceof ApiRequestError)) console.warn("Public passkey login failed.", error);
    return json({ error: genericMessage }, 401, clearCeremonyCookie);
  }
}

function publicAccount(account: User): User {
  return { ...account, password: "" };
}

function orderWithoutCourierInstructions(order: Order, keepPrivateNotes: boolean): Order {
  const courierInstructions = order.notes?.trim() ?? "";
  const trackingEvents = courierInstructions && Array.isArray(order.trackingEvents)
    ? order.trackingEvents.map((event) => event.note?.trim() === courierInstructions
      ? { ...event, note: "تم إنشاء الطرد وهو قيد الإنشاء." }
      : event)
    : order.trackingEvents;

  return {
    ...order,
    notes: "",
    privateNotes: keepPrivateNotes ? order.privateNotes : "",
    trackingEvents,
  };
}

function orderForCourier(order: Order): Order {
  const courierInstructions = order.notes?.trim() ?? "";
  const trackingEvents = getOrderTrackingEvents(order)
    .filter((event) => event.kind !== "note")
    .map((event) => courierInstructions && event.note?.trim() === courierInstructions
      ? { ...event, note: "تم إنشاء الطرد وهو قيد الإنشاء." }
      : event);

  return { ...order, privateNotes: "", trackingEvents };
}

function scopeDatabase(database: Database, account: User): Database {
  if (account.role === "admin") {
    return {
      ...database,
      users: database.users.map(publicAccount),
      orders: database.orders.map((order) => orderWithoutCourierInstructions(order, true)),
    };
  }

  if (account.role === "courier") {
    return {
      users: [publicAccount(account)],
      orders: database.orders
        .filter((order) => !order.deleted && order.courierId === account.id)
        .map(orderForCourier),
      recipients: [],
      collections: [],
      notices: database.notices.filter((notice) => notice.userId === account.id),
      preferences: database.preferences[account.id] ? { [account.id]: database.preferences[account.id] } : {},
      nextOrder: database.nextOrder,
      nextCollection: database.nextCollection,
    };
  }

  return {
    users: [publicAccount(account)],
    orders: database.orders.filter((order) => order.merchantId === account.id).map((order) => orderWithoutCourierInstructions(order, false)),
    recipients: database.recipients.filter((recipient) => recipient.merchantId === account.id),
    collections: database.collections.filter((invoice) => invoice.merchantId === account.id),
    notices: database.notices.filter((notice) => notice.userId === account.id),
    preferences: database.preferences[account.id] ? { [account.id]: database.preferences[account.id] } : {},
    nextOrder: database.nextOrder,
    nextCollection: database.nextCollection,
  };
}

function snapshot(state: StoredState, account: User) {
  return { database: scopeDatabase(state.database, account), revision: state.revision, userId: account.id };
}

function isValidDatabase(value: unknown): value is Database {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Database>;
  return Array.isArray(candidate.users) && Array.isArray(candidate.orders) && Array.isArray(candidate.recipients)
    && Array.isArray(candidate.collections) && Array.isArray(candidate.notices)
    && !!candidate.preferences && typeof candidate.preferences === "object";
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function mergeAdminDatabase(current: Database, submitted: Database, account: User): Promise<Database> {
  const previous = new Map(current.users.map((entry) => [entry.id, entry]));
  const users: User[] = [];
  const emails = new Set<string>();

  for (const candidate of submitted.users) {
    const existing = previous.get(candidate.id);
    const email = candidate.email.trim().toLowerCase();
    const name = candidate.name.trim();
    const phone = candidate.phone.trim();
    const store = candidate.store.trim();
    if (!validEmail(email)) throw new ApiRequestError("البريد الإلكتروني غير صحيح.", 400);
    if (emails.has(email)) throw new ApiRequestError("البريد الإلكتروني مسجل لحساب آخر.", 409);
    if (!name || !store || !/^05\d{8}$/.test(phone)) throw new ApiRequestError("تحقق من الاسم والمتجر ورقم الجوال.", 400);
    emails.add(email);

    if (existing) {
      users.push({
        ...existing,
        name,
        email,
        phone,
        store,
        ...(existing.role === "merchant" ? { membership: candidate.membership === "premium" ? "premium" : "standard" } : {}),
      });
      continue;
    }

    if ((candidate.role !== "merchant" && candidate.role !== "courier") || candidate.password.length < 8) {
      throw new ApiRequestError("تعذّر إنشاء الحساب: تأكد من نوعه وكلمة المرور.", 400);
    }

    users.push({
      ...candidate,
      email,
      password: await hashPassword(candidate.password),
      ...(candidate.role === "merchant" ? { membership: candidate.membership === "premium" ? "premium" : "standard" } : {}),
    });
  }

  if (!users.some((entry) => entry.id === account.id && entry.role === "admin")) {
    throw new ApiRequestError("لا يمكن حذف حساب المسؤول الحالي.", 403);
  }

  const adminIds = new Set(current.users.filter((entry) => entry.role === "admin").map((entry) => entry.id));
  for (const administrator of current.users.filter((entry) => adminIds.has(entry.id))) {
    if (!users.some((entry) => entry.id === administrator.id)) users.push(administrator);
  }

  const accountsById = new Map(users.map((entry) => [entry.id, entry]));
  const existingOrders = new Map(current.orders.map((order) => [order.id, order]));
  const orders = submitted.orders.map((candidate) => {
    const existing = existingOrders.get(candidate.id);
    const merchant = accountsById.get(candidate.merchantId);
    const courier = candidate.courierId ? accountsById.get(candidate.courierId) : undefined;
    const protectedOrder = existing ? { ...candidate, notes: existing.notes, privateNotes: existing.privateNotes } : { ...candidate, notes: "", privateNotes: "" };
    return {
      ...protectedOrder,
      merchantName: merchant?.name ?? protectedOrder.merchantName,
      merchantStore: merchant?.store ?? protectedOrder.merchantStore,
      courierName: courier?.role === "courier" ? courier.name : protectedOrder.courierName,
    };
  });
  const collections = submitted.collections.map((invoice) => ({
    ...invoice,
    merchantName: accountsById.get(invoice.merchantId)?.name ?? invoice.merchantName,
  }));

  return removeLegacyDemoData({
    ...submitted,
    users,
    orders,
    collections,
    nextOrder: Math.max(current.nextOrder, submitted.nextOrder || current.nextOrder),
    nextCollection: Math.max(current.nextCollection, submitted.nextCollection || current.nextCollection),
  });
}

function mergeMerchantRecords<T extends { id: string; merchantId: string }>(current: T[], submitted: T[], userId: string, update: (candidate: T, existing?: T) => T): T[] {
  const others = current.filter((entry) => entry.merchantId !== userId);
  const existing = new Map(current.filter((entry) => entry.merchantId === userId).map((entry) => [entry.id, entry]));
  const mine = submitted.filter((entry) => entry.merchantId === userId).map((entry) => update(entry, existing.get(entry.id)));
  return [...mine, ...others];
}

function mergeMerchantTrackingNote(existing: Order, candidate: Order, account: User): Order {
  const savedEventIds = new Set(getOrderTrackingEvents(existing).map((event) => event.id));
  const requested = Array.isArray(candidate.trackingEvents)
    ? candidate.trackingEvents.find((event) => event?.kind === "note" && !savedEventIds.has(event.id))
    : undefined;
  const note = typeof requested?.note === "string" ? requested.note.trim().slice(0, 500) : "";
  return note ? appendOrderTrackingNote(existing, account.name, note) : existing;
}

function collectionVerificationCode(): string {
  const values = crypto.getRandomValues(new Uint16Array(1));
  return String(1000 + (values[0] % 9000));
}

function mergeMerchantCollections(current: CollectionInvoice[], submitted: CollectionInvoice[], orders: Order[], account: User, startingNumber: number) {
  const mine = current.filter((invoice) => invoice.merchantId === account.id);
  const others = current.filter((invoice) => invoice.merchantId !== account.id);
  const existing = new Map(mine.map((invoice) => [invoice.id, invoice]));
  const allExistingIds = new Set(current.map((invoice) => invoice.id));
  const usedOrderIds = new Set(current.flatMap((invoice) => invoice.orderIds));
  let nextCollection = startingNumber;

  for (const candidate of submitted.filter((invoice) => invoice.merchantId === account.id)) {
    const saved = existing.get(candidate.id);
    if (saved) {
      const canEditVerification = saved.status === "pending" || saved.status === "ready";
      const verificationCode = canEditVerification && /^\d{4}$/.test(candidate.verificationCode) ? candidate.verificationCode : saved.verificationCode;
      const authorizedRecipient = canEditVerification ? candidate.authorizedRecipient.trim().slice(0, 120) : saved.authorizedRecipient;
      const updated = { ...saved, verificationCode, authorizedRecipient, updatedAt: new Date().toISOString() };
      existing.set(saved.id, updated);
      continue;
    }

    if (allExistingIds.has(candidate.id) || !Array.isArray(candidate.orderIds)) throw new Error("بيانات فاتورة التحصيل غير صالحة.");
    const requestedOrderIds = new Set(candidate.orderIds.filter((id): id is string => typeof id === "string"));
    const eligible = orders.filter((order) => order.merchantId === account.id && !order.deleted && (order.status === "delivered" || order.status === "returned") && requestedOrderIds.has(order.id) && !usedOrderIds.has(order.id));
    if (!eligible.length) throw new Error("لا توجد طرود جديدة صالحة لفاتورة التحصيل.");

    const delivered = eligible.filter((order) => order.status === "delivered");
    const returned = eligible.filter((order) => order.status === "returned");
    const grossAmount = delivered.reduce((sum, order) => sum + order.amount, 0);
    const deliveryFees = delivered.reduce((sum, order) => sum + order.deliveryFee, 0);
    const returnFees = returned.reduce((sum, order) => sum + order.deliveryFee, 0);
    const now = new Date();
    const invoice: CollectionInvoice = {
      id: candidate.id || uid("collection"),
      merchantId: account.id,
      merchantName: account.name,
      invoiceNumber: `#${nextCollection++}`,
      orderIds: eligible.map((order) => order.id),
      grossAmount,
      deliveryFees,
      returnFees,
      netAmount: grossAmount - deliveryFees - returnFees,
      deliveredCount: delivered.length,
      returnedCount: returned.length,
      status: "pending",
      verificationCode: collectionVerificationCode(),
      authorizedRecipient: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      scheduledAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
    mine.push(invoice);
    existing.set(invoice.id, invoice);
    allExistingIds.add(invoice.id);
    invoice.orderIds.forEach((id) => usedOrderIds.add(id));
  }

  return { collections: [...mine.map((invoice) => existing.get(invoice.id) ?? invoice), ...others], nextCollection };
}

function mergeMerchantDatabase(current: Database, submitted: Database, account: User): Database {
  const savedAccount = account;

  let nextOrder = current.nextOrder;

  const orders = mergeMerchantRecords<Order>(current.orders, submitted.orders, account.id, (candidate, existing) => {
    if (existing) {
      const trackedOrder = mergeMerchantTrackingNote(existing, candidate, savedAccount);
      return {
        ...candidate,
        merchantId: account.id,
        merchantName: existing.merchantName,
        merchantStore: existing.merchantStore,
        trackingNumber: existing.trackingNumber,
        status: existing.status,
        courierName: existing.courierName,
        courierId: existing.courierId,
        shippedAt: existing.shippedAt,
        governorate: existing.governorate,
        dimensions: existing.dimensions,
        lengthCm: existing.lengthCm,
        widthCm: existing.widthCm,
        heightCm: existing.heightCm,
        weight: existing.weight,
        weightFee: existing.weightFee,
        oversizeFee: existing.oversizeFee,
        deliveryFee: existing.deliveryFee,
        notes: existing.notes,
        privateNotes: existing.privateNotes,
        trackingEvents: trackedOrder.trackingEvents,
        createdAt: existing.createdAt,
        updatedAt: trackedOrder.updatedAt,
      };
    }

    const now = new Date().toISOString();
    const [lengthCm, widthCm, heightCm] = getOrderDimensions(candidate);
    const weight = normalizeWeightOption(candidate.weight);
    const weightFee = getWeightFee(weight);
    const oversizeFee = getOrderOversizeFee(candidate);
    const region = resolveDeliveryRegion(candidate.governorate ?? "", candidate.city);
    if (!region) throw new ApiRequestError("تحقق من تطابق المحافظة والمدينة قبل حفظ الطرد.", 400);
    const deliveryFee = getDeliveryFee(region, savedAccount.membership) + weightFee + oversizeFee;
    const notes = typeof candidate.notes === "string" ? candidate.notes.trim().slice(0, 500) : "";
    const privateNotes = typeof candidate.privateNotes === "string" ? candidate.privateNotes.trim().slice(0, 1000) : "";
    return {
      ...candidate,
      merchantId: account.id,
      merchantName: savedAccount.name,
      merchantStore: savedAccount.store,
      trackingNumber: `ALX-${nextOrder++}`,
      governorate: candidate.governorate?.trim().slice(0, 120),
      lengthCm: lengthCm || undefined,
      widthCm: widthCm || undefined,
      heightCm: heightCm || undefined,
      weight,
      weightFee,
      dimensions: [lengthCm, widthCm, heightCm].some(Boolean) ? `${lengthCm} × ${widthCm} × ${heightCm} سم` : "غير محددة",
      oversizeFee,
      deliveryFee,
      notes,
      privateNotes,
      status: "draft",
      courierName: "بانتظار تعيين المندوب",
      courierId: undefined,
      shippedAt: undefined,
      trackingEvents: [createTrackingEvent("draft", savedAccount.name, {
        location: "مع المرسل",
        note: "تم إنشاء الطرد وهو قيد الإنشاء.",
        createdAt: now,
      })],
      createdAt: now,
      updatedAt: now,
    };
  });

  const recipients = mergeMerchantRecords<Recipient>(current.recipients, submitted.recipients, account.id, (candidate) => ({ ...candidate, merchantId: account.id }));
  const { collections, nextCollection } = mergeMerchantCollections(current.collections, submitted.collections, orders, savedAccount, current.nextCollection);

  const otherNotices = current.notices.filter((notice) => notice.userId !== account.id);
  const myNotices = submitted.notices.filter((notice) => notice.userId === account.id).map((notice): Notice => ({ ...notice, userId: account.id }));

  const preferences: Record<string, Preferences> = { ...current.preferences };
  if (submitted.preferences[account.id]) preferences[account.id] = submitted.preferences[account.id];
  else delete preferences[account.id];

  return removeLegacyDemoData({
    users: current.users.map((entry) => entry.id === account.id ? savedAccount : entry),
    orders,
    recipients,
    collections,
    notices: [...myNotices, ...otherNotices],
    preferences,
    nextOrder,
    nextCollection,
  });
}

function mergeCourierDatabase(current: Database, submitted: Database, account: User): Database {
  const savedAccount = account;

  const otherNotices = current.notices.filter((notice) => notice.userId !== account.id);
  const myNotices = submitted.notices
    .filter((notice) => notice.userId === account.id)
    .map((notice): Notice => ({ ...notice, userId: account.id }));
  const preferences: Record<string, Preferences> = { ...current.preferences };
  if (submitted.preferences[account.id]) preferences[account.id] = submitted.preferences[account.id];

  return removeLegacyDemoData({
    ...current,
    users: current.users.map((entry) => entry.id === account.id ? savedAccount : entry),
    notices: [...myNotices, ...otherNotices],
    preferences,
  });
}

async function broadcastNotice(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  if (session.account.role !== "admin") return json({ error: "هذه الميزة متاحة للمسؤول فقط." }, 403);

  const submitted = await request.json() as unknown;
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) return json({ error: "بيانات الإشعار غير صالحة." }, 400);
  const payload = submitted as Record<string, unknown>;
  const requestId = typeof payload.requestId === "string" ? payload.requestId.trim() : "";
  const audience = payload.audience;
  const recipientUserId = typeof payload.recipientUserId === "string" ? payload.recipientUserId.trim() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";

  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) return json({ error: "معرّف طلب الإشعار غير صالح." }, 400);
  if (audience !== "all" && audience !== "merchants" && audience !== "couriers" && audience !== "premium" && audience !== "standard" && audience !== "user") return json({ error: "فئة مستلمي الإشعار غير صالحة." }, 400);
  if (audience === "user" && !/^[a-zA-Z0-9_-]{1,120}$/.test(recipientUserId)) return json({ error: "اختر مستخدمًا صالحًا لاستلام الإشعار." }, 400);
  if (audience !== "user" && recipientUserId) return json({ error: "لا يمكن تحديد مستخدم مع فئة جماعية." }, 400);
  if (title.length < 3 || title.length > 80) return json({ error: "يجب أن يكون عنوان الإشعار بين 3 و80 حرفًا." }, 400);
  if (message.length < 5 || message.length > 500) return json({ error: "يجب أن تكون تفاصيل الإشعار بين 5 و500 حرف." }, 400);

  const createdAt = new Date().toISOString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readState(database);
    const administrator = state.database.users.find((account) => account.id === session.account.id);
    if (!administrator || administrator.role !== "admin") return json({ error: "لم يعد حساب المسؤول متاحًا." }, 403);

    const previousRequestNotices = state.database.notices.filter((notice) => notice.broadcastId === requestId);
    if (previousRequestNotices.some((notice) => notice.title !== title || notice.message !== message || notice.audience !== audience || (audience === "user" && notice.userId !== recipientUserId))) {
      return json({ error: "استُخدم معرّف هذا الإرسال سابقًا لمحتوى مختلف. أعد المحاولة.", ...snapshot(state, administrator) }, 409);
    }
    if (previousRequestNotices.length) {
      return json({ ...snapshot(state, administrator), recipientCount: previousRequestNotices.length });
    }

    const selectedRecipient = audience === "user"
      ? state.database.users.find((account) => account.id === recipientUserId && account.role !== "admin")
      : undefined;
    if (audience === "user" && !selectedRecipient) return json({ error: "المستخدم المحدد غير موجود أو لا يمكن إرسال إشعار إليه." }, 422);

    const recipients = selectedRecipient ? [selectedRecipient] : state.database.users.filter((account) => account.role !== "admin" && (
      audience === "all"
        || (audience === "merchants" && account.role === "merchant")
        || (audience === "couriers" && account.role === "courier")
        || (audience === "premium" && account.role === "merchant" && account.membership === "premium")
        || (audience === "standard" && account.role === "merchant" && account.membership !== "premium")
    ));
    if (!recipients.length) return json({ error: "لا توجد حسابات ضمن الفئة المحددة." }, 422);

    const notices = await Promise.all(recipients.map(async (account): Promise<Notice> => ({
      id: `notice-${(await sha256(`${requestId}:${account.id}`)).slice(0, 28)}`,
      userId: account.id,
      title,
      message,
      icon: "sparkles",
      read: false,
      createdAt,
      broadcastId: requestId,
      audience,
    })));
    const existingIds = new Set(state.database.notices.map((notice) => notice.id));
    const missingNotices = notices.filter((notice) => !existingIds.has(notice.id));

    if (!missingNotices.length) {
      return json({ ...snapshot(state, administrator), recipientCount: recipients.length });
    }

    const next: Database = { ...state.database, notices: [...missingNotices, ...state.database.notices] };
    if (await saveState(database, next, state.revision)) {
      return json({ ...snapshot({ database: next, revision: state.revision + 1 }, administrator), recipientCount: recipients.length });
    }
  }

  const latest = await readState(database);
  const administrator = latest.database.users.find((account) => account.id === session.account.id);
  return administrator
    ? json({ error: "تم تحديث البيانات من جهاز آخر. أعد إرسال الإشعار.", ...snapshot(latest, administrator) }, 409)
    : json({ error: "لم يعد حساب المسؤول متاحًا." }, 403);
}

async function clearNotices(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  const submitted = await request.json() as unknown;
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) return json({ error: "بيانات مسح الإشعارات غير صالحة." }, 400);
  const payload = submitted as Record<string, unknown>;
  if (!Array.isArray(payload.noticeIds) || payload.noticeIds.length > 5_000 || payload.noticeIds.some((id) => typeof id !== "string" || !id.trim() || id.trim().length > 160)) {
    return json({ error: "قائمة الإشعارات المطلوب مسحها غير صالحة." }, 400);
  }
  const noticeIds = new Set(payload.noticeIds.map((id) => (id as string).trim()));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readState(database);
    const account = state.database.users.find((entry) => entry.id === session.account.id);
    if (!account) return json({ error: "لم يعد الحساب متاحًا." }, 403);

    const notices = state.database.notices.filter((notice) => notice.userId !== account.id || !noticeIds.has(notice.id));
    const removedCount = state.database.notices.length - notices.length;
    if (!removedCount) return json({ ...snapshot(state, account), removedCount: 0 });

    const next: Database = { ...state.database, notices };
    if (await saveState(database, next, state.revision)) {
      return json({ ...snapshot({ database: next, revision: state.revision + 1 }, account), removedCount });
    }
  }

  const latest = await readState(database);
  const account = latest.database.users.find((entry) => entry.id === session.account.id);
  return account
    ? json({ error: "تم تحديث الإشعارات من جهاز آخر. أعد محاولة المسح.", ...snapshot(latest, account) }, 409)
    : json({ error: "لم يعد الحساب متاحًا." }, 403);
}

type AccountDeletionEligibility = {
  activeOrderCount: number;
  unsettledCollectionCount: number;
  unsettledOrderCount: number;
};

function accountDeletionEligibility(database: Database, account: User): AccountDeletionEligibility {
  const assignedOrders = database.orders.filter((order) => !order.deleted && (
    account.role === "merchant" ? order.merchantId === account.id : order.courierId === account.id
  ));
  const activeOrderCount = assignedOrders.filter((order) => order.status !== "delivered" && order.status !== "returned").length;

  if (account.role !== "merchant") {
    return { activeOrderCount, unsettledCollectionCount: 0, unsettledOrderCount: 0 };
  }

  const merchantCollections = database.collections.filter((invoice) => invoice.merchantId === account.id);
  const paidOrderIds = new Set(merchantCollections.filter((invoice) => invoice.status === "paid").flatMap((invoice) => invoice.orderIds));
  const unsettledCollectionCount = merchantCollections.filter((invoice) => invoice.status !== "paid").length;
  const unsettledOrderCount = assignedOrders.filter((order) => (
    (order.status === "delivered" || order.status === "returned") && !paidOrderIds.has(order.id)
  )).length;

  return { activeOrderCount, unsettledCollectionCount, unsettledOrderCount };
}

async function deleteOwnAccount(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  if (session.account.role === "admin") return json({ error: "لا يمكن حذف حساب المسؤول من داخل التطبيق." }, 403);

  const submitted = await request.json() as unknown;
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return json({ error: "بيانات تأكيد حذف الحساب غير صالحة." }, 400);
  }

  const payload = submitted as Record<string, unknown>;
  const password = typeof payload.password === "string" ? payload.password : "";
  const confirmation = typeof payload.confirmation === "string" ? payload.confirmation.trim() : "";
  if (confirmation !== "حذف حسابي") return json({ error: "اكتب عبارة «حذف حسابي» كما هي للتأكيد." }, 400);
  if (!password) return json({ error: "أدخل كلمة مرور الحساب للتأكيد." }, 400);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readState(database);
    const account = state.database.users.find((entry) => entry.id === session.account.id);
    if (!account) {
      return json({ error: "لم يعد الحساب متاحًا." }, 401, { "Set-Cookie": sessionCookie(request, "", 0) });
    }
    if (account.role === "admin") return json({ error: "لا يمكن حذف حساب المسؤول من داخل التطبيق." }, 403);
    if (!await verifyPassword(password, account.password)) return json({ error: "كلمة المرور غير صحيحة." }, 403);

    const eligibility = accountDeletionEligibility(state.database, account);
    if (eligibility.activeOrderCount || eligibility.unsettledCollectionCount || eligibility.unsettledOrderCount) {
      return json({
        error: "لا يمكن حذف الحساب قبل إكمال جميع الطرود والتحصيلات المالية.",
        ...eligibility,
      }, 409);
    }

    const isMerchant = account.role === "merchant";
    const next: Database = removeLegacyDemoData({
      ...state.database,
      users: state.database.users.filter((entry) => entry.id !== account.id),
      orders: isMerchant
        ? state.database.orders.filter((order) => order.merchantId !== account.id)
        : state.database.orders.map((order) => order.courierId === account.id ? {
          ...order,
          courierId: undefined,
          courierName: "مندوب سابق",
          trackingEvents: order.trackingEvents?.map((event) => event.actor === account.name ? { ...event, actor: "مندوب سابق" } : event),
        } : order),
      recipients: isMerchant ? state.database.recipients.filter((recipient) => recipient.merchantId !== account.id) : state.database.recipients,
      collections: isMerchant ? state.database.collections.filter((invoice) => invoice.merchantId !== account.id) : state.database.collections,
      notices: state.database.notices.filter((notice) => notice.userId !== account.id),
      preferences: Object.fromEntries(Object.entries(state.database.preferences).filter(([accountId]) => accountId !== account.id)),
    });

    if (!await saveState(database, next, state.revision)) continue;

    await database.batch([
      database.prepare("DELETE FROM almadina_sessions WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_webauthn_credentials WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_passkey_login_credentials WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_webauthn_challenges WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_app_locks WHERE user_id = ?").bind(account.id),
    ]);
    return json({ success: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
  }

  return json({ error: "تم تحديث بيانات الحساب من جهاز آخر. راجع الشروط ثم حاول مجددًا." }, 409);
}

async function login(database: D1Database, request: Request): Promise<Response> {
  const payload = await request.json() as { email?: string; password?: string };
  const email = payload.email?.trim().toLowerCase() ?? "";
  const password = payload.password ?? "";
  const state = await readState(database);
  const account = state.database.users.find((entry) => entry.email.toLowerCase() === email);

  if (!account || !await verifyPassword(password, account.password)) {
    return json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
  }

  const token = await createSession(database, account.id);
  return json(snapshot(state, account), 200, { "Set-Cookie": sessionCookie(request, token) });
}

async function register(database: D1Database, request: Request): Promise<Response> {
  const payload = await request.json() as Partial<User>;
  const name = payload.name?.trim() ?? "";
  const phone = payload.phone?.trim() ?? "";
  const store = payload.store?.trim() ?? "";
  const email = payload.email?.trim().toLowerCase() ?? "";
  const password = payload.password ?? "";

  if (!name || !store || !/^05\d{8}$/.test(phone) || !validEmail(email) || password.length < 8) {
    return json({ error: "تحقق من الاسم والمتجر ورقم الجوال والبريد وكلمة المرور." }, 400);
  }

  const account: User = {
    id: uid("merchant"), name, phone, store, email,
    password: await hashPassword(password),
    role: "merchant", membership: "standard", joinedAt: new Date().toISOString(), avatarColor: "#187a50",
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await readState(database);
    if (state.database.users.some((entry) => entry.email.toLowerCase() === email)) {
      return json({ error: "يوجد حساب مسجل بهذا البريد الإلكتروني." }, 409);
    }

    const next = { ...state.database, users: [...state.database.users, account] };
    if (!await saveState(database, next, state.revision)) continue;

    const token = await createSession(database, account.id);
    return json(snapshot({ database: next, revision: state.revision + 1 }, account), 201, {
      "Set-Cookie": sessionCookie(request, token),
    });
  }

  return json({ error: "تعذّر حفظ الحساب بسبب تحديث متزامن. حاول مجددًا." }, 409);
}

async function publicTracking(database: D1Database, request: Request): Promise<Response> {
  const trackingNumber = new URL(request.url).searchParams.get("tracking")?.trim().toUpperCase() ?? "";
  if (!trackingNumber) return json({ error: "أدخل رقم تتبع الطرد." }, 400);

  const state = await readState(database);
  const order = state.database.orders.find((entry) => entry.trackingNumber.toUpperCase() === trackingNumber && !entry.deleted);
  if (!order) return json({ error: "لم نعثر على طرد بهذا الرقم." }, 404);

  const trackingEvents = getOrderTrackingEvents(order).filter((event) => event.kind !== "note").map((event) => {
    const safeEvent = createTrackingEvent(event.status, "فريق المدينة إكسبرس", { createdAt: event.createdAt });
    return { ...safeEvent, id: event.id };
  });
  const { id, recipientName, city, status, createdAt, updatedAt } = order;
  return json({ order: { id, trackingNumber: order.trackingNumber, recipientName, city, status, createdAt, updatedAt, trackingEvents } });
}

async function shipScannedOrder(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  if (session.account.role !== "courier") {
    return json({ error: "هذه العملية متاحة لحساب المندوب الموظف فقط." }, 403);
  }

  const payload = await request.json() as { trackingNumber?: unknown };
  const trackingNumber = typeof payload.trackingNumber === "string" ? payload.trackingNumber.trim().toUpperCase() : "";
  if (!/^ALX-\d+$/.test(trackingNumber)) {
    return json({ error: "كود الطرد غير صالح. امسح رمز ملصق الشحن مجددًا." }, 400);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = attempt === 0 ? session.state : await readState(database);
    const employee = state.database.users.find((account) => account.id === session.account.id);
    if (!employee || employee.role !== "courier") return json({ error: "لم تعد صلاحية المندوب الموظف متاحة." }, 403);

    const order = state.database.orders.find((entry) => entry.trackingNumber.toUpperCase() === trackingNumber && !entry.deleted);
    if (!order) return json({ error: "لم نعثر على طرد بهذا الكود." }, 404);
    if (order.status === "shipped") return json({ error: "تم شحن هذا الطرد مسبقًا." }, 409);
    if (order.status !== "ready") return json({ error: "يجب أن تكون حالة الطرد «جاهز للإرسال» قبل شحنه." }, 409);

    const now = new Date().toISOString();
    const trackedOrder = appendOrderTrackingEvent(
      order,
      "shipped",
      employee.name,
      "استلم الموظف الطرد بعد مسح كود الشحن بالكاميرا.",
    );
    const shippedOrder: Order = {
      ...trackedOrder,
      courierId: employee.id,
      courierName: employee.name,
      shippedAt: now,
    };
    const next: Database = {
      ...state.database,
      orders: state.database.orders.map((entry) => entry.id === order.id ? shippedOrder : entry),
      notices: [{
        id: uid("notice"),
        userId: order.merchantId,
        title: "تم شحن الطرد",
        message: `قرأ الموظف كود الطرد ${order.trackingNumber} وأصبحت حالته «مشحون».`,
        icon: "truck",
        read: false,
        createdAt: now,
      }, ...state.database.notices],
    };

    if (!await saveState(database, next, state.revision)) continue;
    return json(snapshot({ database: next, revision: state.revision + 1 }, employee));
  }

  return json({ error: "تم تحديث الطرد من جهاز آخر. امسح الكود مجددًا." }, 409);
}

async function verifyCollection(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  if (session.account.role !== "admin") {
    return json({ error: "هذه العملية متاحة لموظف الإدارة فقط." }, 403);
  }

  const payload = await request.json() as { invoiceId?: string; verificationCode?: string };
  const invoiceId = payload.invoiceId?.trim() ?? "";
  const verificationCode = payload.verificationCode?.trim() ?? "";
  if (!invoiceId || !/^\d{4}$/.test(verificationCode)) {
    return json({ error: "أدخل كود تحقق صحيحًا من 4 أرقام." }, 400);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = attempt === 0 ? session.state : await readState(database);
    const employee = state.database.users.find((account) => account.id === session.account.id);
    if (!employee || employee.role !== "admin") return json({ error: "لم تعد صلاحية الموظف متاحة." }, 403);

    const invoice = state.database.collections.find((entry) => entry.id === invoiceId);
    if (!invoice) return json({ error: "فاتورة التحصيل غير موجودة." }, 404);
    if (invoice.status === "shipped") return json({ error: "تم اعتماد هذا الكود وشحن التحصيل مسبقًا." }, 409);
    if (invoice.status === "paid") return json({ error: "تم إكمال هذه الفاتورة مسبقًا." }, 409);
    if (invoice.status !== "ready") return json({ error: "يجب تجهيز الفاتورة قبل قراءة كود التحقق." }, 409);
    if (invoice.verificationCode !== verificationCode) return json({ error: "كود التحقق غير صحيح." }, 422);

    const now = new Date().toISOString();
    const next: Database = {
      ...state.database,
      collections: state.database.collections.map((entry) => entry.id === invoice.id ? {
        ...entry,
        status: "shipped",
        shippedAt: now,
        verifiedAt: now,
        verifiedById: employee.id,
        verifiedByName: employee.name,
        updatedAt: now,
      } : entry),
      notices: [{
        id: uid("notice"),
        userId: invoice.merchantId,
        title: "تم شحن التحصيل",
        message: `تحقق الموظف من كود الفاتورة ${invoice.invoiceNumber} وأصبحت حالة التحصيل «مشحون».`,
        icon: "check",
        read: false,
        createdAt: now,
      }, ...state.database.notices],
    };

    if (!await saveState(database, next, state.revision)) continue;
    return json(snapshot({ database: next, revision: state.revision + 1 }, employee));
  }

  return json({ error: "تم تحديث الفاتورة من جهاز آخر. حاول قراءة الكود مجددًا." }, 409);
}

export async function handleAlmadinaApi(request: Request, database: D1Database): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && origin !== url.origin) return json({ error: "مصدر الطلب غير مسموح." }, 403);

    await ensureDatabase(database);

    if (url.pathname === "/api/almadina/login" && request.method === "POST") return await login(database, request);
    if (url.pathname === "/api/almadina/register" && request.method === "POST") return await register(database, request);
    if (url.pathname === "/api/almadina/passkey/login/options" && request.method === "POST") return await publicPasskeyLoginOptions(database, request);
    if (url.pathname === "/api/almadina/passkey/login/verify" && request.method === "POST") return await verifyPublicPasskeyLogin(database, request);
    if (url.pathname === "/api/almadina/track" && request.method === "GET") return await publicTracking(database, request);

    const session = await authenticate(database, request);

    if (url.pathname === "/api/almadina/logout" && request.method === "POST") {
      if (session) await database.prepare("DELETE FROM almadina_sessions WHERE token_hash = ?").bind(await sha256(session.token)).run();
      return json({ success: true }, 200, cookieHeaders(
        sessionCookie(request, "", 0),
        passkeyLoginCookie(request, "", 0),
      ));
    }

    if (!session) return json({ error: "يجب تسجيل الدخول أولًا." }, 401, { "Set-Cookie": sessionCookie(request, "", 0) });

    if (url.pathname === "/api/almadina/security/status" && request.method === "GET") {
      return json(await appLockStatus(database, session.account.id));
    }

    if (url.pathname === "/api/almadina/security/pin" && request.method === "POST") {
      return await createAppLock(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/pin/verify" && request.method === "POST") {
      return await verifyAppLockPinRequest(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/disable" && request.method === "POST") {
      return await disableAppLock(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/webauthn/register/options" && request.method === "POST") {
      return await webAuthnRegistrationOptions(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/webauthn/register/verify" && request.method === "POST") {
      return await verifyWebAuthnRegistration(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/webauthn/authenticate/options" && request.method === "POST") {
      return await webAuthnAuthenticationOptions(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/webauthn/authenticate/verify" && request.method === "POST") {
      return await verifyWebAuthnAuthentication(database, request, session);
    }

    if (url.pathname === "/api/almadina/security/webauthn/disable" && request.method === "POST") {
      return await disableWebAuthn(database, request, session);
    }

    if (url.pathname === "/api/almadina/notices/broadcast" && request.method === "POST") {
      return await broadcastNotice(database, request, session);
    }

    if (url.pathname === "/api/almadina/notices/clear" && request.method === "POST") {
      return await clearNotices(database, request, session);
    }

    if (url.pathname === "/api/almadina/account/delete" && request.method === "POST") {
      return await deleteOwnAccount(database, request, session);
    }

    if (url.pathname === "/api/almadina/collections/verify" && request.method === "POST") {
      return await verifyCollection(database, request, session);
    }

    if (url.pathname === "/api/almadina/orders/scan" && request.method === "POST") {
      return await shipScannedOrder(database, request, session);
    }

    if ((url.pathname === "/api/almadina/session" || url.pathname === "/api/almadina/database") && request.method === "GET") {
      return json(snapshot(session.state, session.account));
    }

    if (url.pathname === "/api/almadina/database" && request.method === "PUT") {
      const payload = await request.json() as { database?: unknown; revision?: number };
      if (!isValidDatabase(payload.database) || !Number.isSafeInteger(payload.revision)) return json({ error: "بيانات الحفظ غير صالحة." }, 400);

      if (payload.revision !== session.state.revision) {
        return json({ error: "تم تحديث البيانات من جهاز آخر.", ...snapshot(session.state, session.account) }, 409);
      }

      const next = session.account.role === "admin"
        ? await mergeAdminDatabase(session.state.database, payload.database, session.account)
        : session.account.role === "merchant"
          ? mergeMerchantDatabase(session.state.database, payload.database, session.account)
          : mergeCourierDatabase(session.state.database, payload.database, session.account);

      if (!await saveState(database, next, session.state.revision)) {
        const latest = await readState(database);
        const account = latest.database.users.find((entry) => entry.id === session.account.id);
        return account ? json({ error: "تم تحديث البيانات من جهاز آخر.", ...snapshot(latest, account) }, 409) : json({ error: "لم يعد الحساب متاحًا." }, 401);
      }

      const account = next.users.find((entry) => entry.id === session.account.id);
      if (!account) return json({ error: "لم يعد الحساب متاحًا." }, 401);
      return json(snapshot({ database: next, revision: session.state.revision + 1 }, account));
    }

    return json({ error: "المسار المطلوب غير موجود." }, 404);
  } catch (error) {
    if (error instanceof ApiRequestError) return json({ error: error.message }, error.status);
    console.error("Almadina API request failed.", error);
    return json({ error: "تعذّر الاتصال بقاعدة بيانات الموقع. حاول مجددًا بعد قليل." }, 500);
  }
}
