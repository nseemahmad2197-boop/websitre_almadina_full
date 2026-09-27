import type { Database, Order, User } from "./data";
import { FOLLOWUP_LIMITS, FOLLOWUP_MIME_TYPES, FOLLOWUP_STATUSES, FOLLOWUP_TYPES, type Followup, type FollowupAttachment, type FollowupCustomer, type FollowupCustomerList, type FollowupStatus, type FollowupType } from "./followups";

const UPLOAD_TTL_SECONDS = 24 * 60 * 60;
const PENDING_BYTES = 50 * 1024 * 1024;
const PENDING_FILES = 20;
const PAGE_SIZE = 50;
export class FollowupRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "FollowupRequestError"; }
}
type TicketRow = { id: string; order_id: string; creator_id: string; merchant_id: string; request_id: string; payload: string; created_at: string };
type UploadRow = {
  id: string; owner_id: string; merchant_id: string; request_id: string; order_id: string;
  name: string; mime_type: string; size: number; chunk_count: number; expires_at: number; followup_id: string | null;
};
type ChunkRow = { chunk_index: number; data_base64: string; raw_size: number };
export type FollowupContext = {
  database: D1Database; account: User; state: Database;
  rateLimit: (namespace: string, limit: number, windowSeconds: number) => Promise<void>;
  notify?: (followup: Followup, changed: boolean) => Promise<void>;
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const fail = (message: string, status = 400): never => { throw new FollowupRequestError(message, status); };
const cleanString = (value: unknown, max: number, field: string): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return fail(`بيانات ${field} غير صالحة.`);
  return value.trim();
};
const requestId = (value: unknown) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) return fail("معرّف الطلب غير صالح.");
  return value;
};
const attachment = (row: UploadRow): FollowupAttachment => ({ id: row.id, name: row.name, mimeType: row.mime_type, size: row.size, chunkCount: row.chunk_count });
const canAccess = (account: User, order: Order) => !order.deleted && (account.role === "admin" || account.role === "courier" || (account.role === "merchant" && order.merchantId === account.id));
function authorizedOrder(context: FollowupContext, orderId: unknown): Order {
  const order = typeof orderId === "string" ? context.state.orders.find((item) => item.id === orderId) : undefined;
  if (!order || !canAccess(context.account, order)) return fail("الطرد غير موجود أو غير متاح لهذا الحساب.", 404);
  return order;
}
function wireFollowup(context: FollowupContext, row: TicketRow): Followup {
  const order = authorizedOrder(context, row.order_id);
  // Derive ownership from the current parcel, including for legacy ticket payloads.
  return { ...JSON.parse(row.payload) as Followup, merchantId: order.merchantId };
}
function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("بيانات الطلب غير صالحة.");
  return value as Record<string, unknown>;
}
async function stableId(prefix: string, owner: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([owner, value])));
  return `${prefix}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
export function followupSchema(database: D1Database): D1PreparedStatement[] {
  return [
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_owners (user_id TEXT PRIMARY KEY NOT NULL, lock_version INTEGER NOT NULL DEFAULT 0)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followups (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, creator_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
      request_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (creator_id, request_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followups_order_idx ON almadina_followups (order_id, created_at, id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followups_page_idx ON almadina_followups (created_at, id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_uploads (
      id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, merchant_id TEXT NOT NULL, request_id TEXT NOT NULL,
      order_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL, expires_at INTEGER NOT NULL, followup_id TEXT,
      UNIQUE (owner_id, request_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followup_uploads_owner_idx ON almadina_followup_uploads (owner_id, followup_id, expires_at)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followup_uploads_expiry_idx ON almadina_followup_uploads (expires_at, followup_id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_chunks (
      upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data_base64 TEXT NOT NULL, raw_size INTEGER NOT NULL,
      PRIMARY KEY (upload_id, chunk_index)
    )`),
  ];
}
/** Run with the existing credential purge when an account is actually deleted. */
export function followupAccountPurge(database: D1Database, account: User): D1PreparedStatement[] {
  const condition = "owner_id = ? OR merchant_id = ? OR followup_id IN (SELECT id FROM almadina_followups WHERE creator_id = ? OR merchant_id = ?)";
  const values = [account.id, account.id, account.id, account.id];
  return [
    database.prepare(`DELETE FROM almadina_followup_chunks WHERE upload_id IN (SELECT id FROM almadina_followup_uploads WHERE ${condition})`).bind(...values),
    database.prepare(`DELETE FROM almadina_followup_uploads WHERE ${condition}`).bind(...values),
    database.prepare("DELETE FROM almadina_followups WHERE creator_id = ? OR merchant_id = ?").bind(account.id, account.id),
    database.prepare("DELETE FROM almadina_followup_owners WHERE user_id = ?").bind(account.id),
  ];
}
async function sweepExpiredUploads(database: D1Database): Promise<void> {
  // A grace period keeps cleanup separate from a just-expired upload finalization.
  const before = nowSeconds() - 60;
  await database.batch([
    database.prepare("DELETE FROM almadina_followup_chunks WHERE upload_id IN (SELECT id FROM almadina_followup_uploads WHERE followup_id IS NULL AND expires_at <= ?)").bind(before),
    database.prepare("DELETE FROM almadina_followup_uploads WHERE followup_id IS NULL AND expires_at <= ?").bind(before),
  ]);
}
async function ownerLock(database: D1Database, ownerId: string): Promise<D1PreparedStatement> {
  await database.prepare("INSERT INTO almadina_followup_owners (user_id, lock_version) VALUES (?, 0) ON CONFLICT (user_id) DO NOTHING").bind(ownerId).run();
  // The first statement in each batch serializes reservations/finalizations for this
  // account on PostgreSQL; D1 already serializes each atomic batch.
  return database.prepare("UPDATE almadina_followup_owners SET lock_version = lock_version + 1 WHERE user_id = ?").bind(ownerId);
}
function validBase64(value: unknown, size: number): Uint8Array {
  if (typeof value !== "string" || value.length !== 4 * Math.ceil(size / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return fail("بيانات المرفق غير صالحة.");
  try {
    const binary = atob(value);
    if (binary.length !== size || btoa(binary) !== value) return fail("حجم جزء المرفق غير صحيح.");
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch { return fail("بيانات المرفق غير صالحة."); }
}
/** Reject active document formats and files whose container differs from its declared MIME. */
export function validFollowupMediaSignature(mime: string, bytes: Uint8Array): boolean {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(text(0, 6));
  if (mime === "image/webp") return text(0, 4) === "RIFF" && text(8, 4) === "WEBP";
  if (mime === "audio/wav" || mime === "audio/x-wav") return text(0, 4) === "RIFF" && text(8, 4) === "WAVE";
  if (mime.endsWith("/webm")) return starts(0x1a, 0x45, 0xdf, 0xa3) && text(0, Math.min(4096, bytes.length)).includes("webm");
  if (mime.endsWith("/ogg")) return text(0, 4) === "OggS";
  if (mime === "audio/mpeg") return text(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/aac") return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (mime === "image/heic" || mime === "image/heif") return text(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(text(8, 4));
  if (["video/mp4", "video/quicktime", "audio/mp4", "audio/x-m4a", "audio/3gpp", "audio/3gpp2", "video/3gpp", "video/3gpp2"].includes(mime)) {
    return (text(4, 4) === "ftyp" && /^(isom|iso[2-9]|mp4[12]|avc1|M4[AVBP] |qt  |3g[p2][0-9a-z]|MSNV|dash)$/.test(text(8, 4)))
      || (mime === "video/quicktime" && ["wide", "moov", "mdat"].includes(text(4, 4)));
  }
  return false;
}
async function uploadForOwner(context: FollowupContext, id: string): Promise<UploadRow> {
  const upload = await context.database.prepare("SELECT * FROM almadina_followup_uploads WHERE id = ? AND owner_id = ?").bind(id, context.account.id).first<UploadRow>();
  if (!upload) return fail("المرفق غير موجود.", 404);
  authorizedOrder(context, upload.order_id);
  return upload;
}
async function beginUpload(context: FollowupContext, body: Record<string, unknown>): Promise<unknown> {
  const order = authorizedOrder(context, body.orderId);
  const token = requestId(body.requestId);
  const name = cleanString(body.name, 180, "اسم المرفق").replace(/[\\/]/g, "_");
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  if (!(FOLLOWUP_MIME_TYPES as readonly string[]).includes(mimeType)) return fail("نوع المرفق غير مدعوم.", 415);
  const size = body.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > FOLLOWUP_LIMITS.fileBytes) return fail("الحد الأقصى لحجم المرفق 10 ميغابايت.", 413);
  const chunkCount = Math.ceil(size / FOLLOWUP_LIMITS.chunkBytes);
  if (body.chunkCount !== chunkCount) return fail("عدد أجزاء المرفق غير صحيح.");
  const id = await stableId("fu-upload", context.account.id, token);
  const prior = await context.database.prepare("SELECT * FROM almadina_followup_uploads WHERE id = ?").bind(id).first<UploadRow>();
  if (prior) {
    if (prior.order_id !== order.id || prior.name !== name || prior.mime_type !== mimeType || prior.size !== size || prior.chunk_count !== chunkCount) return fail("معرّف الرفع مستخدم لمرفق مختلف.", 409);
    if (!prior.followup_id && prior.expires_at <= nowSeconds()) return fail("انتهت صلاحية رفع المرفق. أعد اختيار الملف.", 410);
    return { uploadId: id, chunkSize: FOLLOWUP_LIMITS.chunkBytes };
  }
  await context.rateLimit("followup-upload", 30, 3600);
  await sweepExpiredUploads(context.database);
  const now = nowSeconds();
  await context.database.batch([
    await ownerLock(context.database, context.account.id),
    context.database.prepare(`INSERT INTO almadina_followup_uploads
      (id, owner_id, merchant_id, request_id, order_id, name, mime_type, size, chunk_count, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT COUNT(*) FROM almadina_followup_uploads WHERE owner_id = ? AND followup_id IS NULL AND expires_at > ?) < ?
      AND (SELECT COALESCE(SUM(size), 0) FROM almadina_followup_uploads WHERE owner_id = ? AND followup_id IS NULL AND expires_at > ?) + ? <= ?
      ON CONFLICT (id) DO NOTHING`).bind(id, context.account.id, order.merchantId, token, order.id, name, mimeType, size, chunkCount, now + UPLOAD_TTL_SECONDS,
        context.account.id, now, PENDING_FILES, context.account.id, now, size, PENDING_BYTES),
  ]);
  const saved = await context.database.prepare("SELECT * FROM almadina_followup_uploads WHERE id = ?").bind(id).first<UploadRow>();
  if (!saved) return fail("وصلت للحد المسموح للمرفقات غير المرسلة. أكمل المتابعات أو حاول لاحقًا.", 429);
  if (saved.order_id !== order.id || saved.name !== name || saved.mime_type !== mimeType || saved.size !== size) return fail("معرّف الرفع مستخدم لمرفق مختلف.", 409);
  return { uploadId: id, chunkSize: FOLLOWUP_LIMITS.chunkBytes };
}
async function putChunk(context: FollowupContext, uploadId: string, body: Record<string, unknown>): Promise<unknown> {
  const upload = await uploadForOwner(context, uploadId);
  if (!upload.followup_id && upload.expires_at <= nowSeconds()) return fail("انتهت صلاحية رفع المرفق. أعد اختيار الملف.", 410);
  const index = body.index;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= upload.chunk_count) return fail("رقم جزء المرفق غير صالح.");
  const expectedSize = Math.min(FOLLOWUP_LIMITS.chunkBytes, upload.size - index * FOLLOWUP_LIMITS.chunkBytes);
  const bytes = validBase64(body.dataBase64, expectedSize);
  if (index === 0 && !validFollowupMediaSignature(upload.mime_type, bytes)) return fail("محتوى المرفق لا يطابق نوع الملف.", 415);
  await context.rateLimit("followup-chunk", 600, 3600);
  if (upload.followup_id) {
    const prior = await context.database.prepare("SELECT data_base64 FROM almadina_followup_chunks WHERE upload_id = ? AND chunk_index = ?").bind(uploadId, index).first<{ data_base64: string }>();
    if (!prior || prior.data_base64 !== body.dataBase64) return fail("المرفق محفوظ ولا يمكن تعديله.", 409);
    return { ok: true };
  }
  await context.database.prepare(`INSERT INTO almadina_followup_chunks (upload_id, chunk_index, data_base64, raw_size)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT id FROM almadina_followup_uploads WHERE id = ? AND owner_id = ? AND followup_id IS NULL AND expires_at > ?)
    ON CONFLICT (upload_id, chunk_index) DO NOTHING`).bind(uploadId, index, body.dataBase64, bytes.length, uploadId, context.account.id, nowSeconds()).run();
  const stored = await context.database.prepare("SELECT data_base64 FROM almadina_followup_chunks WHERE upload_id = ? AND chunk_index = ?").bind(uploadId, index).first<{ data_base64: string }>();
  if (!stored || stored.data_base64 !== body.dataBase64) return fail("جزء المرفق محفوظ ببيانات مختلفة أو انتهت صلاحيته.", 409);
  return { ok: true };
}
async function ticketRow(context: FollowupContext, id: string): Promise<TicketRow> {
  const row = await context.database.prepare("SELECT * FROM almadina_followups WHERE id = ?").bind(id).first<TicketRow>();
  if (!row) return fail("المتابعة غير موجودة.", 404);
  authorizedOrder(context, row.order_id);
  return row;
}
function sameCreation(previous: Followup, candidate: Followup): boolean {
  return previous.orderId === candidate.orderId && previous.type === candidate.type && previous.title === candidate.title && previous.description === candidate.description
    && JSON.stringify(previous.attachments.map((item) => item.id)) === JSON.stringify(candidate.attachments.map((item) => item.id));
}
async function sendNotice(context: FollowupContext, followup: Followup, changed: boolean) {
  // The follow-up has already committed. A notification conflict must never turn a
  // successful submission into a misleading error/retry that creates another ticket.
  try { await context.notify?.(followup, changed); } catch { /* best-effort secondary notice */ }
}
async function createFollowup(context: FollowupContext, body: Record<string, unknown>): Promise<unknown> {
  const order = authorizedOrder(context, body.orderId);
  const token = requestId(body.requestId);
  const type = body.type;
  if (!FOLLOWUP_TYPES.some((entry) => entry.value === type)) return fail("اختر نوع المتابعة.");
  const title = cleanString(body.title, FOLLOWUP_LIMITS.title, "عنوان المتابعة");
  const description = cleanString(body.description, FOLLOWUP_LIMITS.description, "وصف المتابعة");
  const ids = body.attachmentIds ?? [];
  if (!Array.isArray(ids) || ids.length > FOLLOWUP_LIMITS.files || ids.some((id) => typeof id !== "string" || id.length > 100) || new Set(ids).size !== ids.length) return fail("يمكن إضافة خمسة مرفقات كحد أقصى دون تكرار.");
  const id = await stableId("followup", context.account.id, token);
  const existing = await context.database.prepare("SELECT * FROM almadina_followups WHERE id = ?").bind(id).first<TicketRow>();
  const uploads: UploadRow[] = [];
  for (const uploadId of ids) {
    const upload = await uploadForOwner(context, uploadId);
    if (upload.order_id !== order.id || (upload.followup_id && upload.followup_id !== id)) return fail("المرفق غير متاح لهذه المتابعة.", 409);
    if (!upload.followup_id && upload.expires_at <= nowSeconds()) return fail("انتهت صلاحية أحد المرفقات. أعد اختياره.", 410);
    uploads.push(upload);
  }
  if (uploads.reduce((sum, upload) => sum + upload.size, 0) > FOLLOWUP_LIMITS.totalBytes) return fail("الحد الأقصى لمجموع المرفقات 20 ميغابايت.", 413);
  const timestamp = new Date().toISOString();
  const followup: Followup = { id, orderId: order.id, merchantId: order.merchantId, creatorId: context.account.id, creatorName: context.account.name, type: type as FollowupType,
    title, description, status: "open", response: "", createdAt: timestamp, updatedAt: timestamp, attachments: uploads.map(attachment) };
  if (existing) {
    const prior = wireFollowup(context, existing);
    if (!sameCreation(prior, followup)) return fail("معرّف الطلب مستخدم لمتابعة مختلفة.", 409);
    return { followup: prior };
  }
  await context.rateLimit("followup-create", 20, 3600);
  // Immutable chunks are validated on arrival. Check completeness again inside
  // the insertion transaction so an interrupted upload cannot become a ticket.
  const guards: string[] = [];
  const guardValues: unknown[] = [];
  for (const upload of uploads) {
    guards.push(`EXISTS (SELECT id FROM almadina_followup_uploads WHERE id = ? AND owner_id = ? AND order_id = ? AND followup_id IS NULL AND expires_at > ?
      AND chunk_count = (SELECT COUNT(*) FROM almadina_followup_chunks WHERE upload_id = ?)
      AND size = (SELECT COALESCE(SUM(raw_size), 0) FROM almadina_followup_chunks WHERE upload_id = ?))`);
    guardValues.push(upload.id, context.account.id, order.id, nowSeconds(), upload.id, upload.id);
  }
  const statements = [await ownerLock(context.database, context.account.id),
    context.database.prepare(`INSERT INTO almadina_followups (id, order_id, creator_id, merchant_id, request_id, payload, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guards.join(" AND ") || "1 = 1"} ON CONFLICT (id) DO NOTHING`)
      .bind(id, order.id, context.account.id, order.merchantId, token, JSON.stringify(followup), timestamp, ...guardValues),
    ...uploads.map((upload) => context.database.prepare(`UPDATE almadina_followup_uploads SET followup_id = ? WHERE id = ? AND followup_id IS NULL
      AND EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?)`).bind(id, upload.id, id, JSON.stringify(followup))),
  ];
  await context.database.batch(statements);
  const saved = await context.database.prepare("SELECT * FROM almadina_followups WHERE id = ?").bind(id).first<TicketRow>();
  if (!saved) return fail("رفع المرفقات غير مكتمل أو لم تعد متاحة. أعد المحاولة.", 409);
  const result = wireFollowup(context, saved);
  if (!sameCreation(result, followup)) return fail("معرّف الطلب مستخدم لمتابعة مختلفة.", 409);
  await sendNotice(context, result, false);
  return { followup: result };
}
function encodeCursor(row: TicketRow): string { return btoa(JSON.stringify([row.created_at, row.id])); }
function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed = JSON.parse(atob(cursor));
    if (cursor.length > 400 || !Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(parsed[0]) || parsed[0].length > 30 || typeof parsed[1] !== "string" || parsed[1].length > 100) return fail("مؤشر الصفحة غير صالح.");
    return [parsed[0], parsed[1]];
  } catch { return fail("مؤشر الصفحة غير صالح."); }
}
async function listFollowups(context: FollowupContext, url: URL): Promise<unknown> {
  const orderId = url.searchParams.get("orderId");
  const merchantId = url.searchParams.get("merchantId");
  if (merchantId !== null && !/^[a-zA-Z0-9_-]{1,160}$/.test(merchantId)) return fail("معرّف العميل غير صالح.");
  const values: unknown[] = [];
  const clauses: string[] = [];
  const cursor = url.searchParams.get("cursor");
  if (cursor) { const [date, id] = decodeCursor(cursor); clauses.push("(created_at < ? OR (created_at = ? AND id < ?))"); values.push(date, date, id); }
  if (orderId !== null) authorizedOrder(context, orderId);
  // Apply every filter to the current authorized parcel set. A merchantId query
  // can narrow a merchant's scope, but can never authorize another merchant.
  // A single JSON bind also avoids D1's parameter limit for staff-wide inboxes.
  const accessibleOrderIds = context.state.orders.filter((order) => canAccess(context.account, order)
    && (orderId === null || order.id === orderId) && (merchantId === null || order.merchantId === merchantId)).map((order) => order.id);
  if (!accessibleOrderIds.length) return { followups: [], nextCursor: null };
  clauses.push("order_id IN (SELECT value FROM json_each(?))"); values.push(JSON.stringify(accessibleOrderIds));
  const rows = (await context.database.prepare(`SELECT * FROM almadina_followups ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT 51`).bind(...values).all<TicketRow>()).results ?? [];
  const page = rows.slice(0, PAGE_SIZE);
  return { followups: page.map((row) => wireFollowup(context, row)), nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null };
}
function compareCustomer(left: { name: string; id: string }, right: { name: string; id: string }): number {
  // Avoid environment-dependent collation so cursor ordering remains stable.
  return left.name < right.name ? -1 : left.name > right.name ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
function encodeCustomerCursor(customer: FollowupCustomer): string {
  return btoa(encodeURIComponent(JSON.stringify([customer.name, customer.id])));
}
function decodeCustomerCursor(cursor: string): { name: string; id: string } {
  try {
    if (cursor.length > 4096) return fail("مؤشر الصفحة غير صالح.");
    const parsed = JSON.parse(decodeURIComponent(atob(cursor)));
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || typeof parsed[1] !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(parsed[1])) return fail("مؤشر الصفحة غير صالح.");
    return { name: parsed[0], id: parsed[1] };
  } catch { return fail("مؤشر الصفحة غير صالح."); }
}
async function listCustomers(context: FollowupContext, url: URL): Promise<FollowupCustomerList> {
  if (context.account.role !== "admin" && context.account.role !== "courier") return fail("دليل العملاء متاح للإدارة والموظفين فقط.", 403);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query)) return fail("نص البحث غير صالح.");
  const search = query.normalize("NFKC").toLowerCase();
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor ? decodeCustomerCursor(rawCursor) : null;
  const matches = context.state.users.filter((account) => account.role === "merchant"
    && (!search || [account.id, account.name, account.store].some((value) => value.normalize("NFKC").toLowerCase().includes(search)))
    && (!cursor || compareCustomer(account, cursor) > 0)).sort(compareCustomer);
  const customers: FollowupCustomer[] = matches.slice(0, PAGE_SIZE).map((account) => ({
    id: account.id, name: account.name, store: account.store, orderCount: 0, followupCount: 0, openCount: 0,
  }));
  const byMerchant = new Map(customers.map((customer) => [customer.id, customer]));
  const byOrder = new Map<string, FollowupCustomer>();
  for (const order of context.state.orders) {
    const customer = byMerchant.get(order.merchantId);
    if (!order.deleted && customer) { customer.orderCount += 1; byOrder.set(order.id, customer); }
  }
  if (byOrder.size) {
    // Aggregate only the current page's active parcels and never return ticket
    // descriptions or customer account records to the directory consumer.
    const counts = (await context.database.prepare(`SELECT order_id, COUNT(*) AS followup_count,
      SUM(CASE WHEN json_extract(payload, '$.status') IN ('open', 'in_progress') THEN 1 ELSE 0 END) AS open_count
      FROM almadina_followups WHERE order_id IN (SELECT value FROM json_each(?)) GROUP BY order_id`)
      .bind(JSON.stringify([...byOrder.keys()])).all<{ order_id: string; followup_count: number | string; open_count: number | string }>()).results ?? [];
    for (const count of counts) {
      const customer = byOrder.get(count.order_id);
      if (customer) { customer.followupCount += Number(count.followup_count); customer.openCount += Number(count.open_count); }
    }
  }
  return { customers, nextCursor: matches.length > PAGE_SIZE ? encodeCustomerCursor(customers[customers.length - 1]) : null };
}
async function downloadChunk(context: FollowupContext, id: string, url: URL): Promise<unknown> {
  const upload = await context.database.prepare("SELECT * FROM almadina_followup_uploads WHERE id = ? AND followup_id IS NOT NULL").bind(id).first<UploadRow>();
  if (!upload || !upload.followup_id) return fail("المرفق غير موجود.", 404);
  const row = await ticketRow(context, upload.followup_id);
  if (!(JSON.parse(row.payload) as Followup).attachments.some((item) => item.id === id)) return fail("المرفق غير موجود.", 404);
  const rawIndex = url.searchParams.get("chunk") ?? "0";
  const index = Number(rawIndex);
  if (!/^\d{1,3}$/.test(rawIndex) || !Number.isSafeInteger(index) || index < 0 || index >= upload.chunk_count) return fail("رقم جزء المرفق غير صالح.");
  await context.rateLimit("followup-download", 1200, 3600);
  const chunk = await context.database.prepare("SELECT data_base64, raw_size, chunk_index FROM almadina_followup_chunks WHERE upload_id = ? AND chunk_index = ?").bind(id, index).first<ChunkRow>();
  if (!chunk) return fail("تعذّر العثور على جزء المرفق.", 404);
  return { attachment: attachment(upload), index, chunkCount: upload.chunk_count, dataBase64: chunk.data_base64 };
}
async function updateStatus(context: FollowupContext, id: string, body: Record<string, unknown>): Promise<unknown> {
  const row = await ticketRow(context, id);
  if (context.account.role !== "admin" && context.account.role !== "courier") return fail("تحديث المتابعة متاح للإدارة والموظفين فقط.", 403);
  if (!FOLLOWUP_STATUSES.some((entry) => entry.value === body.status)) return fail("حالة المتابعة غير صالحة.");
  const response = body.response === undefined || body.response === "" ? "" : cleanString(body.response, FOLLOWUP_LIMITS.response, "الرد");
  const previous = wireFollowup(context, row);
  if (previous.status === body.status && previous.response === response) return { followup: previous };
  await context.rateLimit("followup-status", 60, 3600);
  const followup: Followup = { ...previous, status: body.status as FollowupStatus, response, updatedAt: new Date().toISOString() };
  const saved = await context.database.prepare("UPDATE almadina_followups SET payload = ? WHERE id = ? AND payload = ?").bind(JSON.stringify(followup), id, row.payload).run();
  if (!(saved.meta?.changes ?? 0)) return fail("تم تحديث المتابعة من جهاز آخر. أعد تحميلها.", 409);
  await sendNotice(context, followup, true);
  return { followup };
}
/** Receives requests only after the existing authentication, origin, and 2 MiB checks. */
export async function handleFollowupRequest(request: Request, context: FollowupContext): Promise<unknown> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/almadina\/followups\/?/, "");
  if (path === "customers" && request.method === "GET") { await context.rateLimit("followup-read", 180, 60); return listCustomers(context, url); }
  if (!path && request.method === "GET") { await context.rateLimit("followup-read", 180, 60); return listFollowups(context, url); }
  if (!path && request.method === "POST") return createFollowup(context, objectBody(await request.json()));
  if (path === "uploads" && request.method === "POST") return beginUpload(context, objectBody(await request.json()));
  const upload = /^uploads\/([a-zA-Z0-9_-]{1,100})\/chunks$/.exec(path);
  if (upload && request.method === "POST") return putChunk(context, upload[1], objectBody(await request.json()));
  const media = /^attachments\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
  if (media && request.method === "GET") return downloadChunk(context, media[1], url);
  const status = /^([a-zA-Z0-9_-]{1,100})\/status$/.exec(path);
  if (status && request.method === "POST") return updateStatus(context, status[1], objectBody(await request.json()));
  if (/^[a-zA-Z0-9_-]{1,100}$/.test(path) && request.method === "GET") {
    await context.rateLimit("followup-read", 180, 60);
    return { followup: wireFollowup(context, await ticketRow(context, path)) };
  }
  return fail("المسار المطلوب غير موجود.", 404);
}
