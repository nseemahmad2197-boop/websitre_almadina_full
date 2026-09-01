import { appendOrderTrackingEvent, appendOrderTrackingNote, createSeedDatabase, createTrackingEvent, getDeliveryFee, getOrderDimensions, getOrderOversizeFee, getOrderTrackingEvents, governorates, removeLegacyDemoData, resolveDeliveryRegion, uid, type CollectionInvoice, type Database, type Notice, type Order, type Preferences, type Recipient, type User } from "./data";

const SESSION_COOKIE = "almadina_session";
const SESSION_DURATION = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 100_000;
const initializedDatabases = new WeakMap<D1Database, Promise<void>>();

type StateRow = { payload: string; revision: number };
type SessionRow = { user_id: string; expires_at: number };
type StoredState = { database: Database; revision: number };
type AuthenticatedSession = { account: User; state: StoredState; token: string };

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
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

function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name === SESSION_COOKIE) return parts.join("=") || null;
  }
  return null;
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_DURATION): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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
    const oversizeFee = getOrderOversizeFee(candidate);
    const region = resolveDeliveryRegion(candidate.governorate ?? "", candidate.city) ?? governorates[0];
    const deliveryFee = getDeliveryFee(region, savedAccount.membership) + oversizeFee;
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

    await database.prepare("DELETE FROM almadina_sessions WHERE user_id = ?").bind(account.id).run();
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

    if (url.pathname === "/api/almadina/login" && request.method === "POST") return login(database, request);
    if (url.pathname === "/api/almadina/register" && request.method === "POST") return register(database, request);
    if (url.pathname === "/api/almadina/track" && request.method === "GET") return publicTracking(database, request);

    const session = await authenticate(database, request);

    if (url.pathname === "/api/almadina/logout" && request.method === "POST") {
      if (session) await database.prepare("DELETE FROM almadina_sessions WHERE token_hash = ?").bind(await sha256(session.token)).run();
      return json({ success: true }, 200, { "Set-Cookie": sessionCookie(request, "", 0) });
    }

    if (!session) return json({ error: "يجب تسجيل الدخول أولًا." }, 401, { "Set-Cookie": sessionCookie(request, "", 0) });

    if (url.pathname === "/api/almadina/notices/broadcast" && request.method === "POST") {
      return broadcastNotice(database, request, session);
    }

    if (url.pathname === "/api/almadina/notices/clear" && request.method === "POST") {
      return clearNotices(database, request, session);
    }

    if (url.pathname === "/api/almadina/account/delete" && request.method === "POST") {
      return deleteOwnAccount(database, request, session);
    }

    if (url.pathname === "/api/almadina/collections/verify" && request.method === "POST") {
      return verifyCollection(database, request, session);
    }

    if (url.pathname === "/api/almadina/orders/scan" && request.method === "POST") {
      return shipScannedOrder(database, request, session);
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
