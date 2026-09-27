import { requestApiJSON } from "./api-transport";
import { FOLLOWUP_LIMITS, FOLLOWUP_MIME_TYPES, FOLLOWUP_STATUSES, FOLLOWUP_TYPES, type Followup, type FollowupAttachment, type FollowupAttachmentChunk, type FollowupType } from "./followups";

export class FollowupApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const requestAccounts = new WeakMap<AbortSignal, string>();
export function bindFollowupAccount(signal: AbortSignal, accountId: string): void { requestAccounts.set(signal, accountId); }

export async function followupApi<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  signal.throwIfAborted();
  const { response, payload } = await requestApiJSON(path, {
    method: body === undefined ? "GET" : "POST", signal,
    headers: { "X-Almadina-Account": requestAccounts.get(signal) ?? "" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  signal.throwIfAborted();
  if (!response.ok) throw new FollowupApiError(typeof payload.error === "string" ? payload.error : "تعذّر حفظ المتابعة. حاول مجددًا.", response.status);
  return payload as T;
}

export type PendingFollowupFile = { id: string; file: File; uploadId?: string };

export function validateFollowupFiles(files: readonly Pick<File, "name" | "size" | "type">[]): string | null {
  if (files.length > FOLLOWUP_LIMITS.files) return "يمكن إرفاق خمسة ملفات كحد أقصى.";
  if (files.some((file) => !file.size || file.size > FOLLOWUP_LIMITS.fileBytes)) return "يجب أن يكون كل ملف غير فارغ وأصغر من أو يساوي 10 ميغابايت.";
  if (files.reduce((size, file) => size + file.size, 0) > FOLLOWUP_LIMITS.totalBytes) return "مجموع المرفقات يجب ألا يتجاوز 20 ميغابايت.";
  if (files.some((file) => !(FOLLOWUP_MIME_TYPES as readonly string[]).includes(file.type))) return "صيغة الملف غير مدعومة. اختر صورة أو مقطع صوت أو فيديو بصيغة معروفة.";
  return null;
}

function encode(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export async function uploadFollowupFile(orderId: string, item: PendingFollowupFile, signal: AbortSignal, progress: (value: string) => void): Promise<string> {
  const error = validateFollowupFiles([item.file]);
  if (error) throw new Error(error);
  const count = Math.ceil(item.file.size / FOLLOWUP_LIMITS.chunkBytes);
  if (!item.uploadId) {
    const result = await followupApi<{ uploadId: string; chunkSize: number }>("followups/uploads", signal, {
      requestId: item.id, orderId, name: item.file.name, mimeType: item.file.type, size: item.file.size, chunkCount: count,
    });
    if (typeof result.uploadId !== "string" || result.chunkSize !== FOLLOWUP_LIMITS.chunkBytes) throw new Error("تعذّر تهيئة رفع الملف.");
    item.uploadId = result.uploadId;
  }
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted();
    progress(`رفع ${item.file.name} — ${Math.round(index / count * 100)}٪`);
    const start = index * FOLLOWUP_LIMITS.chunkBytes;
    const data = new Uint8Array(await item.file.slice(start, start + FOLLOWUP_LIMITS.chunkBytes).arrayBuffer());
    await followupApi(`followups/uploads/${encodeURIComponent(item.uploadId)}/chunks`, signal, { index, dataBase64: encode(data) });
  }
  return item.uploadId;
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validAttachment(value: unknown): value is FollowupAttachment {
  if (!record(value)) return false;
  return typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 180
    && typeof value.mimeType === "string" && (FOLLOWUP_MIME_TYPES as readonly string[]).includes(value.mimeType)
    && typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= FOLLOWUP_LIMITS.fileBytes
    && value.chunkCount === Math.ceil(value.size / FOLLOWUP_LIMITS.chunkBytes);
}
export function validFollowup(value: unknown): value is Followup {
  if (!record(value)) return false;
  return typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    && typeof value.orderId === "string" && value.orderId.length > 0 && value.orderId.length <= 160
    && typeof value.creatorId === "string" && value.creatorId.length > 0
    && typeof value.creatorName === "string"
    && FOLLOWUP_TYPES.some((entry) => entry.value === value.type)
    && FOLLOWUP_STATUSES.some((entry) => entry.value === value.status)
    && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= FOLLOWUP_LIMITS.title
    && typeof value.description === "string" && value.description.trim().length > 0 && value.description.length <= FOLLOWUP_LIMITS.description
    && typeof value.response === "string" && value.response.length <= FOLLOWUP_LIMITS.response
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
    && Array.isArray(value.attachments) && value.attachments.length <= FOLLOWUP_LIMITS.files && value.attachments.every(validAttachment)
    && new Set(value.attachments.map((item) => item.id)).size === value.attachments.length
    && value.attachments.reduce((sum, item) => sum + item.size, 0) <= FOLLOWUP_LIMITS.totalBytes;
}

export type FollowupDraft = { requestId: string; orderId: string; type: FollowupType; title: string; description: string; attachmentIds: string[] };
export async function createFollowup(draft: FollowupDraft, signal: AbortSignal): Promise<Followup> {
  const result = await followupApi<{ followup: unknown }>("followups", signal, draft);
  if (!validFollowup(result.followup) || result.followup.orderId !== draft.orderId || result.followup.type !== draft.type
    || result.followup.title !== draft.title || result.followup.description !== draft.description
    || JSON.stringify(result.followup.attachments.map((item) => item.id)) !== JSON.stringify(draft.attachmentIds)) {
    // The server may have committed even if its response is incomplete. Keep the
    // immutable request available for a retry instead of declaring false success.
    throw new Error("لم يصل تأكيد الحفظ كاملًا. أعد محاولة تأكيد الطلب نفسه.");
  }
  return result.followup;
}

export async function downloadFollowupFile(item: FollowupAttachment, signal: AbortSignal): Promise<Blob> {
  if (!validAttachment(item)) throw new Error("بيانات المرفق غير صالحة.");
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (let index = 0; index < item.chunkCount; index++) {
    const result = await followupApi<FollowupAttachmentChunk>(`followups/attachments/${encodeURIComponent(item.id)}?chunk=${index}`, signal);
    const expected = Math.min(FOLLOWUP_LIMITS.chunkBytes, item.size - total);
    if (result.index !== index || result.chunkCount !== item.chunkCount || result.attachment?.id !== item.id ||
        result.attachment.size !== item.size || result.attachment.mimeType !== item.mimeType || result.attachment.chunkCount !== item.chunkCount ||
        typeof result.dataBase64 !== "string" || result.dataBase64.length > Math.ceil(FOLLOWUP_LIMITS.chunkBytes / 3) * 4) throw new Error("تعذّر قراءة المرفق كاملًا.");
    const raw = atob(result.dataBase64);
    if (raw.length !== expected) throw new Error("المرفق غير مكتمل. أعد المحاولة.");
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    parts.push(bytes); total += bytes.length;
  }
  signal.throwIfAborted();
  return new Blob(parts, { type: item.mimeType });
}
