import type { Database, Order, User } from "./data";
import { FOLLOWUP_LIMITS, FOLLOWUP_MIME_TYPES, FOLLOWUP_STATUSES, FOLLOWUP_TYPES, type Followup, type FollowupComment, type FollowupAttachment, type FollowupCustomer, type FollowupCustomerList, type FollowupStatus, type FollowupType } from "./followups";

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
type MutationRow = { actor_id: string; request_id: string; followup_id: string; fingerprint: string; result: string };
type CommentRow = { id: string; followup_id: string; author_id: string; payload: string; created_at: string };
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
  const followup = JSON.parse(row.payload) as Followup;
  return { ...followup, merchantId: order.merchantId, trackingNumber: order.trackingNumber,
    canEdit: row.creator_id === context.account.id && followup.status !== "resolved",
    canDelete: row.creator_id === context.account.id || context.account.role === "admin" };
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
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_revoked (user_id TEXT PRIMARY KEY NOT NULL)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_lifecycle (id TEXT PRIMARY KEY NOT NULL, lock_version INTEGER NOT NULL)`),
    database.prepare("INSERT INTO almadina_followup_lifecycle (id, lock_version) VALUES ('main', 0) ON CONFLICT (id) DO NOTHING"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_owners (user_id TEXT PRIMARY KEY NOT NULL, lock_version INTEGER NOT NULL DEFAULT 0)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followups (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, creator_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
      request_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (creator_id, request_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followups_order_idx ON almadina_followups (order_id, created_at, id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followups_page_idx ON almadina_followups (created_at, id)"),
    // Additive tombstones retain the conversation and immutable retry ledger.
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_deleted (
      followup_id TEXT PRIMARY KEY NOT NULL, deleted_by TEXT, deleted_at TEXT NOT NULL
    )`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_sequence (id TEXT PRIMARY KEY NOT NULL, next_value INTEGER NOT NULL)`),
    database.prepare("INSERT INTO almadina_followup_sequence (id, next_value) VALUES ('main', 0) ON CONFLICT (id) DO NOTHING"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_references (followup_id TEXT PRIMARY KEY NOT NULL, ticket_number TEXT NOT NULL UNIQUE)`),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_mutations (
      actor_id TEXT NOT NULL, request_id TEXT NOT NULL, followup_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY (actor_id, request_id)
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followup_mutations_ticket_idx ON almadina_followup_mutations (followup_id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_comments (
      id TEXT PRIMARY KEY NOT NULL, followup_id TEXT NOT NULL, author_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followup_comments_page_idx ON almadina_followup_comments (followup_id, created_at, id)"),
    database.prepare(`CREATE TABLE IF NOT EXISTS almadina_followup_comment_media (
      upload_id TEXT PRIMARY KEY NOT NULL, comment_id TEXT NOT NULL, followup_id TEXT NOT NULL
    )`),
    database.prepare("CREATE INDEX IF NOT EXISTS almadina_followup_comment_media_ticket_idx ON almadina_followup_comment_media (followup_id)"),
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
    database.prepare("UPDATE almadina_followup_lifecycle SET lock_version = lock_version + 1 WHERE id = 'main'"),
    database.prepare("INSERT INTO almadina_followup_revoked (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING").bind(account.id),
    database.prepare(`DELETE FROM almadina_followup_chunks WHERE upload_id IN (SELECT id FROM almadina_followup_uploads WHERE ${condition})`).bind(...values),
    database.prepare(`DELETE FROM almadina_followup_comment_media WHERE upload_id IN (SELECT id FROM almadina_followup_uploads WHERE ${condition})`).bind(...values),
    database.prepare("DELETE FROM almadina_followup_comments WHERE author_id = ? OR followup_id IN (SELECT id FROM almadina_followups WHERE creator_id = ? OR merchant_id = ?)").bind(account.id, account.id, account.id),
    database.prepare("DELETE FROM almadina_followup_mutations WHERE actor_id = ? OR followup_id IN (SELECT id FROM almadina_followups WHERE creator_id = ? OR merchant_id = ?)").bind(account.id, account.id, account.id),
    database.prepare("DELETE FROM almadina_followup_references WHERE followup_id IN (SELECT id FROM almadina_followups WHERE creator_id = ? OR merchant_id = ?)").bind(account.id, account.id),
    database.prepare("DELETE FROM almadina_followup_deleted WHERE followup_id IN (SELECT id FROM almadina_followups WHERE creator_id = ? OR merchant_id = ?)").bind(account.id, account.id),
    database.prepare("UPDATE almadina_followup_deleted SET deleted_by = NULL WHERE deleted_by = ?").bind(account.id),
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
  await database.prepare("INSERT INTO almadina_followup_owners (user_id, lock_version) SELECT ?, 0 WHERE NOT EXISTS (SELECT user_id FROM almadina_followup_revoked WHERE user_id = ?) ON CONFLICT (user_id) DO NOTHING").bind(ownerId, ownerId).run();
  // Finalizers and account purges share this short transaction lock. A tombstone
  // check alone permits an uncommitted insert to escape a concurrent purge under
  // PostgreSQL READ COMMITTED; serialization closes that privacy race.
  return database.prepare("UPDATE almadina_followup_lifecycle SET lock_version = lock_version + 1 WHERE id = 'main'");
}
const activeAccountsSql = "NOT EXISTS (SELECT user_id FROM almadina_followup_revoked WHERE user_id = ? OR user_id = ?)";
const activeTicketSql = "NOT EXISTS (SELECT followup_id FROM almadina_followup_deleted WHERE followup_id = ?)";
async function requireActiveAccount(context: FollowupContext): Promise<void> {
  if (await context.database.prepare("SELECT user_id FROM almadina_followup_revoked WHERE user_id = ?").bind(context.account.id).first()) return fail("هذا الحساب لم يعد متاحًا.", 401);
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
  if (upload.followup_id) await ticketRow(context, upload.followup_id);
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
    if (prior.followup_id) await ticketRow(context, prior.followup_id);
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
      ${activeAccountsSql} AND (SELECT COUNT(*) FROM almadina_followup_uploads WHERE owner_id = ? AND followup_id IS NULL AND expires_at > ?) < ?
      AND (SELECT COALESCE(SUM(size), 0) FROM almadina_followup_uploads WHERE owner_id = ? AND followup_id IS NULL AND expires_at > ?) + ? <= ?
      ON CONFLICT (id) DO NOTHING`).bind(id, context.account.id, order.merchantId, token, order.id, name, mimeType, size, chunkCount, now + UPLOAD_TTL_SECONDS,
        context.account.id, order.merchantId, context.account.id, now, PENDING_FILES, context.account.id, now, size, PENDING_BYTES),
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
  await context.database.batch([await ownerLock(context.database, context.account.id), context.database.prepare(`INSERT INTO almadina_followup_chunks (upload_id, chunk_index, data_base64, raw_size)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT id FROM almadina_followup_uploads WHERE id = ? AND owner_id = ? AND followup_id IS NULL AND expires_at > ?) AND ${activeAccountsSql}
    ON CONFLICT (upload_id, chunk_index) DO NOTHING`).bind(uploadId, index, body.dataBase64, bytes.length, uploadId, context.account.id, nowSeconds(), context.account.id, upload.merchant_id)]);
  const stored = await context.database.prepare("SELECT data_base64 FROM almadina_followup_chunks WHERE upload_id = ? AND chunk_index = ?").bind(uploadId, index).first<{ data_base64: string }>();
  if (!stored || stored.data_base64 !== body.dataBase64) return fail("جزء المرفق محفوظ ببيانات مختلفة أو انتهت صلاحيته.", 409);
  return { ok: true };
}
async function ticketRow(context: FollowupContext, id: string, includeDeleted = false): Promise<TicketRow> {
  const row = await context.database.prepare(`SELECT * FROM almadina_followups WHERE id = ?${includeDeleted ? "" : ` AND ${activeTicketSql}`}`)
    .bind(...(includeDeleted ? [id] : [id, id])).first<TicketRow>();
  if (!row) return fail("المتابعة غير موجودة.", 404);
  authorizedOrder(context, row.order_id);
  return row;
}
function attachmentIds(value: unknown): string[] {
  const ids = value ?? [];
  if (!Array.isArray(ids) || ids.length > FOLLOWUP_LIMITS.files || ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) || new Set(ids).size !== ids.length) return fail("يمكن إضافة خمسة مرفقات كحد أقصى دون تكرار.");
  return ids;
}
function structuredDetails(type: FollowupType, body: Record<string, unknown>, required: boolean) {
  let requestedPrice: string | null = null;
  let requestedAddress: string | null = null;
  if (body.requestedPrice !== undefined && body.requestedPrice !== null) {
    if (type !== "price-change" || typeof body.requestedPrice !== "string" || !/^\d{1,9}(?:\.\d{1,2})?$/.test(body.requestedPrice.trim())) return fail("أدخل السعر المطلوب بصيغة صحيحة وبمنزلتين عشريتين كحد أقصى.");
    requestedPrice = body.requestedPrice.trim().replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  if (body.requestedAddress !== undefined && body.requestedAddress !== null) {
    if (type !== "address-change") return fail("العنوان المطلوب متاح لمتابعة تعديل العنوان فقط.");
    requestedAddress = cleanString(body.requestedAddress, FOLLOWUP_LIMITS.address, "العنوان المطلوب");
  }
  if (required && type === "price-change" && requestedPrice === null) return fail("أدخل السعر المطلوب.");
  if (required && type === "address-change" && requestedAddress === null) return fail("أدخل العنوان المطلوب.");
  return { requestedPrice, requestedAddress };
}
function detailEvidence(type: FollowupType, ids: string[], required: boolean) {
  if (required && (type === "damaged" || type === "lost") && !ids.length) return fail("أضف مرفقًا يوضح حالة الطرد.");
}
function creationFingerprint(followup: Pick<Followup, "orderId" | "type" | "title" | "description" | "requestedPrice" | "requestedAddress">, ids: string[]): string {
  return JSON.stringify(["create", followup.orderId, followup.type, followup.title, followup.description, followup.requestedPrice ?? null, followup.requestedAddress ?? null, ids]);
}
async function priorMutation(context: FollowupContext, token: string, fingerprint: string): Promise<MutationRow | null> {
  const prior = await context.database.prepare("SELECT * FROM almadina_followup_mutations WHERE actor_id = ? AND request_id = ?").bind(context.account.id, token).first<MutationRow>();
  // A receipt never grants access to a deleted ticket or its old private content.
  if (prior) await ticketRow(context, prior.followup_id);
  if (prior && prior.fingerprint !== fingerprint) return fail("معرّف الطلب مستخدم لعملية مختلفة.", 409);
  return prior;
}
function wireMutationFollowup(context: FollowupContext, row: TicketRow, result: string): Followup {
  const current = wireFollowup(context, row);
  return { ...wireFollowup(context, { ...row, payload: result }), canEdit: current.canEdit, canDelete: current.canDelete };
}
function mutationStatement(context: FollowupContext, token: string, id: string, fingerprint: string, result: string, condition: string, values: unknown[]): D1PreparedStatement {
  return context.database.prepare(`INSERT INTO almadina_followup_mutations (actor_id, request_id, followup_id, fingerprint, result)
    SELECT ?, ?, ?, ?, ? WHERE ${condition} AND ${activeTicketSql} ON CONFLICT (actor_id, request_id) DO NOTHING`)
    .bind(context.account.id, token, id, fingerprint, result, ...values, id);
}
async function selectedUploads(context: FollowupContext, orderId: string, ids: string[], previous?: Followup): Promise<UploadRow[]> {
  const uploads: UploadRow[] = [];
  for (const id of ids) {
    const upload = await uploadForOwner(context, id);
    if (upload.order_id !== orderId || (upload.followup_id && (!previous || upload.followup_id !== previous.id || !previous.attachments.some((item) => item.id === id)))) return fail("المرفق غير متاح لهذه المتابعة.", 409);
    // A removed ticket file stays finalized and cannot be borrowed back, nor can a
    // conversation attachment become part of the editable ticket description.
    if (await context.database.prepare("SELECT upload_id FROM almadina_followup_comment_media WHERE upload_id = ?").bind(id).first()) return fail("المرفق تابع للمحادثة ولا يمكن إعادة استخدامه.", 409);
    if (!upload.followup_id && upload.expires_at <= nowSeconds()) return fail("انتهت صلاحية أحد المرفقات. أعد اختياره.", 410);
    uploads.push(upload);
  }
  if (uploads.reduce((sum, upload) => sum + upload.size, 0) > FOLLOWUP_LIMITS.totalBytes) return fail("الحد الأقصى لمجموع المرفقات 20 ميغابايت.", 413);
  return uploads;
}
function uploadGuards(context: FollowupContext, uploads: UploadRow[], merchantId: string) {
  const clauses: string[] = [activeAccountsSql];
  const values: unknown[] = [context.account.id, merchantId];
  for (const upload of uploads.filter((item) => !item.followup_id)) {
    clauses.push(`EXISTS (SELECT id FROM almadina_followup_uploads WHERE id = ? AND owner_id = ? AND order_id = ? AND followup_id IS NULL AND expires_at > ?
      AND chunk_count = (SELECT COUNT(*) FROM almadina_followup_chunks WHERE upload_id = ?)
      AND size = (SELECT COALESCE(SUM(raw_size), 0) FROM almadina_followup_chunks WHERE upload_id = ?))`);
    values.push(upload.id, context.account.id, upload.order_id, nowSeconds(), upload.id, upload.id);
  }
  return { sql: clauses.join(" AND ") || "1 = 1", values };
}
function nextUpdatedAt(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}
async function sendNotice(context: FollowupContext, followup: Followup, changed: boolean) {
  // The follow-up has already committed. A notification conflict must never turn a
  // successful submission into a misleading error/retry that creates another ticket.
  try { await context.notify?.(followup, changed); } catch { /* best-effort secondary notice */ }
}
async function createFollowup(context: FollowupContext, body: Record<string, unknown>): Promise<unknown> {
  const order = authorizedOrder(context, body.orderId);
  const token = requestId(body.requestId);
  const type = body.type as FollowupType;
  if (!FOLLOWUP_TYPES.some((entry) => entry.value === type)) return fail("اختر نوع المتابعة.");
  if (body.detailsVersion !== undefined && body.detailsVersion !== 1) return fail("إصدار تفاصيل المتابعة غير مدعوم.");
  const title = cleanString(body.title, FOLLOWUP_LIMITS.title, "عنوان المتابعة");
  const description = cleanString(body.description, FOLLOWUP_LIMITS.description, "وصف المتابعة");
  const ids = attachmentIds(body.attachmentIds);
  const details = structuredDetails(type, body, body.detailsVersion === 1);
  detailEvidence(type, ids, body.detailsVersion === 1);
  const id = await stableId("followup", context.account.id, token);
  const fingerprint = creationFingerprint({ orderId: order.id, type, title, description, ...details }, ids);
  const prior = await priorMutation(context, token, fingerprint);
  if (prior) return { followup: wireMutationFollowup(context, await ticketRow(context, prior.followup_id), prior.result) };
  const existing = await context.database.prepare("SELECT * FROM almadina_followups WHERE id = ?").bind(id).first<TicketRow>();
  if (existing) {
    const previous = wireFollowup(context, await ticketRow(context, existing.id));
    if (creationFingerprint(previous, previous.attachments.map((item) => item.id)) !== fingerprint) return fail("معرّف الطلب مستخدم لمتابعة مختلفة.", 409);
    return { followup: previous };
  }
  let uploads: UploadRow[];
  try { uploads = await selectedUploads(context, order.id, ids); }
  catch (error) {
    // A concurrent identical request may finalize the upload after our ledger
    // preflight. Its immutable receipt wins over the now-finalized-file error.
    const completed = await priorMutation(context, token, fingerprint);
    if (!completed) throw error;
    return { followup: wireMutationFollowup(context, await ticketRow(context, completed.followup_id), completed.result) };
  }
  await context.rateLimit("followup-create", 20, 3600);
  // Atomic database allocation gives short, unique references across processes.
  // Gaps after an interrupted request are intentional; numbers are never reused.
  const sequence = await context.database.prepare("UPDATE almadina_followup_sequence SET next_value = next_value + 1 WHERE id = 'main' RETURNING next_value").first<{ next_value: number }>();
  if (!sequence) return fail("تعذّر تخصيص رقم المتابعة.", 503);
  const ticketNumber = `TK-${String(sequence.next_value).padStart(8, "0")}`;
  const timestamp = new Date().toISOString();
  const followup: Followup = { id, ticketNumber, orderId: order.id, merchantId: order.merchantId, creatorId: context.account.id, creatorName: context.account.name, type,
    title, description, ...details, status: "open", response: "", createdAt: timestamp, updatedAt: timestamp, attachments: uploads.map(attachment) };
  const payload = JSON.stringify(followup);
  const guards = uploadGuards(context, uploads, order.merchantId);
  const results = await context.database.batch<D1Result>([
    await ownerLock(context.database, context.account.id),
    context.database.prepare(`INSERT INTO almadina_followups (id, order_id, creator_id, merchant_id, request_id, payload, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guards.sql} AND ${activeTicketSql} AND NOT EXISTS (SELECT request_id FROM almadina_followup_mutations WHERE actor_id = ? AND request_id = ?) ON CONFLICT (id) DO NOTHING`)
      .bind(id, order.id, context.account.id, order.merchantId, token, payload, timestamp, ...guards.values, id, context.account.id, token),
    context.database.prepare(`INSERT INTO almadina_followup_references (followup_id, ticket_number) SELECT ?, ? WHERE EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?) AND ${activeTicketSql} ON CONFLICT (followup_id) DO NOTHING`).bind(id, ticketNumber, id, payload, id),
    mutationStatement(context, token, id, fingerprint, payload, "EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?)", [id, payload]),
    ...uploads.map((upload) => context.database.prepare(`UPDATE almadina_followup_uploads SET followup_id = ? WHERE id = ? AND followup_id IS NULL
      AND EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?) AND ${activeTicketSql}`).bind(id, upload.id, id, payload, id)),
  ]);
  const saved = await priorMutation(context, token, fingerprint);
  if (!saved) return fail("رفع المرفقات غير مكتمل أو لم تعد متاحة. أعد المحاولة.", 409);
  const result = wireMutationFollowup(context, await ticketRow(context, id), saved.result);
  if (results[1].meta?.changes) await sendNotice(context, result, false);
  return { followup: result };
}
async function editFollowup(context: FollowupContext, id: string, body: Record<string, unknown>): Promise<unknown> {
  const row = await ticketRow(context, id);
  const previous = wireFollowup(context, row);
  if (previous.creatorId !== context.account.id) return fail("تعديل المتابعة متاح لمن أنشأها فقط.", 403);
  const token = requestId(body.requestId);
  const title = cleanString(body.title, FOLLOWUP_LIMITS.title, "عنوان المتابعة");
  const description = cleanString(body.description, FOLLOWUP_LIMITS.description, "وصف المتابعة");
  const ids = attachmentIds(body.attachmentIds);
  const details = structuredDetails(previous.type, body, true);
  detailEvidence(previous.type, ids, true);
  if (typeof body.expectedUpdatedAt !== "string" || body.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) return fail("وقت تحديث المتابعة غير صالح.");
  // Ignore neither identity nor parcel changes silently: these are immutable.
  for (const key of ["type", "orderId", "creatorId"]) if (body[key] !== undefined && body[key] !== previous[key as "type" | "orderId" | "creatorId"]) return fail("لا يمكن تغيير نوع المتابعة أو الطرد أو منشئها.");
  const fingerprint = JSON.stringify(["edit", id, body.expectedUpdatedAt, title, description, details.requestedPrice, details.requestedAddress, ids]);
  const prior = await priorMutation(context, token, fingerprint);
  if (prior) return { followup: wireMutationFollowup(context, row, prior.result) };
  if (!previous.canEdit) return fail("لا يمكن تعديل متابعة تم حلها.", 409);
  if (previous.updatedAt !== body.expectedUpdatedAt) return fail("تم تحديث المتابعة من جهاز آخر. أعد تحميلها قبل التعديل.", 409);
  let uploads: UploadRow[];
  try { uploads = await selectedUploads(context, row.order_id, ids, previous); }
  catch (error) {
    const completed = await priorMutation(context, token, fingerprint);
    if (!completed) throw error;
    return { followup: wireMutationFollowup(context, await ticketRow(context, id), completed.result) };
  }
  await context.rateLimit("followup-edit", 30, 3600);
  const { canEdit: _permission, canDelete: _deletePermission, trackingNumber: _tracking, ...persisted } = previous;
  const followup: Followup = { ...persisted, title, description, ...details, attachments: uploads.map(attachment), updatedAt: nextUpdatedAt(previous.updatedAt) };
  const payload = JSON.stringify(followup);
  const guards = uploadGuards(context, uploads, authorizedOrder(context, row.order_id).merchantId);
  const results = await context.database.batch<D1Result>([
    await ownerLock(context.database, context.account.id),
    // Capture pre-upgrade creation details before the first edit, preserving old
    // clients' retries even after ticket details or attachment selection changes.
    mutationStatement(context, row.request_id, id, creationFingerprint(previous, previous.attachments.map((item) => item.id)), row.payload,
      "EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?)", [id, row.payload]),
    context.database.prepare(`UPDATE almadina_followups SET payload = ? WHERE id = ? AND payload = ? AND ${guards.sql} AND ${activeTicketSql}
      AND NOT EXISTS (SELECT request_id FROM almadina_followup_mutations WHERE actor_id = ? AND request_id = ?)`)
      .bind(payload, id, row.payload, ...guards.values, id, context.account.id, token),
    mutationStatement(context, token, id, fingerprint, payload, "EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?)", [id, payload]),
    ...uploads.filter((upload) => !upload.followup_id).map((upload) => context.database.prepare(`UPDATE almadina_followup_uploads SET followup_id = ? WHERE id = ? AND followup_id IS NULL
      AND EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND payload = ?) AND ${activeTicketSql}`).bind(id, upload.id, id, payload, id)),
  ]);
  const saved = await priorMutation(context, token, fingerprint);
  if (!saved) return fail("تم تحديث المتابعة أو لم تكتمل المرفقات. أعد تحميلها قبل التعديل.", 409);
  const result = wireMutationFollowup(context, await ticketRow(context, id), saved.result);
  if (results[2].meta?.changes) await sendNotice(context, result, true);
  return { followup: result };
}
async function createComment(context: FollowupContext, id: string, body: Record<string, unknown>): Promise<unknown> {
  const row = await ticketRow(context, id);
  const token = requestId(body.requestId);
  const text = body.text === "" || body.text === undefined ? "" : cleanString(body.text, FOLLOWUP_LIMITS.comment, "الرسالة");
  const ids = attachmentIds(body.attachmentIds);
  if (!text && !ids.length) return fail("اكتب رسالة أو أضف مرفقًا.");
  const fingerprint = JSON.stringify(["comment", id, text, ids]);
  const prior = await priorMutation(context, token, fingerprint);
  if (prior) return { comment: JSON.parse(prior.result) as FollowupComment };
  let uploads: UploadRow[];
  try { uploads = await selectedUploads(context, row.order_id, ids); }
  catch (error) {
    const completed = await priorMutation(context, token, fingerprint);
    if (!completed) throw error;
    await ticketRow(context, id);
    return { comment: JSON.parse(completed.result) as FollowupComment };
  }
  await context.rateLimit("followup-comment", 60, 3600);
  const comment: FollowupComment = { id: await stableId("fu-comment", context.account.id, token), followupId: id, authorId: context.account.id, authorName: context.account.name,
    authorRole: context.account.role as FollowupComment["authorRole"], text, createdAt: new Date().toISOString(), attachments: uploads.map(attachment) };
  const payload = JSON.stringify(comment);
  const guards = uploadGuards(context, uploads, authorizedOrder(context, row.order_id).merchantId);
  await context.database.batch([
    await ownerLock(context.database, context.account.id),
    context.database.prepare(`INSERT INTO almadina_followup_comments (id, followup_id, author_id, payload, created_at)
      SELECT ?, ?, ?, ?, ? WHERE ${guards.sql} AND EXISTS (SELECT id FROM almadina_followups WHERE id = ?) AND ${activeTicketSql} AND NOT EXISTS (SELECT request_id FROM almadina_followup_mutations WHERE actor_id = ? AND request_id = ?) ON CONFLICT (id) DO NOTHING`)
      .bind(comment.id, id, context.account.id, payload, comment.createdAt, ...guards.values, id, id, context.account.id, token),
    mutationStatement(context, token, id, fingerprint, payload, "EXISTS (SELECT id FROM almadina_followup_comments WHERE id = ? AND payload = ?)", [comment.id, payload]),
    ...uploads.flatMap((upload) => [
      context.database.prepare(`UPDATE almadina_followup_uploads SET followup_id = ? WHERE id = ? AND followup_id IS NULL
        AND EXISTS (SELECT id FROM almadina_followup_comments WHERE id = ? AND payload = ?) AND ${activeTicketSql}`).bind(id, upload.id, comment.id, payload, id),
      context.database.prepare(`INSERT INTO almadina_followup_comment_media (upload_id, comment_id, followup_id)
        SELECT ?, ?, ? WHERE EXISTS (SELECT id FROM almadina_followup_comments WHERE id = ? AND payload = ?) AND ${activeTicketSql} ON CONFLICT (upload_id) DO NOTHING`).bind(upload.id, comment.id, id, comment.id, payload, id),
    ]),
  ]);
  const saved = await priorMutation(context, token, fingerprint);
  if (!saved) return fail("رفع مرفقات الرسالة غير مكتمل أو لم تعد متاحة. أعد المحاولة.", 409);
  await ticketRow(context, id);
  return { comment: JSON.parse(saved.result) as FollowupComment };
}
async function listComments(context: FollowupContext, id: string, url: URL): Promise<unknown> {
  await ticketRow(context, id);
  const cursor = url.searchParams.get("cursor");
  const values: unknown[] = [id];
  let clause = "";
  if (cursor) { const [date, commentId] = decodeCursor(cursor); clause = " AND (created_at < ? OR (created_at = ? AND id < ?))"; values.push(date, date, commentId); }
  const rows = (await context.database.prepare(`SELECT * FROM almadina_followup_comments WHERE followup_id = ?${clause} ORDER BY created_at DESC, id DESC LIMIT 51`).bind(...values).all<CommentRow>()).results ?? [];
  await ticketRow(context, id);
  const page = rows.slice(0, PAGE_SIZE);
  return { comments: [...page].reverse().map((item) => JSON.parse(item.payload) as FollowupComment), nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null };
}
function encodeCursor(row: { created_at: string; id: string }): string { return btoa(JSON.stringify([row.created_at, row.id])); }
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
  const clauses: string[] = ["NOT EXISTS (SELECT followup_id FROM almadina_followup_deleted WHERE followup_id = almadina_followups.id)"];
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
      FROM almadina_followups WHERE order_id IN (SELECT value FROM json_each(?))
      AND NOT EXISTS (SELECT followup_id FROM almadina_followup_deleted WHERE followup_id = almadina_followups.id) GROUP BY order_id`)
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
  if (!(JSON.parse(row.payload) as Followup).attachments.some((item) => item.id === id)) {
    const media = await context.database.prepare(`SELECT c.payload FROM almadina_followup_comment_media m
      JOIN almadina_followup_comments c ON c.id = m.comment_id WHERE m.upload_id = ? AND m.followup_id = ? AND c.followup_id = ?`).bind(id, row.id, row.id).first<{ payload: string }>();
    if (!media || !(JSON.parse(media.payload) as FollowupComment).attachments.some((item) => item.id === id)) return fail("المرفق غير موجود.", 404);
  }
  const rawIndex = url.searchParams.get("chunk") ?? "0";
  const index = Number(rawIndex);
  if (!/^\d{1,3}$/.test(rawIndex) || !Number.isSafeInteger(index) || index < 0 || index >= upload.chunk_count) return fail("رقم جزء المرفق غير صالح.");
  await context.rateLimit("followup-download", 1200, 3600);
  const chunk = await context.database.prepare("SELECT data_base64, raw_size, chunk_index FROM almadina_followup_chunks WHERE upload_id = ? AND chunk_index = ?").bind(id, index).first<ChunkRow>();
  if (!chunk) return fail("تعذّر العثور على جزء المرفق.", 404);
  await ticketRow(context, row.id);
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
  const { canEdit: _permission, canDelete: _deletePermission, trackingNumber: _tracking, ...persisted } = previous;
  const changed: Followup = { ...persisted, status: body.status as FollowupStatus, response, updatedAt: nextUpdatedAt(previous.updatedAt) };
  const payload = JSON.stringify(changed);
  const saved = await context.database.batch<D1Result>([
    await ownerLock(context.database, context.account.id),
    context.database.prepare(`UPDATE almadina_followups SET payload = ? WHERE id = ? AND payload = ? AND ${activeAccountsSql} AND ${activeTicketSql}`)
      .bind(payload, id, row.payload, context.account.id, authorizedOrder(context, row.order_id).merchantId, id),
  ]);
  if (!(saved[1].meta?.changes ?? 0)) return fail("تم تحديث المتابعة من جهاز آخر. أعد تحميلها.", 409);
  const followup = wireFollowup(context, await ticketRow(context, id));
  await sendNotice(context, followup, true);
  return { followup };
}
async function deleteFollowup(context: FollowupContext, id: string, body: Record<string, unknown>): Promise<unknown> {
  // Include the retained row only here, so an authorized lost-response retry can
  // return its acknowledgement without exposing the deleted conversation.
  const row = await ticketRow(context, id, true);
  if (row.creator_id !== context.account.id && context.account.role !== "admin") return fail("حذف المتابعة متاح لمن أنشأها أو للمسؤول فقط.", 403);
  if (body.orderId !== row.order_id) return fail("المتابعة لا تخص الطرد المحدد.", 400);
  if (typeof body.expectedUpdatedAt !== "string" || body.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) return fail("وقت تحديث المتابعة غير صالح.");
  const acknowledgement = { deleted: true, followupId: id, orderId: row.order_id };
  const deleted = () => context.database.prepare("SELECT followup_id FROM almadina_followup_deleted WHERE followup_id = ?").bind(id).first();
  if (await deleted()) return acknowledgement;
  const previous = wireFollowup(context, row);
  if (previous.updatedAt !== body.expectedUpdatedAt) return fail("تم تحديث المتابعة من جهاز آخر. أعد تحميلها قبل الحذف.", 409);
  await context.rateLimit("followup-delete", 30, 3600);
  await context.database.batch([
    await ownerLock(context.database, context.account.id),
    context.database.prepare(`INSERT INTO almadina_followup_deleted (followup_id, deleted_by, deleted_at)
      SELECT ?, ?, ? WHERE EXISTS (SELECT id FROM almadina_followups WHERE id = ? AND order_id = ? AND payload = ?)
      AND ${activeAccountsSql} ON CONFLICT (followup_id) DO NOTHING`)
      .bind(id, context.account.id, new Date().toISOString(), id, row.order_id, row.payload, context.account.id, authorizedOrder(context, row.order_id).merchantId),
  ]);
  if (await deleted()) return acknowledgement;
  await ticketRow(context, id);
  return fail("تم تحديث المتابعة من جهاز آخر. أعد تحميلها قبل الحذف.", 409);
}
/** Receives requests only after the existing authentication, origin, and 2 MiB checks. */
export async function handleFollowupRequest(request: Request, context: FollowupContext): Promise<unknown> {
  await requireActiveAccount(context);
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
  const edit = /^([a-zA-Z0-9_-]{1,100})\/edit$/.exec(path);
  if (edit && request.method === "POST") return editFollowup(context, edit[1], objectBody(await request.json()));
  const removal = /^([a-zA-Z0-9_-]{1,100})\/delete$/.exec(path);
  if (removal && request.method === "POST") return deleteFollowup(context, removal[1], objectBody(await request.json()));
  const comments = /^([a-zA-Z0-9_-]{1,100})\/comments$/.exec(path);
  if (comments && request.method === "GET") { await context.rateLimit("followup-read", 180, 60); return listComments(context, comments[1], url); }
  if (comments && request.method === "POST") return createComment(context, comments[1], objectBody(await request.json()));
  const status = /^([a-zA-Z0-9_-]{1,100})\/status$/.exec(path);
  if (status && request.method === "POST") return updateStatus(context, status[1], objectBody(await request.json()));
  if (/^[a-zA-Z0-9_-]{1,100}$/.test(path) && request.method === "GET") {
    await context.rateLimit("followup-read", 180, 60);
    return { followup: wireFollowup(context, await ticketRow(context, path)) };
  }
  return fail("المسار المطلوب غير موجود.", 404);
}
