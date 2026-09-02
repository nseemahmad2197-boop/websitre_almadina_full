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
import { appendOrderTrackingEvent, appendOrderTrackingNote, createSeedDatabase, createTrackingEvent, getDeliveryFee, getOrderDimensions, getOrderOversizeFee, getOrderTrackingEvents, getWeightFee, normalizeMembership, normalizeWeightOption, removeLegacyDemoData, resolveDeliveryRegion, uid, type CollectionInvoice, type Database, type LinkedDevice, type LinkedDeviceType, type Notice, type Order, type Preferences, type Recipient, type User } from "./data";
import { deliverPasswordResetCode, deliverRegistrationVerificationCode, isPasswordResetDeliveryConfigured, type PasswordResetDeliveryConfig } from "./password-reset-delivery";
import { isReverseGeocodingConfigured, reverseGeocode, type ReverseGeocodingConfig } from "./reverse-geocoding";

const SESSION_COOKIE = "almadina_session";
const PASSKEY_LOGIN_COOKIE = "almadina_passkey_login";
const PASSWORD_RESET_COOKIE = "almadina_password_reset";
const REGISTRATION_COOKIE = "almadina_registration";
const SESSION_DURATION = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 600_000;
const APP_LOCK_CHALLENGE_DURATION = 5 * 60;
const APP_LOCK_MAX_FAILED_ATTEMPTS = 5;
const APP_LOCK_COOLDOWN = 5 * 60;
const PASSKEY_RATE_LIMIT_WINDOW = 5 * 60;
const PASSKEY_OPTIONS_RATE_LIMIT = 30;
const PASSKEY_VERIFY_RATE_LIMIT = 60;
const COLLECTION_VERIFY_RATE_LIMIT_WINDOW = 10 * 60;
const COLLECTION_VERIFY_RATE_LIMIT = 6;
const COLLECTION_VERIFY_GLOBAL_RATE_LIMIT = 20;
const PASSWORD_CHANGE_RATE_LIMIT_WINDOW = 10 * 60;
const PASSWORD_CHANGE_RATE_LIMIT = 5;
const PASSWORD_RESET_CODE_DURATION = 10 * 60;
const PASSWORD_RESET_TOKEN_DURATION = 10 * 60;
const PASSWORD_RESET_RETRY_DELAY = 60;
const PASSWORD_RESET_CODE_ITERATIONS = 120_000;
const PASSWORD_RESET_MAX_FAILED_ATTEMPTS = 5;
const PASSWORD_RESET_RATE_LIMIT_WINDOW = 15 * 60;
const PASSWORD_RESET_REQUEST_IP_LIMIT = 10;
const PASSWORD_RESET_REQUEST_IDENTIFIER_LIMIT = 3;
const PASSWORD_RESET_VERIFY_IP_LIMIT = 20;
const PASSWORD_RESET_COMPLETE_IP_LIMIT = 10;
const REGISTRATION_CODE_DURATION = 10 * 60;
const REGISTRATION_RETRY_DELAY = 60;
const REGISTRATION_MAX_FAILED_ATTEMPTS = 5;
const REGISTRATION_RATE_LIMIT_WINDOW = 15 * 60;
const REGISTRATION_REQUEST_IP_LIMIT = 10;
const REGISTRATION_REQUEST_EMAIL_LIMIT = 3;
const REGISTRATION_VERIFY_IP_LIMIT = 20;
const REVERSE_GEOCODE_RATE_LIMIT_WINDOW = 10 * 60;
const REVERSE_GEOCODE_REQUEST_IP_LIMIT = 20;
const LOGIN_RATE_LIMIT_WINDOW = 15 * 60;
const LOGIN_REQUEST_IP_LIMIT = 40;
const LOGIN_REQUEST_IDENTIFIER_LIMIT = 10;
const PUBLIC_TRACKING_RATE_LIMIT_WINDOW = 10 * 60;
const PUBLIC_TRACKING_REQUEST_IP_LIMIT = 30;
const ACCOUNT_DELETE_RATE_LIMIT_WINDOW = 10 * 60;
const ACCOUNT_DELETE_ATTEMPT_LIMIT = 6;
const COURIER_SCAN_RATE_LIMIT_WINDOW = 10 * 60;
const COURIER_SCAN_ATTEMPT_LIMIT = 120;
const MAX_API_BODY_BYTES = 2 * 1024 * 1024;
const LEGACY_DEFAULT_ADMIN_PASSWORD = "Admin@123";
const BOOTSTRAP_LOCKED_PASSWORD = "disabled:bootstrap-password-required";
const DEVICE_ACTIVITY_UPDATE_INTERVAL = 5 * 60 * 1000;
const initializedDatabases = new WeakMap<D1Database, Promise<void>>();

type StateRow = { payload: string; revision: number };
type SessionRow = { user_id: string; expires_at: number; created_at: string };
type StoredState = { database: Database; revision: number };
type AuthenticatedSession = { account: User; state: StoredState; token: string; tokenHash: string };
type SessionDeviceRow = {
  token_hash: string;
  created_at: string;
  device_name: string | null;
  device_type: string | null;
  browser_name: string | null;
  last_active_at: string | null;
};
type SessionTokenRow = { token_hash: string };
type DeviceDescriptor = { name: string; type: LinkedDeviceType; browser: string };
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
type PasswordResetRow = {
  request_hash: string;
  user_id: string;
  channel: "email";
  code_hash: string;
  failed_attempts: number;
  expires_at: number;
  verified_at: number | null;
  reset_token_hash: string | null;
  reset_expires_at: number | null;
};
type RegistrationRequestRow = {
  request_hash: string;
  email: string;
  name: string;
  phone: string;
  store: string;
  password_hash: string;
  code_hash: string;
  failed_attempts: number;
  expires_at: number;
  created_at: string;
};
type RegistrationLocationRow = {
  request_hash: string;
  governorate: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  created_at: string;
};

type BootstrapAdministratorConfig = {
  bootstrapAdminEmail?: string;
  bootstrapAdminPassword?: string;
  bootstrapAdminPhone?: string;
  bootstrapAdminName?: string;
};

export type AlmadinaApiConfig = PasswordResetDeliveryConfig & ReverseGeocodingConfig & BootstrapAdministratorConfig;

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("X-Frame-Options", "DENY");
  return Response.json(payload, {
    status,
    headers: responseHeaders,
  });
}

async function validateApiRequestEnvelope(request: Request): Promise<Request | Response> {
  const method = request.method.toUpperCase();
  const unsafeMethod = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!unsafeMethod) return request;

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return json({ error: "مصدر الطلب غير مسموح." }, 403);

  const lengthHeader = request.headers.get("content-length");
  const contentLength = lengthHeader === null ? 0 : Number(lengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_API_BODY_BYTES) {
    return json({ error: "حجم الطلب أكبر من الحد المسموح." }, 413);
  }

  if (request.body === null) return request;

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  const jsonContentType = contentType === "application/json" || contentType.endsWith("+json");
  // بعض بيئات Node/Render تمثل POST الفارغ كمسار Body بطول صفر بدل null.
  // نؤجل رفض نوع المحتوى حتى نعرف أن الطلب يحتوي بيانات فعلية.
  if (!jsonContentType && lengthHeader !== null && contentLength > 0) {
    return json({ error: "نوع محتوى الطلب غير مدعوم." }, 415);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalLength += value.byteLength;
      if (totalLength > MAX_API_BODY_BYTES) {
        await reader.cancel();
        return json({ error: "حجم الطلب أكبر من الحد المسموح." }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "تعذّرت قراءة بيانات الطلب." }, 400);
  }

  if (totalLength > 0 && !jsonContentType) return json({ error: "نوع محتوى الطلب غير مدعوم." }, 415);

  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
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

function randomSecret(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

function randomVerificationCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

function normalizeArabicDigits(value: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return value.replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)));
}

function normalizeAccountPhone(value: string): string | null {
  const normalized = normalizeArabicDigits(value).trim().replace(/[\s().-]/g, "");
  const international = normalized.startsWith("00") ? `+${normalized.slice(2)}` : normalized;
  if (/^05\d{8}$/.test(international)) return international;
  if (/^\+(?:970|972)5\d{8}$/.test(international)) return `0${international.slice(4)}`;
  return null;
}

function normalizeResetIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return validEmail(email) ? email : null;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return `pbkdf2:${PASSWORD_ITERATIONS}:${toHex(salt)}:${toHex(derived)}`;
}

async function hashPasswordResetCode(requestToken: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: fromHex(requestToken),
    iterations: PASSWORD_RESET_CODE_ITERATIONS,
  }, key, 256);
  return toHex(derived);
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

function passwordHashNeedsUpgrade(stored: string): boolean {
  const [algorithm, iterationValue] = stored.split(":");
  const iterations = Number(iterationValue);
  return algorithm === "pbkdf2" && Number.isSafeInteger(iterations) && iterations < PASSWORD_ITERATIONS;
}

async function configuredBootstrapAdministrator(config: AlmadinaApiConfig, existing?: User): Promise<User | null> {
  const password = config.bootstrapAdminPassword ?? "";
  if (!password) return null;
  if (!validNewPassword(password) || password === LEGACY_DEFAULT_ADMIN_PASSWORD || password.length < 12) {
    throw new Error("ALMADINA_ADMIN_PASSWORD must contain at least 12 characters, a letter, a number, and a symbol, and must not use the retired default password.");
  }

  const email = (config.bootstrapAdminEmail?.trim().toLowerCase() || existing?.email || "admin@almadinaexpress.com");
  const phone = normalizeAccountPhone(config.bootstrapAdminPhone || existing?.phone || "0599000000") ?? "";
  if (!validEmail(email) || email.length > 254 || !phone) {
    throw new Error("ALMADINA_ADMIN_EMAIL or ALMADINA_ADMIN_PHONE is invalid.");
  }

  return {
    id: existing?.id || "admin-almadina",
    name: config.bootstrapAdminName?.trim().slice(0, 120) || existing?.name || "إدارة المدينة إكسبرس",
    email,
    password: await hashPassword(password),
    phone,
    store: existing?.store || "المدينة إكسبرس",
    role: "admin",
    joinedAt: existing?.joinedAt || new Date().toISOString(),
    avatarColor: existing?.avatarColor || "#087c45",
  };
}

async function secureBootstrapAdministrator(database: D1Database, config: AlmadinaApiConfig): Promise<void> {
  const state = await readState(database);
  const administrators = state.database.users.filter((account) => account.role === "admin");
  let retiredDefault: User | undefined;
  for (const administrator of administrators) {
    if (administrator.password === BOOTSTRAP_LOCKED_PASSWORD || await verifyPassword(LEGACY_DEFAULT_ADMIN_PASSWORD, administrator.password)) {
      retiredDefault = administrator;
      break;
    }
  }

  if (!retiredDefault && administrators.length) return;
  const configured = await configuredBootstrapAdministrator(config, retiredDefault);
  if (!configured && !retiredDefault) return;

  const targetId = retiredDefault?.id ?? configured!.id;
  const replacement = configured ?? { ...retiredDefault!, password: BOOTSTRAP_LOCKED_PASSWORD };
  if (state.database.users.some((account) => account.id !== targetId && account.email.trim().toLowerCase() === replacement.email.trim().toLowerCase())) {
    throw new Error("ALMADINA_ADMIN_EMAIL is already assigned to another account.");
  }
  const next = {
    ...state.database,
    users: retiredDefault
      ? state.database.users.map((account) => account.id === retiredDefault!.id ? replacement : account)
      : [...state.database.users, replacement],
  };
  if (!await saveState(database, next, state.revision)) throw new Error("Could not secure the bootstrap administrator because the database changed concurrently.");
  await database.batch([
    database.prepare("DELETE FROM almadina_session_devices WHERE user_id = ?").bind(targetId),
    database.prepare("DELETE FROM almadina_sessions WHERE user_id = ?").bind(targetId),
  ]);
}

async function initializeDatabase(database: D1Database, config: AlmadinaApiConfig): Promise<void> {
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
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_session_devices (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      browser_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_session_devices_user_id_idx ON almadina_session_devices (user_id)"),
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
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_password_reset_requests (
      request_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      failed_attempts INTEGER DEFAULT 0 NOT NULL,
      expires_at INTEGER NOT NULL,
      verified_at INTEGER,
      reset_token_hash TEXT,
      reset_expires_at INTEGER,
      created_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_password_reset_requests_user_id_idx ON almadina_password_reset_requests (user_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_password_reset_requests_expires_at_idx ON almadina_password_reset_requests (expires_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_password_reset_requests_reset_token_hash_idx ON almadina_password_reset_requests (reset_token_hash)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_registration_requests (
      request_hash TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      store TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      failed_attempts INTEGER DEFAULT 0 NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_registration_requests_email_idx ON almadina_registration_requests (email)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_registration_requests_phone_idx ON almadina_registration_requests (phone)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_registration_requests_expires_at_idx ON almadina_registration_requests (expires_at)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_registration_locations (
      request_hash TEXT PRIMARY KEY NOT NULL,
      governorate TEXT NOT NULL,
      city TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at TEXT NOT NULL
    )`),
  ]);

  const existing = await database.prepare("SELECT revision FROM almadina_state WHERE id = ?").bind("main").first<{ revision: number }>();
  if (existing) {
    await secureBootstrapAdministrator(database, config);
    return;
  }

  const initial = createSeedDatabase();
  const administrator = await configuredBootstrapAdministrator(config);
  if (administrator) initial.users.push(administrator);
  await database.prepare("INSERT INTO almadina_state (id, payload, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
    .bind("main", JSON.stringify(initial), 0, new Date().toISOString()).run();
}

async function ensureDatabase(database: D1Database, config: AlmadinaApiConfig): Promise<void> {
  let initialization = initializedDatabases.get(database);
  if (!initialization) {
    initialization = initializeDatabase(database, config);
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

async function savePasswordChange(
  database: D1Database,
  state: Database,
  revision: number,
  userId: string,
  currentSessionToken: string,
  signOutAllDevices: boolean,
  request: Request,
): Promise<{ saved: boolean; replacementSessionToken?: string }> {
  const payload = JSON.stringify(removeLegacyDemoData(state));
  const nextRevision = revision + 1;
  const updatedAt = new Date().toISOString();
  const stateMatches = "EXISTS (SELECT 1 FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?)";
  const updateState = database.prepare("UPDATE almadina_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .bind(payload, updatedAt, "main", revision);

  if (signOutAllDevices) {
    const results = await database.batch<D1Result>([
      updateState,
      database.prepare(`DELETE FROM almadina_session_devices WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
      database.prepare(`DELETE FROM almadina_sessions WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
      database.prepare(`DELETE FROM almadina_webauthn_credentials WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
      database.prepare(`DELETE FROM almadina_passkey_login_credentials WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
      database.prepare(`DELETE FROM almadina_webauthn_challenges WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
      database.prepare(`UPDATE almadina_app_locks SET biometric_enabled = 0, updated_at = ? WHERE user_id = ? AND ${stateMatches}`).bind(updatedAt, userId, "main", nextRevision, payload),
      database.prepare(`DELETE FROM almadina_password_reset_requests WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    ]);
    return { saved: (results[0]?.meta?.changes ?? 0) === 1 };
  }

  const replacementSessionToken = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const replacementTokenHash = await sha256(replacementSessionToken);
  const currentTokenHash = await sha256(currentSessionToken);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;
  const descriptor = describeDevice(request);
  const results = await database.batch<D1Result>([
    updateState,
    database.prepare(`DELETE FROM almadina_session_devices WHERE token_hash = ? AND ${stateMatches}`).bind(currentTokenHash, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_sessions WHERE token_hash = ? AND ${stateMatches}`).bind(currentTokenHash, "main", nextRevision, payload),
    database.prepare(`INSERT INTO almadina_sessions (token_hash, user_id, expires_at, created_at)
      SELECT ?, ?, ?, ? FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?`)
      .bind(replacementTokenHash, userId, expiresAt, updatedAt, "main", nextRevision, payload),
    database.prepare(`INSERT INTO almadina_session_devices (token_hash, user_id, device_name, device_type, browser_name, created_at, last_active_at)
      SELECT ?, ?, ?, ?, ?, ?, ? FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?`)
      .bind(replacementTokenHash, userId, descriptor.name, descriptor.type, descriptor.browser, updatedAt, updatedAt, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_password_reset_requests WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
  ]);
  const saved = (results[0]?.meta?.changes ?? 0) === 1;
  return { saved, ...(saved ? { replacementSessionToken } : {}) };
}

async function savePasswordReset(
  database: D1Database,
  state: Database,
  revision: number,
  userId: string,
  resetTokenHash: string,
): Promise<boolean> {
  const payload = JSON.stringify(removeLegacyDemoData(state));
  const nextRevision = revision + 1;
  const updatedAt = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);
  const stateMatches = "EXISTS (SELECT 1 FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?)";
  const results = await database.batch<D1Result>([
    database.prepare(`UPDATE almadina_state SET payload = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM almadina_password_reset_requests
          WHERE reset_token_hash = ? AND user_id = ? AND verified_at IS NOT NULL AND reset_expires_at > ?)`)
      .bind(payload, updatedAt, "main", revision, resetTokenHash, userId, now),
    database.prepare(`DELETE FROM almadina_session_devices WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_sessions WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_webauthn_credentials WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_passkey_login_credentials WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_webauthn_challenges WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_app_locks WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_password_reset_requests WHERE user_id = ? AND ${stateMatches}`).bind(userId, "main", nextRevision, payload),
  ]);
  return (results[0]?.meta?.changes ?? 0) === 1;
}

async function saveVerifiedRegistration(
  database: D1Database,
  state: Database,
  revision: number,
  requestHash: string,
  codeHash: string,
  accountId: string,
  request: Request,
): Promise<{ saved: boolean; sessionToken?: string }> {
  const payload = JSON.stringify(removeLegacyDemoData(state));
  const nextRevision = revision + 1;
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date().toISOString();
  const sessionToken = randomSecret();
  const sessionTokenHash = await sha256(sessionToken);
  const expiresAt = now + SESSION_DURATION;
  const descriptor = describeDevice(request);
  const stateMatches = "EXISTS (SELECT 1 FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?)";
  const results = await database.batch<D1Result>([
    database.prepare(`UPDATE almadina_state SET payload = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND revision = ?
        AND EXISTS (SELECT 1 FROM almadina_registration_requests
          WHERE request_hash = ? AND code_hash = ? AND expires_at > ? AND failed_attempts < ?)`)
      .bind(payload, createdAt, "main", revision, requestHash, codeHash, now, REGISTRATION_MAX_FAILED_ATTEMPTS),
    database.prepare(`DELETE FROM almadina_registration_requests WHERE request_hash = ? AND ${stateMatches}`)
      .bind(requestHash, "main", nextRevision, payload),
    database.prepare(`DELETE FROM almadina_registration_locations WHERE request_hash = ? AND ${stateMatches}`)
      .bind(requestHash, "main", nextRevision, payload),
    database.prepare(`INSERT INTO almadina_sessions (token_hash, user_id, expires_at, created_at)
      SELECT ?, ?, ?, ? FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?`)
      .bind(sessionTokenHash, accountId, expiresAt, createdAt, "main", nextRevision, payload),
    database.prepare(`INSERT INTO almadina_session_devices (token_hash, user_id, device_name, device_type, browser_name, created_at, last_active_at)
      SELECT ?, ?, ?, ?, ?, ?, ? FROM almadina_state WHERE id = ? AND revision = ? AND payload = ?`)
      .bind(sessionTokenHash, accountId, descriptor.name, descriptor.type, descriptor.browser, createdAt, createdAt, "main", nextRevision, payload),
  ]);
  const saved = (results[0]?.meta?.changes ?? 0) === 1;
  return { saved, ...(saved ? { sessionToken } : {}) };
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
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function passkeyLoginCookie(request: Request, token: string, maxAge = APP_LOCK_CHALLENGE_DURATION): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PASSKEY_LOGIN_COOKIE}=${token}; Path=/api/almadina; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function passwordResetCookie(request: Request, token: string, maxAge = PASSWORD_RESET_CODE_DURATION): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PASSWORD_RESET_COOKIE}=${token}; Path=/api/almadina/password-reset; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function registrationCookie(request: Request, token: string, maxAge = REGISTRATION_CODE_DURATION): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${REGISTRATION_COOKIE}=${token}; Path=/api/almadina/register; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function enforcePublicPasskeyRateLimit(database: D1Database, request: Request, action: "options" | "verify", limit: number): Promise<void> {
  const clientAddress = requestClientAddress(request);
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

async function enforceCollectionVerificationRateLimit(database: D1Database, userId: string, invoiceId: string, enforceGlobalLimit: boolean): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + COLLECTION_VERIFY_RATE_LIMIT_WINDOW;

  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();

  const limits = [
    ...(enforceGlobalLimit ? [{
      keyHash: await sha256(`collection-verification-user:${userId}`),
      action: "collection-verification-user",
      limit: COLLECTION_VERIFY_GLOBAL_RATE_LIMIT,
      message: "محاولات كثيرة للتحقق من الفواتير. انتظر عشر دقائق ثم حاول مجددًا.",
    }] : []),
    {
      keyHash: await sha256(`collection-verification:${userId}:${invoiceId}`),
      action: "collection-verification",
      limit: COLLECTION_VERIFY_RATE_LIMIT,
      message: "محاولات كثيرة لقراءة هذا الكود. انتظر عشر دقائق ثم حاول مجددًا.",
    },
  ];

  for (const entry of limits) {
    const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT (key_hash) DO UPDATE SET
        action = excluded.action,
        request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
        reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
      RETURNING request_count, reset_at`)
      .bind(entry.keyHash, entry.action, resetAt, now, now).first<RateLimitRow>();
    if (!rate || rate.request_count > entry.limit) throw new ApiRequestError(entry.message, 429);
  }
}

async function enforcePasswordChangeRateLimit(database: D1Database, userId: string): Promise<void> {
  const keyHash = await sha256(`password-change:${userId}`);
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + PASSWORD_CHANGE_RATE_LIMIT_WINDOW;

  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();
  const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      action = excluded.action,
      request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
      reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
    RETURNING request_count, reset_at`)
    .bind(keyHash, "password-change", resetAt, now, now).first<RateLimitRow>();
  if (!rate || rate.request_count > PASSWORD_CHANGE_RATE_LIMIT) {
    throw new ApiRequestError("محاولات كثيرة لتغيير كلمة المرور. انتظر عشر دقائق ثم حاول مجددًا.", 429);
  }
}

function requestClientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const cloudflareAddress = "cf" in request ? request.headers.get("cf-connecting-ip")?.trim() : "";
  return (cloudflareAddress || forwarded.at(0) || "unknown").slice(0, 128).toLowerCase();
}

async function enforceEndpointRateLimit(
  database: D1Database,
  namespace: string,
  keyMaterial: string,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<void> {
  const keyHash = await sha256(`${namespace}:${keyMaterial}`);
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;
  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();
  const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      action = excluded.action,
      request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
      reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
    RETURNING request_count, reset_at`)
    .bind(keyHash, namespace, resetAt, now, now).first<RateLimitRow>();
  if (!rate || rate.request_count > limit) throw new ApiRequestError(message, 429);
}

async function enforcePasswordResetRateLimit(
  database: D1Database,
  keyMaterial: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const keyHash = await sha256(`password-reset:${action}:${keyMaterial}`);
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;
  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();
  const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      action = excluded.action,
      request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
      reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
    RETURNING request_count, reset_at`)
    .bind(keyHash, `password-reset-${action}`, resetAt, now, now).first<RateLimitRow>();
  if (!rate || rate.request_count > limit) {
    throw new ApiRequestError("محاولات كثيرة لإعادة تعيين كلمة المرور. انتظر بضع دقائق ثم حاول مجددًا.", 429);
  }
}

async function enforcePasswordResetRequestRateLimits(
  database: D1Database,
  request: Request,
  identifier: string,
): Promise<void> {
  await enforcePasswordResetRateLimit(
    database,
    identifier,
    "request-cooldown",
    1,
    PASSWORD_RESET_RETRY_DELAY,
  );
  await enforcePasswordResetRateLimit(
    database,
    requestClientAddress(request),
    "request-ip",
    PASSWORD_RESET_REQUEST_IP_LIMIT,
    PASSWORD_RESET_RATE_LIMIT_WINDOW,
  );
  await enforcePasswordResetRateLimit(
    database,
    identifier,
    "request-identifier",
    PASSWORD_RESET_REQUEST_IDENTIFIER_LIMIT,
    PASSWORD_RESET_RATE_LIMIT_WINDOW,
  );
}

async function enforceRegistrationRateLimit(
  database: D1Database,
  keyMaterial: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const keyHash = await sha256(`registration:${action}:${keyMaterial}`);
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;
  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();
  const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      action = excluded.action,
      request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
      reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
    RETURNING request_count, reset_at`)
    .bind(keyHash, `registration-${action}`, resetAt, now, now).first<RateLimitRow>();
  if (!rate || rate.request_count > limit) {
    throw new ApiRequestError("محاولات كثيرة لإنشاء الحساب. انتظر بضع دقائق ثم حاول مجددًا.", 429);
  }
}

async function enforceReverseGeocodeRateLimit(database: D1Database, request: Request): Promise<void> {
  const keyHash = await sha256(`reverse-geocode:${requestClientAddress(request)}`);
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + REVERSE_GEOCODE_RATE_LIMIT_WINDOW;
  await database.prepare("DELETE FROM almadina_rate_limits WHERE reset_at <= ?").bind(now).run();
  const rate = await database.prepare(`INSERT INTO almadina_rate_limits (key_hash, action, request_count, reset_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (key_hash) DO UPDATE SET
      action = excluded.action,
      request_count = CASE WHEN almadina_rate_limits.reset_at <= ? THEN 1 ELSE almadina_rate_limits.request_count + 1 END,
      reset_at = CASE WHEN almadina_rate_limits.reset_at <= ? THEN excluded.reset_at ELSE almadina_rate_limits.reset_at END
    RETURNING request_count, reset_at`)
    .bind(keyHash, "reverse-geocode", resetAt, now, now).first<RateLimitRow>();
  if (!rate || rate.request_count > REVERSE_GEOCODE_REQUEST_IP_LIMIT) {
    throw new ApiRequestError("محاولات كثيرة لتحديد العنوان من الخريطة. انتظر عشر دقائق أو أدخل العنوان يدويًا.", 429);
  }
}

async function enforceRegistrationRequestRateLimits(database: D1Database, request: Request, email: string): Promise<void> {
  await enforceRegistrationRateLimit(database, email, "request-cooldown", 1, REGISTRATION_RETRY_DELAY);
  await enforceRegistrationRateLimit(
    database,
    requestClientAddress(request),
    "request-ip",
    REGISTRATION_REQUEST_IP_LIMIT,
    REGISTRATION_RATE_LIMIT_WINDOW,
  );
  await enforceRegistrationRateLimit(
    database,
    email,
    "request-email",
    REGISTRATION_REQUEST_EMAIL_LIMIT,
    REGISTRATION_RATE_LIMIT_WINDOW,
  );
}

function describeDevice(request: Request): DeviceDescriptor {
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 1024);
  const platformHint = (request.headers.get("sec-ch-ua-platform") ?? "").replace(/["']/g, "").toLowerCase();
  const mobileHint = request.headers.get("sec-ch-ua-mobile") === "?1";

  const browser = /EdgiOS|EdgA|Edg\//i.test(userAgent)
    ? "Edge"
    : /OPiOS|OPR\//i.test(userAgent)
      ? "Opera"
      : /SamsungBrowser/i.test(userAgent)
        ? "Samsung Internet"
        : /FxiOS|Firefox\//i.test(userAgent)
          ? "Firefox"
          : /CriOS|Chrome\//i.test(userAgent)
            ? "Chrome"
            : /Safari\//i.test(userAgent) && /Version\//i.test(userAgent)
              ? "Safari"
              : "متصفح";

  let platform = "جهاز غير معروف";
  let type: LinkedDeviceType = "unknown";
  if (/iPad/i.test(userAgent) || platformHint === "ipados") {
    platform = "iPad";
    type = "tablet";
  } else if (/iPhone|iPod/i.test(userAgent) || platformHint === "ios") {
    platform = "iPhone";
    type = "mobile";
  } else if (/Android/i.test(userAgent) || platformHint === "android") {
    const tablet = !/Mobile/i.test(userAgent) && !mobileHint;
    platform = tablet ? "جهاز Android لوحي" : "هاتف Android";
    type = tablet ? "tablet" : "mobile";
  } else if (/Windows/i.test(userAgent) || platformHint === "windows") {
    platform = "Windows";
    type = "desktop";
  } else if (/Macintosh|Mac OS X/i.test(userAgent) || platformHint === "macos") {
    platform = "Mac";
    type = "desktop";
  } else if (/Linux/i.test(userAgent) || platformHint === "linux") {
    platform = "Linux";
    type = mobileHint ? "mobile" : "desktop";
  } else if (mobileHint) {
    platform = "هاتف";
    type = "mobile";
  }

  return { name: browser === "متصفح" ? platform : `${browser} على ${platform}`, type, browser };
}

async function rememberSessionDevice(database: D1Database, tokenHash: string, userId: string, createdAt: string, request: Request): Promise<void> {
  const descriptor = describeDevice(request);
  const lastActiveAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - DEVICE_ACTIVITY_UPDATE_INTERVAL).toISOString();
  await database.prepare(`INSERT INTO almadina_session_devices (token_hash, user_id, device_name, device_type, browser_name, created_at, last_active_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (token_hash) DO UPDATE SET
      user_id = excluded.user_id,
      device_name = excluded.device_name,
      device_type = excluded.device_type,
      browser_name = excluded.browser_name,
      last_active_at = excluded.last_active_at
    WHERE almadina_session_devices.last_active_at <= ?
      OR almadina_session_devices.device_name <> excluded.device_name`)
    .bind(tokenHash, userId, descriptor.name, descriptor.type, descriptor.browser, createdAt, lastActiveAt, staleBefore).run();
}

async function createSession(database: D1Database, userId: string, request: Request): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;
  const createdAt = new Date().toISOString();
  const descriptor = describeDevice(request);
  await database.batch([
    database.prepare("INSERT INTO almadina_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(tokenHash, userId, expiresAt, createdAt),
    database.prepare("INSERT INTO almadina_session_devices (token_hash, user_id, device_name, device_type, browser_name, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(tokenHash, userId, descriptor.name, descriptor.type, descriptor.browser, createdAt, createdAt),
  ]);
  return token;
}

async function authenticate(database: D1Database, request: Request): Promise<AuthenticatedSession | null> {
  const token = getSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const session = await database.prepare("SELECT user_id, expires_at, created_at FROM almadina_sessions WHERE token_hash = ?")
    .bind(tokenHash).first<SessionRow>();

  if (!session) return null;
  if (session.expires_at <= Math.floor(Date.now() / 1000)) {
    await database.batch([
      database.prepare("DELETE FROM almadina_session_devices WHERE token_hash = ?").bind(tokenHash),
      database.prepare("DELETE FROM almadina_sessions WHERE token_hash = ?").bind(tokenHash),
    ]);
    return null;
  }

  const state = await readState(database);
  const account = state.database.users.find((user) => user.id === session.user_id);
  if (!account) {
    await database.batch([
      database.prepare("DELETE FROM almadina_session_devices WHERE token_hash = ?").bind(tokenHash),
      database.prepare("DELETE FROM almadina_sessions WHERE token_hash = ?").bind(tokenHash),
    ]);
    return null;
  }
  await rememberSessionDevice(database, tokenHash, session.user_id, session.created_at, request);
  return { account, state, token, tokenHash };
}

function validLinkedDeviceType(value: string | null): LinkedDeviceType {
  return value === "mobile" || value === "tablet" || value === "desktop" ? value : "unknown";
}

async function linkedDeviceId(tokenHash: string): Promise<string> {
  return sha256(`linked-device:${tokenHash}`);
}

function equalIdentifier(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

async function readLinkedDevices(database: D1Database, userId: string, currentTokenHash: string): Promise<LinkedDevice[]> {
  const now = Math.floor(Date.now() / 1000);
  const result = await database.prepare(`SELECT sessions.token_hash, sessions.created_at,
    devices.device_name, devices.device_type, devices.browser_name, devices.last_active_at
    FROM almadina_sessions AS sessions
    LEFT JOIN almadina_session_devices AS devices ON devices.token_hash = sessions.token_hash
    WHERE sessions.user_id = ? AND sessions.expires_at > ?
    ORDER BY COALESCE(devices.last_active_at, sessions.created_at) DESC`)
    .bind(userId, now).all<SessionDeviceRow>();

  return Promise.all((result.results ?? []).map(async (row) => ({
    id: await linkedDeviceId(row.token_hash),
    name: row.device_name?.trim() || "جهاز مسجل سابقًا",
    type: validLinkedDeviceType(row.device_type),
    browser: row.browser_name?.trim() || "غير معروف",
    current: row.token_hash === currentTokenHash,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at || row.created_at,
  })));
}

async function linkedDevicesResponse(database: D1Database, session: AuthenticatedSession): Promise<Response> {
  const devices = await readLinkedDevices(database, session.account.id, session.tokenHash);
  return json({ count: devices.length, devices });
}

async function revokeLinkedDevice(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "معرّف الجهاز غير صالح." }, 400);
  }
  const deviceId = submitted && typeof submitted === "object" && !Array.isArray(submitted)
    ? (submitted as Record<string, unknown>).deviceId
    : null;
  if (typeof deviceId !== "string" || !/^[\da-f]{64}$/i.test(deviceId)) {
    return json({ error: "معرّف الجهاز غير صالح." }, 400);
  }

  const activeSessions = await database.prepare("SELECT token_hash FROM almadina_sessions WHERE user_id = ? AND expires_at > ?")
    .bind(session.account.id, Math.floor(Date.now() / 1000)).all<SessionTokenRow>();
  let selectedTokenHash = "";
  for (const entry of activeSessions.results ?? []) {
    if (equalIdentifier(await linkedDeviceId(entry.token_hash), deviceId.toLowerCase())) selectedTokenHash = entry.token_hash;
  }
  if (!selectedTokenHash) return json({ error: "لم نعثر على هذا الجهاز ضمن حسابك." }, 404);
  if (selectedTokenHash === session.tokenHash) {
    return json({ error: "هذا هو جهازك الحالي. استخدم زر تسجيل الخروج من الإعدادات." }, 409);
  }

  await database.batch([
    database.prepare("DELETE FROM almadina_session_devices WHERE token_hash = ? AND user_id = ?").bind(selectedTokenHash, session.account.id),
    database.prepare("DELETE FROM almadina_sessions WHERE token_hash = ? AND user_id = ?").bind(selectedTokenHash, session.account.id),
  ]);
  const devices = await readLinkedDevices(database, session.account.id, session.tokenHash);
  return json({ success: true, count: devices.length, devices });
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
    const sessionToken = await createSession(database, credential.user_id, request);
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

function collectionForCourier(invoice: CollectionInvoice): CollectionInvoice {
  return {
    id: invoice.id,
    merchantId: "",
    merchantName: invoice.merchantName,
    invoiceNumber: invoice.invoiceNumber,
    orderIds: [],
    grossAmount: 0,
    deliveryFees: 0,
    returnFees: 0,
    netAmount: 0,
    deliveredCount: 0,
    returnedCount: 0,
    status: invoice.status,
    verificationCode: "",
    authorizedRecipient: "",
    createdAt: "",
    updatedAt: "",
    scheduledAt: "",
    verifiedAt: invoice.status === "paid" ? invoice.verifiedAt : undefined,
    verifiedById: invoice.status === "paid" ? invoice.verifiedById : undefined,
    verifiedByName: invoice.status === "paid" ? invoice.verifiedByName : undefined,
    paidAt: invoice.status === "paid" ? invoice.paidAt : undefined,
  };
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
      collections: database.collections
        .filter((invoice) => invoice.status === "ready" || (invoice.status === "paid" && invoice.verifiedById === account.id))
        .map(collectionForCourier),
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Database>;
  const record = (entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  const stringFields = (entry: Record<string, unknown>, fields: string[]) => fields.every((field) => typeof entry[field] === "string");
  const validId = (entry: Record<string, unknown>) => typeof entry.id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(entry.id);
  const validUser = (entry: unknown) => record(entry) && validId(entry)
    && stringFields(entry, ["name", "email", "password", "phone", "store", "role", "joinedAt", "avatarColor"]);
  const validTrackingEvent = (entry: unknown) => record(entry) && validId(entry)
    && stringFields(entry, ["status", "title", "location", "actor", "note", "createdAt"]);
  const validOrder = (entry: unknown) => record(entry) && validId(entry)
    && stringFields(entry, ["trackingNumber", "merchantId", "merchantName", "merchantStore", "recipientName", "recipientPhone", "city", "address", "pickupAddress", "content", "dimensions", "notes", "privateNotes", "reference", "type", "status", "courierName", "createdAt", "updatedAt"])
    && (entry.weight === undefined || typeof entry.weight === "string")
    && typeof entry.amount === "number" && Number.isFinite(entry.amount)
    && typeof entry.deliveryFee === "number" && Number.isFinite(entry.deliveryFee)
    && typeof entry.deleted === "boolean"
    && (entry.trackingEvents === undefined || (Array.isArray(entry.trackingEvents) && entry.trackingEvents.length <= 5_000 && entry.trackingEvents.every(validTrackingEvent)));
  const validRecipient = (entry: unknown) => record(entry) && validId(entry)
    && stringFields(entry, ["merchantId", "name", "phone", "city", "address"])
    && typeof entry.favorite === "boolean";
  const validCollection = (entry: unknown) => record(entry) && validId(entry)
    && stringFields(entry, ["merchantId", "merchantName", "invoiceNumber", "status", "verificationCode", "authorizedRecipient", "createdAt", "updatedAt", "scheduledAt"])
    && Array.isArray(entry.orderIds) && entry.orderIds.length <= 50_000 && entry.orderIds.every((id) => typeof id === "string" && id.length <= 160);
  const validNotice = (entry: unknown) => record(entry) && validId(entry)
    && stringFields(entry, ["userId", "title", "message", "icon", "createdAt"])
    && typeof entry.read === "boolean";
  const uniqueIds = (entries: unknown[]) => new Set(entries.map((entry) => (entry as Record<string, unknown>).id)).size === entries.length;
  const preferences = candidate.preferences;
  return Array.isArray(candidate.users) && candidate.users.length <= 5_000
    && candidate.users.every(validUser) && uniqueIds(candidate.users)
    && Array.isArray(candidate.orders) && candidate.orders.length <= 50_000
    && candidate.orders.every(validOrder) && uniqueIds(candidate.orders)
    && Array.isArray(candidate.recipients) && candidate.recipients.length <= 50_000
    && candidate.recipients.every(validRecipient) && uniqueIds(candidate.recipients)
    && Array.isArray(candidate.collections) && candidate.collections.length <= 20_000
    && candidate.collections.every(validCollection) && uniqueIds(candidate.collections)
    && Array.isArray(candidate.notices) && candidate.notices.length <= 20_000
    && candidate.notices.every(validNotice) && uniqueIds(candidate.notices)
    && !!preferences && typeof preferences === "object" && !Array.isArray(preferences)
    && Object.keys(preferences).length <= 5_000
    && Object.entries(preferences).every(([id, preference]) => id.length <= 160 && record(preference))
    && Number.isSafeInteger(candidate.nextOrder) && Number.isSafeInteger(candidate.nextCollection);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validNewPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 128
    && /\p{L}/u.test(value)
    && /[0-9٠-٩]/.test(value)
    && /[^\p{L}\p{N}\s]/u.test(value);
}

async function mergeAdminDatabase(current: Database, submitted: Database, account: User): Promise<Database> {
  const previous = new Map(current.users.map((entry) => [entry.id, entry]));
  const users: User[] = [];
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const candidate of submitted.users) {
    const existing = previous.get(candidate.id);
    const email = candidate.email.trim().toLowerCase();
    const name = candidate.name.trim();
    const phone = normalizeAccountPhone(candidate.phone) ?? "";
    const store = candidate.store.trim();
    if (!validEmail(email)) throw new ApiRequestError("البريد الإلكتروني غير صحيح.", 400);
    if (emails.has(email)) throw new ApiRequestError("البريد الإلكتروني مسجل لحساب آخر.", 409);
    if (phone && phones.has(phone)) throw new ApiRequestError("رقم الجوال مسجل لحساب آخر.", 409);
    if (!name || !store || !/^05\d{8}$/.test(phone)) throw new ApiRequestError("تحقق من الاسم والمتجر ورقم الجوال.", 400);
    emails.add(email);
    phones.add(phone);

    if (existing) {
      users.push({
        ...existing,
        name,
        email,
        phone,
        store,
        ...(existing.role === "merchant" ? { membership: normalizeMembership(candidate.membership) } : {}),
      });
      continue;
    }

    if ((candidate.role !== "merchant" && candidate.role !== "courier") || !validNewPassword(candidate.password)) {
      throw new ApiRequestError("تعذّر إنشاء الحساب: تأكد من نوعه وكلمة المرور.", 400);
    }

    users.push({
      ...candidate,
      email,
      password: await hashPassword(candidate.password),
      ...(candidate.role === "merchant" ? { membership: normalizeMembership(candidate.membership) } : {}),
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

function mergeMerchantRecords<T extends { id: string; merchantId: string }>(
  current: T[],
  submitted: T[],
  userId: string,
  update: (candidate: T, existing?: T) => T,
  preserveMissing: (entry: T) => boolean = () => false,
): T[] {
  const others = current.filter((entry) => entry.merchantId !== userId);
  const currentMine = current.filter((entry) => entry.merchantId === userId);
  const existing = new Map(currentMine.map((entry) => [entry.id, entry]));
  if (submitted.some((entry) => entry.merchantId !== userId)) {
    throw new ApiRequestError("لا يمكنك تعديل بيانات تابعة لحساب آخر.", 403);
  }
  const foreignIds = new Set(others.map((entry) => entry.id));
  const submittedIds = new Set<string>();
  const mine = submitted.map((entry) => {
    if (foreignIds.has(entry.id) || submittedIds.has(entry.id)) {
      throw new ApiRequestError("معرّف السجل مستخدم بالفعل ولا يمكن تكراره.", 409);
    }
    submittedIds.add(entry.id);
    return update(entry, existing.get(entry.id));
  });
  const protectedMissing = currentMine.filter((entry) => !submittedIds.has(entry.id) && preserveMissing(entry));
  return [...mine, ...protectedMissing, ...others];
}

function mergeMerchantTrackingNote(existing: Order, candidate: Order, account: User): Order {
  const savedEventIds = new Set(getOrderTrackingEvents(existing).map((event) => event.id));
  const requested = Array.isArray(candidate.trackingEvents)
    ? candidate.trackingEvents.find((event) => event?.kind === "note" && !savedEventIds.has(event.id))
    : undefined;
  const note = typeof requested?.note === "string" ? requested.note.trim().slice(0, 500) : "";
  return note ? appendOrderTrackingNote(existing, account.name, note) : existing;
}

function isUnchangedRecipient(candidate: Recipient, existing: Recipient | undefined): existing is Recipient {
  if (!existing) return false;
  return candidate.id === existing.id
    && candidate.merchantId === existing.merchantId
    && candidate.name === existing.name
    && candidate.phone === existing.phone
    && (candidate.governorate ?? "") === (existing.governorate ?? "")
    && candidate.city === existing.city
    && candidate.address === existing.address
    && candidate.favorite === existing.favorite;
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
        ...existing,
        deleted: candidate.deleted === true,
        trackingEvents: trackedOrder.trackingEvents,
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
    const recipientName = candidate.recipientName.trim().slice(0, 120);
    const recipientPhone = normalizeAccountPhone(candidate.recipientPhone) ?? "";
    const city = candidate.city.trim().slice(0, 120);
    const address = candidate.address.trim().slice(0, 240);
    const amount = Number(candidate.amount);
    if (!recipientName || !recipientPhone || !city || !address || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
      throw new ApiRequestError("تحقق من اسم المستلم ورقمه وعنوانه وقيمة الطرد.", 400);
    }
    const deliveryFee = getDeliveryFee(region, savedAccount.membership) + weightFee + oversizeFee;
    const notes = typeof candidate.notes === "string" ? candidate.notes.trim().slice(0, 500) : "";
    const privateNotes = typeof candidate.privateNotes === "string" ? candidate.privateNotes.trim().slice(0, 1000) : "";
    return {
      ...candidate,
      merchantId: account.id,
      merchantName: savedAccount.name,
      merchantStore: savedAccount.store,
      trackingNumber: `ALX-${nextOrder++}`,
      recipientName,
      recipientPhone,
      governorate: candidate.governorate?.trim().slice(0, 120),
      city,
      address,
      pickupAddress: candidate.pickupAddress.trim().slice(0, 240),
      amount,
      content: candidate.content.trim().slice(0, 500),
      reference: candidate.reference.trim().slice(0, 120),
      type: candidate.type.trim().slice(0, 120) || "طرد عادي",
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
  }, (entry) => entry.status !== "draft");

  const recipients = mergeMerchantRecords<Recipient>(current.recipients, submitted.recipients, account.id, (candidate, existing) => {
    // Older saved recipients may predate the governorate field. Unrelated writes,
    // such as changing notification settings, must not reject or delete an
    // untouched legacy record. Any actual recipient change still goes through
    // the strict validation below.
    if (isUnchangedRecipient(candidate, existing)) return existing;

    const name = candidate.name.trim().slice(0, 120);
    const phone = normalizeAccountPhone(candidate.phone) ?? "";
    const governorate = candidate.governorate?.trim().slice(0, 120) ?? "";
    const city = candidate.city.trim().slice(0, 120);
    const address = candidate.address.trim().slice(0, 240);
    if (!name || !phone || !governorate || !city || !resolveDeliveryRegion(governorate, city)) {
      throw new ApiRequestError("بيانات المستلم المحفوظ غير صالحة.", 400);
    }
    return { ...candidate, merchantId: account.id, name, phone, governorate, city, address, favorite: candidate.favorite === true };
  });
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
  if (audience !== "all" && audience !== "merchants" && audience !== "couriers" && audience !== "premium" && audience !== "diamond" && audience !== "standard" && audience !== "user") return json({ error: "فئة مستلمي الإشعار غير صالحة." }, 400);
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
        || (audience === "diamond" && account.role === "merchant" && account.membership === "diamond")
        || (audience === "standard" && account.role === "merchant" && normalizeMembership(account.membership) === "standard")
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
  const assignedOrders = database.orders.filter((order) => (
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
  await enforceEndpointRateLimit(
    database,
    "account-delete",
    session.account.id,
    ACCOUNT_DELETE_ATTEMPT_LIMIT,
    ACCOUNT_DELETE_RATE_LIMIT_WINDOW,
    "محاولات كثيرة لحذف الحساب. انتظر عشر دقائق ثم حاول مجددًا.",
  );

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
      database.prepare("DELETE FROM almadina_session_devices WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_sessions WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_webauthn_credentials WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_passkey_login_credentials WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_webauthn_challenges WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_app_locks WHERE user_id = ?").bind(account.id),
      database.prepare("DELETE FROM almadina_password_reset_requests WHERE user_id = ?").bind(account.id),
    ]);
    return json({ success: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
  }

  return json({ error: "تم تحديث بيانات الحساب من جهاز آخر. راجع الشروط ثم حاول مجددًا." }, 409);
}

async function changeOwnPassword(database: D1Database, request: Request, session: AuthenticatedSession): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "بيانات تغيير كلمة المرور غير صالحة." }, 400);
  }
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return json({ error: "بيانات تغيير كلمة المرور غير صالحة." }, 400);
  }

  const payload = submitted as Record<string, unknown>;
  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  const confirmPassword = typeof payload.confirmPassword === "string" ? payload.confirmPassword : "";
  const signOutAllDevices = payload.signOutAllDevices !== false;

  if (!currentPassword || currentPassword.length > 256) return json({ error: "أدخل كلمة المرور الحالية." }, 400);
  if (newPassword !== confirmPassword) return json({ error: "تأكيد كلمة المرور الجديدة غير مطابق." }, 400);
  if (!validNewPassword(newPassword)) {
    return json({ error: "يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل وتحتوي على حرف ورقم ورمز." }, 400);
  }

  await enforcePasswordChangeRateLimit(database, session.account.id);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readState(database);
    const account = state.database.users.find((entry) => entry.id === session.account.id);
    if (!account) {
      return json({ error: "لم يعد الحساب متاحًا." }, 401, { "Set-Cookie": sessionCookie(request, "", 0) });
    }
    if (!await verifyPassword(currentPassword, account.password)) return json({ error: "كلمة المرور الحالية غير صحيحة." }, 403);
    if (currentPassword === newPassword || await verifyPassword(newPassword, account.password)) {
      return json({ error: "اختر كلمة مرور جديدة مختلفة عن الحالية." }, 400);
    }

    const password = await hashPassword(newPassword);
    const next: Database = {
      ...state.database,
      users: state.database.users.map((entry) => entry.id === account.id ? { ...entry, password } : entry),
    };
    const saved = await savePasswordChange(database, next, state.revision, account.id, session.token, signOutAllDevices, request);
    if (!saved.saved) continue;

    const nextState = { database: next, revision: state.revision + 1 };
    if (signOutAllDevices) {
      return json({ success: true, signedOut: true }, 200, cookieHeaders(
        sessionCookie(request, "", 0),
        passkeyLoginCookie(request, "", 0),
      ));
    }

    return json({ success: true, signedOut: false, ...snapshot(nextState, { ...account, password }) }, 200, {
      "Set-Cookie": sessionCookie(request, saved.replacementSessionToken!),
    });
  }

  return json({ error: "تم تحديث الحساب من جهاز آخر. حاول تغيير كلمة المرور مجددًا." }, 409);
}

function invalidPasswordResetCode(): Response {
  return json({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته." }, 422);
}

function invalidPasswordResetToken(request: Request): Response {
  return json(
    { error: "انتهت صلاحية طلب إعادة التعيين. ابدأ طلبًا جديدًا." },
    422,
    { "Set-Cookie": passwordResetCookie(request, "", 0) },
  );
}

async function requestPasswordReset(
  database: D1Database,
  request: Request,
  config: AlmadinaApiConfig,
): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "أدخل بريدًا إلكترونيًا صالحًا." }, 400);
  }
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return json({ error: "أدخل بريدًا إلكترونيًا صالحًا." }, 400);
  }

  const payload = submitted as Record<string, unknown>;
  const identifier = normalizeResetIdentifier(payload.identifier);
  if (!identifier) return json({ error: "أدخل البريد الإلكتروني المسجّل في حسابك." }, 400);
  if (!isPasswordResetDeliveryConfigured(config)) {
    return json({ error: "خدمة إرسال رموز التحقق غير مهيأة حاليًا. تواصل مع إدارة الموقع." }, 503);
  }

  await enforcePasswordResetRequestRateLimits(database, request, identifier);

  const state = await readState(database);
  const matches = state.database.users.filter((account) => account.email.trim().toLowerCase() === identifier);
  const account = matches.length === 1 ? matches[0] : null;
  const destination = account && validEmail(account.email.trim().toLowerCase())
    ? account.email.trim().toLowerCase()
    : null;

  const requestToken = randomSecret();
  const requestHash = await sha256(requestToken);
  const verificationCode = randomVerificationCode();
  const codeHash = await hashPasswordResetCode(requestToken, verificationCode);
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    database.prepare(`DELETE FROM almadina_password_reset_requests
      WHERE (verified_at IS NULL AND expires_at <= ?)
        OR (verified_at IS NOT NULL AND reset_expires_at <= ?)`)
      .bind(now, now),
  ];
  statements.push(database.prepare(`INSERT INTO almadina_password_reset_requests
    (request_hash, user_id, channel, code_hash, failed_attempts, expires_at, verified_at, reset_token_hash, reset_expires_at, created_at)
    VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, NULL, ?)`)
    .bind(requestHash, account && destination ? account.id : "", "email", codeHash, now + PASSWORD_RESET_CODE_DURATION, createdAt));
  await database.batch(statements);

  if (account && destination) {
    const delivery = deliverPasswordResetCode(config, {
      destination,
      code: verificationCode,
      expiresInMinutes: Math.floor(PASSWORD_RESET_CODE_DURATION / 60),
    }).catch(async (error) => {
      console.error("Password reset delivery failed.", error instanceof Error ? error.message : "Unknown delivery error.");
      await database.prepare(`UPDATE almadina_password_reset_requests
        SET user_id = '', code_hash = '', failed_attempts = ?, verified_at = NULL,
          reset_token_hash = NULL, reset_expires_at = NULL
        WHERE request_hash = ?`)
        .bind(PASSWORD_RESET_MAX_FAILED_ATTEMPTS, requestHash).run();
    });
    if (config.defer) config.defer(delivery);
    else await delivery;
  }

  return json({
    success: true,
    expiresIn: PASSWORD_RESET_CODE_DURATION,
    resendAfter: PASSWORD_RESET_RETRY_DELAY,
    message: "إذا كان البريد الإلكتروني مطابقًا لحساب مسجّل، فسيصل إليه رمز التحقق.",
  }, 202, { "Set-Cookie": passwordResetCookie(request, requestToken) });
}

async function verifyPasswordReset(database: D1Database, request: Request): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);
  }
  const code = submitted && typeof submitted === "object" && !Array.isArray(submitted)
    ? normalizeArabicDigits(String((submitted as Record<string, unknown>).code ?? "")).trim()
    : "";
  if (!/^\d{6}$/.test(code)) return json({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);

  const requestToken = getCookie(request, PASSWORD_RESET_COOKIE) ?? "";
  await enforcePasswordResetRateLimit(
    database,
    requestClientAddress(request),
    "verify-ip",
    PASSWORD_RESET_VERIFY_IP_LIMIT,
    PASSWORD_RESET_RATE_LIMIT_WINDOW,
  );
  if (!/^[\da-f]{64}$/i.test(requestToken)) return invalidPasswordResetCode();

  const requestHash = await sha256(requestToken);
  const row = await database.prepare(`SELECT request_hash, user_id, channel, code_hash, failed_attempts, expires_at,
    verified_at, reset_token_hash, reset_expires_at FROM almadina_password_reset_requests WHERE request_hash = ?`)
    .bind(requestHash).first<PasswordResetRow>();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expires_at <= now || row.verified_at !== null || row.failed_attempts >= PASSWORD_RESET_MAX_FAILED_ATTEMPTS) {
    return invalidPasswordResetCode();
  }

  const submittedCodeHash = await hashPasswordResetCode(requestToken, code);
  if (!equalIdentifier(submittedCodeHash, row.code_hash)) {
    await database.prepare(`UPDATE almadina_password_reset_requests
      SET failed_attempts = failed_attempts + 1
      WHERE request_hash = ? AND verified_at IS NULL AND expires_at > ? AND failed_attempts < ?`)
      .bind(requestHash, now, PASSWORD_RESET_MAX_FAILED_ATTEMPTS).run();
    return invalidPasswordResetCode();
  }
  if (!row.user_id) {
    await database.prepare("UPDATE almadina_password_reset_requests SET failed_attempts = ? WHERE request_hash = ?")
      .bind(PASSWORD_RESET_MAX_FAILED_ATTEMPTS, requestHash).run();
    return invalidPasswordResetCode();
  }

  const resetToken = randomSecret();
  const resetTokenHash = await sha256(resetToken);
  const resetExpiresAt = now + PASSWORD_RESET_TOKEN_DURATION;
  const verified = await database.prepare(`UPDATE almadina_password_reset_requests
    SET verified_at = ?, reset_token_hash = ?, reset_expires_at = ?, code_hash = '', failed_attempts = ?
    WHERE request_hash = ? AND user_id = ? AND code_hash = ? AND verified_at IS NULL
      AND expires_at > ? AND failed_attempts < ?
    RETURNING user_id`)
    .bind(
      now,
      resetTokenHash,
      resetExpiresAt,
      PASSWORD_RESET_MAX_FAILED_ATTEMPTS,
      requestHash,
      row.user_id,
      submittedCodeHash,
      now,
      PASSWORD_RESET_MAX_FAILED_ATTEMPTS,
    )
    .first<{ user_id: string }>();
  if (!verified) return invalidPasswordResetCode();

  return json(
    { success: true, expiresIn: PASSWORD_RESET_TOKEN_DURATION },
    200,
    { "Set-Cookie": passwordResetCookie(request, resetToken, PASSWORD_RESET_TOKEN_DURATION) },
  );
}

async function completePasswordReset(database: D1Database, request: Request): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "بيانات كلمة المرور الجديدة غير صالحة." }, 400);
  }
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return json({ error: "بيانات كلمة المرور الجديدة غير صالحة." }, 400);
  }
  const payload = submitted as Record<string, unknown>;
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  const confirmPassword = typeof payload.confirmPassword === "string" ? payload.confirmPassword : "";
  if (newPassword !== confirmPassword) return json({ error: "تأكيد كلمة المرور الجديدة غير مطابق." }, 400);
  if (!validNewPassword(newPassword)) {
    return json({ error: "يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل وتحتوي على حرف ورقم ورمز." }, 400);
  }

  const resetToken = getCookie(request, PASSWORD_RESET_COOKIE) ?? "";
  await enforcePasswordResetRateLimit(
    database,
    requestClientAddress(request),
    "complete-ip",
    PASSWORD_RESET_COMPLETE_IP_LIMIT,
    PASSWORD_RESET_RATE_LIMIT_WINDOW,
  );
  if (!/^[\da-f]{64}$/i.test(resetToken)) return invalidPasswordResetToken(request);

  const resetTokenHash = await sha256(resetToken);
  await enforcePasswordResetRateLimit(
    database,
    resetTokenHash,
    "complete-token",
    PASSWORD_RESET_MAX_FAILED_ATTEMPTS,
    PASSWORD_RESET_RATE_LIMIT_WINDOW,
  );
  const now = Math.floor(Date.now() / 1000);
  const reset = await database.prepare(`SELECT request_hash, user_id, channel, code_hash, failed_attempts, expires_at,
    verified_at, reset_token_hash, reset_expires_at FROM almadina_password_reset_requests
    WHERE reset_token_hash = ? AND verified_at IS NOT NULL AND reset_expires_at > ?`)
    .bind(resetTokenHash, now).first<PasswordResetRow>();
  if (!reset?.user_id) return invalidPasswordResetToken(request);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readState(database);
    const account = state.database.users.find((entry) => entry.id === reset.user_id);
    if (!account) return invalidPasswordResetToken(request);
    if (await verifyPassword(newPassword, account.password)) {
      return json({ error: "اختر كلمة مرور جديدة مختلفة عن الحالية." }, 400);
    }

    const password = await hashPassword(newPassword);
    const next: Database = {
      ...state.database,
      users: state.database.users.map((entry) => entry.id === account.id ? { ...entry, password } : entry),
    };
    if (!await savePasswordReset(database, next, state.revision, account.id, resetTokenHash)) continue;

    return json({ success: true, email: account.email }, 200, cookieHeaders(
      sessionCookie(request, "", 0),
      passkeyLoginCookie(request, "", 0),
      passwordResetCookie(request, "", 0),
    ));
  }

  return json({ error: "تم تحديث الحساب من جهاز آخر. حاول إكمال إعادة التعيين مجددًا." }, 409);
}

async function login(database: D1Database, request: Request): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
  }
  const payload = submitted && typeof submitted === "object" && !Array.isArray(submitted)
    ? submitted as Record<string, unknown>
    : {};
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 254) : "";
  const password = typeof payload.password === "string" ? payload.password.slice(0, 256) : "";
  await enforceEndpointRateLimit(
    database,
    "login-ip",
    requestClientAddress(request),
    LOGIN_REQUEST_IP_LIMIT,
    LOGIN_RATE_LIMIT_WINDOW,
    "محاولات تسجيل دخول كثيرة. انتظر بضع دقائق ثم حاول مجددًا.",
  );
  await enforceEndpointRateLimit(
    database,
    "login-identifier",
    email || "invalid",
    LOGIN_REQUEST_IDENTIFIER_LIMIT,
    LOGIN_RATE_LIMIT_WINDOW,
    "محاولات تسجيل دخول كثيرة. انتظر بضع دقائق ثم حاول مجددًا.",
  );
  let state = await readState(database);
  let account = state.database.users.find((entry) => entry.email.toLowerCase() === email);

  if (!account || !await verifyPassword(password, account.password)) {
    return json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
  }

  if (passwordHashNeedsUpgrade(account.password)) {
    const upgradedAccount = { ...account, password: await hashPassword(password) };
    const upgradedDatabase = { ...state.database, users: state.database.users.map((entry) => entry.id === account!.id ? upgradedAccount : entry) };
    if (await saveState(database, upgradedDatabase, state.revision)) {
      state = { database: upgradedDatabase, revision: state.revision + 1 };
      account = upgradedAccount;
    }
  }

  const token = await createSession(database, account.id, request);
  return json(snapshot(state, account), 200, { "Set-Cookie": sessionCookie(request, token) });
}

async function reverseGeocodeRegistrationAddress(
  database: D1Database,
  request: Request,
  config: AlmadinaApiConfig,
): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "بيانات نقطة الخريطة غير صالحة." }, 400);
  }
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return json({ error: "بيانات نقطة الخريطة غير صالحة." }, 400);
  }

  const payload = submitted as Record<string, unknown>;
  const latitude = Math.round(Number(payload.latitude) * 1_000_000) / 1_000_000;
  const longitude = Math.round(Number(payload.longitude) * 1_000_000) / 1_000_000;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 29.35 || latitude > 33.55 || longitude < 34.1 || longitude > 35.95) {
    return json({ error: "اختر نقطة داخل نطاق التوصيل على الخريطة." }, 400);
  }
  if (!isReverseGeocodingConfigured(config)) {
    return json({ error: "التعبئة التلقائية للعناوين غير مهيأة حاليًا. يمكنك اختيار المدينة والمنطقة والشارع يدويًا." }, 503);
  }

  await enforceReverseGeocodeRateLimit(database, request);
  try {
    const address = await reverseGeocode(config, { latitude, longitude });
    return json({ success: true, address });
  } catch (error) {
    console.error("Reverse geocoding failed.", error instanceof Error ? error.message : "Unknown reverse geocoding error.");
    return json({ error: "تعذّر قراءة العنوان من الخريطة. ثبّت النقطة وأكمل المدينة والمنطقة والشارع يدويًا." }, 502);
  }
}

async function requestRegistration(
  database: D1Database,
  request: Request,
  config: AlmadinaApiConfig,
): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "بيانات إنشاء الحساب غير صالحة." }, 400);
  }
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return json({ error: "بيانات إنشاء الحساب غير صالحة." }, 400);
  }

  const payload = submitted as Record<string, unknown>;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const phone = normalizeAccountPhone(typeof payload.phone === "string" ? payload.phone : "") ?? "";
  const store = typeof payload.store === "string" ? payload.store.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const submittedGovernorate = typeof payload.governorate === "string" ? payload.governorate.trim() : "";
  const city = typeof payload.city === "string" ? payload.city.trim() : "";
  const address = typeof payload.address === "string" ? payload.address.trim() : "";
  const submittedLatitude = typeof payload.latitude === "number" ? payload.latitude : Number.NaN;
  const submittedLongitude = typeof payload.longitude === "number" ? payload.longitude : Number.NaN;
  const locationMethod = payload.locationMethod === "manual" ? "manual" : "map";
  const latitude = locationMethod === "manual" ? 0 : Math.round(submittedLatitude * 1_000_000) / 1_000_000;
  const longitude = locationMethod === "manual" ? 0 : Math.round(submittedLongitude * 1_000_000) / 1_000_000;
  const password = typeof payload.password === "string" ? payload.password : "";
  const acceptedTerms = payload.acceptedTerms === true;

  if (name.length < 2 || name.length > 120) return json({ error: "أدخل الاسم الكامل بصورة صحيحة." }, 400);
  if (!/^05\d{8}$/.test(phone)) return json({ error: "أدخل رقم جوال مكوّنًا من 10 أرقام ويبدأ بـ 05." }, 400);
  if (!store || store.length > 120) return json({ error: "أدخل اسم المتجر بصورة صحيحة." }, 400);
  if (!validEmail(email) || email.length > 254) return json({ error: "أدخل بريدًا إلكترونيًا صحيحًا." }, 400);
  if (!submittedGovernorate || !city || submittedGovernorate.length > 120 || city.length > 120) {
    return json({ error: "أدخل المدينة والمنطقة بصورة صحيحة." }, 400);
  }
  const namedGovernorate = resolveDeliveryRegion(submittedGovernorate);
  const cityRegion = resolveDeliveryRegion("", city);
  if (namedGovernorate && cityRegion && namedGovernorate.name !== cityRegion.name) {
    return json({ error: "المدينة والمنطقة المدخلتان غير متطابقتين." }, 400);
  }
  const governorate = namedGovernorate?.name ?? submittedGovernorate;
  if (address.length < 2 || address.length > 180) return json({ error: "أدخل اسم الشارع أو وصف العنوان بصورة صحيحة." }, 400);
  if (locationMethod === "map" && (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 29.35 || latitude > 33.55 || longitude < 34.1 || longitude > 35.95)) {
    return json({ error: "حدد موقعًا داخل نطاق التوصيل على الخريطة." }, 400);
  }
  if (!validNewPassword(password)) {
    return json({ error: "يجب أن تحتوي كلمة المرور على 8 أحرف على الأقل وحرف ورقم ورمز." }, 400);
  }
  if (!acceptedTerms) return json({ error: "يجب الموافقة على شروط الاستخدام وسياسة الخصوصية للمتابعة." }, 400);
  if (!isPasswordResetDeliveryConfigured(config)) {
    return json({ error: "خدمة إرسال رموز التحقق غير مهيأة حاليًا. تواصل مع إدارة الموقع." }, 503);
  }

  const state = await readState(database);
  if (state.database.users.some((entry) => entry.email.trim().toLowerCase() === email)) {
    return json({ error: "يوجد حساب مسجل بهذا البريد الإلكتروني." }, 409);
  }
  if (state.database.users.some((entry) => normalizeAccountPhone(entry.phone) === phone)) {
    return json({ error: "يوجد حساب مسجل برقم الجوال هذا." }, 409);
  }

  await enforceRegistrationRequestRateLimits(database, request, email);

  const requestToken = randomSecret();
  const requestHash = await sha256(requestToken);
  const verificationCode = randomVerificationCode();
  const codeHash = await hashPasswordResetCode(requestToken, verificationCode);
  const passwordHash = await hashPassword(password);
  const now = Math.floor(Date.now() / 1000);
  const createdAt = new Date().toISOString();
  await database.batch([
    database.prepare(`DELETE FROM almadina_registration_locations WHERE request_hash IN
      (SELECT request_hash FROM almadina_registration_requests WHERE expires_at <= ?)`).bind(now),
    database.prepare(`DELETE FROM almadina_registration_locations WHERE request_hash IN
      (SELECT request_hash FROM almadina_registration_requests WHERE email = ? OR phone = ?)`).bind(email, phone),
    database.prepare("DELETE FROM almadina_registration_requests WHERE expires_at <= ?").bind(now),
    database.prepare("DELETE FROM almadina_registration_requests WHERE email = ? OR phone = ?").bind(email, phone),
    database.prepare(`INSERT INTO almadina_registration_requests
      (request_hash, email, name, phone, store, password_hash, code_hash, failed_attempts, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .bind(requestHash, email, name, phone, store, passwordHash, codeHash, now + REGISTRATION_CODE_DURATION, createdAt),
    database.prepare(`INSERT INTO almadina_registration_locations
      (request_hash, governorate, city, address, latitude, longitude, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(requestHash, governorate, city, address, latitude, longitude, createdAt),
  ]);

  try {
    await deliverRegistrationVerificationCode(config, {
      destination: email,
      code: verificationCode,
      expiresInMinutes: Math.floor(REGISTRATION_CODE_DURATION / 60),
    });
  } catch (error) {
    console.error("Registration verification delivery failed.", error instanceof Error ? error.message : "Unknown delivery error.");
    await database.batch([
      database.prepare("DELETE FROM almadina_registration_locations WHERE request_hash = ?").bind(requestHash),
      database.prepare("DELETE FROM almadina_registration_requests WHERE request_hash = ?").bind(requestHash),
    ]);
    return json({ error: "تعذّر إرسال رمز التحقق إلى بريدك. تحقق من إعدادات البريد ثم حاول مجددًا." }, 502);
  }

  return json({
    success: true,
    expiresIn: REGISTRATION_CODE_DURATION,
    resendAfter: REGISTRATION_RETRY_DELAY,
    email,
  }, 202, { "Set-Cookie": registrationCookie(request, requestToken) });
}

function invalidRegistrationCode(): Response {
  return json({ error: "رمز التحقق غير صحيح أو انتهت صلاحيته." }, 422);
}

async function verifyRegistration(database: D1Database, request: Request): Promise<Response> {
  let submitted: unknown;
  try {
    submitted = await request.json();
  } catch {
    return json({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);
  }
  const code = submitted && typeof submitted === "object" && !Array.isArray(submitted)
    ? normalizeArabicDigits(String((submitted as Record<string, unknown>).code ?? "")).trim()
    : "";
  if (!/^\d{6}$/.test(code)) return json({ error: "أدخل رمز التحقق المكوّن من 6 أرقام." }, 400);

  await enforceRegistrationRateLimit(
    database,
    requestClientAddress(request),
    "verify-ip",
    REGISTRATION_VERIFY_IP_LIMIT,
    REGISTRATION_RATE_LIMIT_WINDOW,
  );
  const requestToken = getCookie(request, REGISTRATION_COOKIE) ?? "";
  if (!/^[\da-f]{64}$/i.test(requestToken)) return invalidRegistrationCode();

  const requestHash = await sha256(requestToken);
  const row = await database.prepare(`SELECT request_hash, email, name, phone, store, password_hash,
    code_hash, failed_attempts, expires_at, created_at
    FROM almadina_registration_requests WHERE request_hash = ?`)
    .bind(requestHash).first<RegistrationRequestRow>();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.expires_at <= now || row.failed_attempts >= REGISTRATION_MAX_FAILED_ATTEMPTS) {
    return invalidRegistrationCode();
  }
  const location = await database.prepare(`SELECT request_hash, governorate, city, address, latitude, longitude, created_at
    FROM almadina_registration_locations WHERE request_hash = ?`)
    .bind(requestHash).first<RegistrationLocationRow>();
  if (!location) return invalidRegistrationCode();

  const submittedCodeHash = await hashPasswordResetCode(requestToken, code);
  if (!equalIdentifier(submittedCodeHash, row.code_hash)) {
    await database.prepare(`UPDATE almadina_registration_requests
      SET failed_attempts = failed_attempts + 1
      WHERE request_hash = ? AND expires_at > ? AND failed_attempts < ?`)
      .bind(requestHash, now, REGISTRATION_MAX_FAILED_ATTEMPTS).run();
    return invalidRegistrationCode();
  }

  const account: User = {
    id: uid("merchant"),
    name: row.name,
    phone: row.phone,
    store: row.store,
    governorate: location.governorate,
    city: location.city,
    address: location.address,
    ...(location.latitude === 0 && location.longitude === 0 ? {} : {
      latitude: location.latitude,
      longitude: location.longitude,
    }),
    email: row.email,
    password: row.password_hash,
    role: "merchant",
    membership: "standard",
    joinedAt: new Date().toISOString(),
    avatarColor: "#187a50",
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await readState(database);
    if (state.database.users.some((entry) => (
      entry.email.trim().toLowerCase() === row.email
      || normalizeAccountPhone(entry.phone) === row.phone
    ))) {
      await database.batch([
        database.prepare("DELETE FROM almadina_registration_locations WHERE request_hash = ?").bind(requestHash),
        database.prepare("DELETE FROM almadina_registration_requests WHERE request_hash = ?").bind(requestHash),
      ]);
      return json(
        { error: "تم تسجيل حساب بهذه البيانات أثناء التحقق. سجّل الدخول أو استخدم بيانات أخرى." },
        409,
        { "Set-Cookie": registrationCookie(request, "", 0) },
      );
    }

    const next = { ...state.database, users: [...state.database.users, account] };
    const saved = await saveVerifiedRegistration(database, next, state.revision, requestHash, submittedCodeHash, account.id, request);
    if (!saved.saved || !saved.sessionToken) continue;
    return json(snapshot({ database: next, revision: state.revision + 1 }, account), 201, cookieHeaders(
      sessionCookie(request, saved.sessionToken),
      registrationCookie(request, "", 0),
    ));
  }

  return json({ error: "تعذّر حفظ الحساب بسبب تحديث متزامن. حاول إدخال الرمز مجددًا." }, 409);
}

function legacyRegistrationEndpoint(request: Request): Response {
  return json(
    { error: "أكمل خطوات إنشاء الحساب ثم أكّد بريدك الإلكتروني بالرمز المرسل." },
    410,
    { "Set-Cookie": registrationCookie(request, "", 0) },
  );
}

async function publicTracking(database: D1Database, request: Request): Promise<Response> {
  const trackingNumber = new URL(request.url).searchParams.get("tracking")?.trim().toUpperCase() ?? "";
  if (!/^ALX-\d{6,20}$/.test(trackingNumber)) return json({ error: "أدخل رقم تتبع صحيحًا." }, 400);
  await enforceEndpointRateLimit(
    database,
    "public-tracking-ip",
    requestClientAddress(request),
    PUBLIC_TRACKING_REQUEST_IP_LIMIT,
    PUBLIC_TRACKING_RATE_LIMIT_WINDOW,
    "طلبات تتبع كثيرة. انتظر بضع دقائق ثم حاول مجددًا.",
  );

  const state = await readState(database);
  const order = state.database.orders.find((entry) => entry.trackingNumber.toUpperCase() === trackingNumber && !entry.deleted);
  if (!order) return json({ error: "لم نعثر على طرد بهذا الرقم." }, 404);

  const trackingEvents = getOrderTrackingEvents(order).filter((event) => event.kind !== "note").map((event) => {
    const safeEvent = createTrackingEvent(event.status, "فريق المدينة إكسبرس", { createdAt: event.createdAt });
    return { ...safeEvent, id: event.id };
  });
  const { status, createdAt, updatedAt } = order;
  return json({ order: { id: `public-${order.trackingNumber}`, trackingNumber: order.trackingNumber, status, createdAt, updatedAt, trackingEvents } });
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
  await enforceEndpointRateLimit(
    database,
    "courier-order-scan",
    session.account.id,
    COURIER_SCAN_ATTEMPT_LIMIT,
    COURIER_SCAN_RATE_LIMIT_WINDOW,
    "محاولات مسح كثيرة. انتظر عشر دقائق ثم حاول مجددًا.",
  );

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
  if (session.account.role !== "admin" && session.account.role !== "courier") {
    return json({ error: "هذه العملية متاحة للمسؤول أو الموظف فقط." }, 403);
  }

  const payload = await request.json() as { invoiceId?: string; verificationCode?: string };
  const invoiceId = payload.invoiceId?.trim() ?? "";
  const verificationCode = payload.verificationCode?.trim() ?? "";
  if (!invoiceId || !/^\d{4}$/.test(verificationCode)) {
    return json({ error: "أدخل كود تحقق صحيحًا من 4 أرقام." }, 400);
  }
  await enforceCollectionVerificationRateLimit(database, session.account.id, invoiceId, session.account.role === "courier");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = attempt === 0 ? session.state : await readState(database);
    const employee = state.database.users.find((account) => account.id === session.account.id);
    if (!employee || (employee.role !== "admin" && employee.role !== "courier")) return json({ error: "لم تعد صلاحية الموظف متاحة." }, 403);

    const invoice = state.database.collections.find((entry) => entry.id === invoiceId);
    const courierInvalidMessage = "رقم الفاتورة أو كود التحقق غير صحيح.";
    if (!invoice) return employee.role === "courier"
      ? json({ error: courierInvalidMessage }, 422)
      : json({ error: "فاتورة التحصيل غير موجودة." }, 404);
    if (employee.role === "courier" && invoice.verificationCode !== verificationCode) {
      return json({ error: courierInvalidMessage }, 422);
    }
    if (invoice.status === "paid") return json({ error: "تم تسليم هذه الفاتورة مسبقًا." }, 409);
    if (invoice.status !== "ready") return json({ error: "يجب تجهيز الفاتورة قبل قراءة كود التحقق." }, 409);
    if (employee.role === "admin" && invoice.verificationCode !== verificationCode) {
      return json({ error: "كود التحقق غير صحيح." }, 422);
    }

    const now = new Date().toISOString();
    const next: Database = {
      ...state.database,
      collections: state.database.collections.map((entry) => entry.id === invoice.id ? {
        ...entry,
        status: "paid",
        paidAt: now,
        verifiedAt: now,
        verifiedById: employee.id,
        verifiedByName: employee.name,
        updatedAt: now,
      } : entry),
      notices: [{
        id: uid("notice"),
        userId: invoice.merchantId,
        title: "تم تسليم التحصيل",
        message: `تحقق الموظف من كود الفاتورة ${invoice.invoiceNumber} وأصبحت حالة الفاتورة «تم التسليم».`,
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

export async function handleAlmadinaApi(request: Request, database: D1Database, config: AlmadinaApiConfig = {}): Promise<Response> {
  try {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && origin !== url.origin) return json({ error: "مصدر الطلب غير مسموح." }, 403);
    const validatedRequest = await validateApiRequestEnvelope(request);
    if (validatedRequest instanceof Response) return validatedRequest;
    request = validatedRequest;

    await ensureDatabase(database, config);

    if (url.pathname === "/api/almadina/login" && request.method === "POST") return await login(database, request);
    if (url.pathname === "/api/almadina/geocode/reverse" && request.method === "POST") return await reverseGeocodeRegistrationAddress(database, request, config);
    if (url.pathname === "/api/almadina/register/request" && request.method === "POST") return await requestRegistration(database, request, config);
    if (url.pathname === "/api/almadina/register/verify" && request.method === "POST") return await verifyRegistration(database, request);
    if (url.pathname === "/api/almadina/register" && request.method === "POST") return legacyRegistrationEndpoint(request);
    if (url.pathname === "/api/almadina/password-reset/request" && request.method === "POST") return await requestPasswordReset(database, request, config);
    if (url.pathname === "/api/almadina/password-reset/verify" && request.method === "POST") return await verifyPasswordReset(database, request);
    if (url.pathname === "/api/almadina/password-reset/complete" && request.method === "POST") return await completePasswordReset(database, request);
    if (url.pathname === "/api/almadina/passkey/login/options" && request.method === "POST") return await publicPasskeyLoginOptions(database, request);
    if (url.pathname === "/api/almadina/passkey/login/verify" && request.method === "POST") return await verifyPublicPasskeyLogin(database, request);
    if (url.pathname === "/api/almadina/track" && request.method === "GET") return await publicTracking(database, request);

    const session = await authenticate(database, request);

    if (url.pathname === "/api/almadina/logout" && request.method === "POST") {
      if (session) {
        await database.batch([
          database.prepare("DELETE FROM almadina_session_devices WHERE token_hash = ?").bind(session.tokenHash),
          database.prepare("DELETE FROM almadina_sessions WHERE token_hash = ?").bind(session.tokenHash),
        ]);
      }
      return json({ success: true }, 200, cookieHeaders(
        sessionCookie(request, "", 0),
        passkeyLoginCookie(request, "", 0),
      ));
    }

    if (!session) return json({ error: "يجب تسجيل الدخول أولًا." }, 401, { "Set-Cookie": sessionCookie(request, "", 0) });

    if (url.pathname === "/api/almadina/security/devices" && request.method === "GET") {
      return await linkedDevicesResponse(database, session);
    }

    if (url.pathname === "/api/almadina/security/devices/revoke" && request.method === "POST") {
      return await revokeLinkedDevice(database, request, session);
    }

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

    if (url.pathname === "/api/almadina/account/password" && request.method === "POST") {
      return await changeOwnPassword(database, request, session);
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
      if (JSON.stringify(payload.database).length > MAX_API_BODY_BYTES) return json({ error: "حجم بيانات الحفظ أكبر من الحد المسموح." }, 413);

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
