export type ApiErrorCategory = "offline" | "network" | "timeout" | "aborted" | "unauthorized" | "forbidden" | "conflict" | "rate-limit" | "server" | "malformed" | "request";

const errorMessages: Record<ApiErrorCategory, string> = {
  offline: "لا يوجد اتصال بالإنترنت. تحقق من الاتصال ثم أعد المحاولة.",
  network: "تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.",
  timeout: "تأخر رد الخادم. حدّث البيانات قبل إعادة المحاولة.",
  aborted: "تم إلغاء الطلب.",
  unauthorized: "انتهت جلسة الدخول. سجّل الدخول مجددًا.",
  forbidden: "ليس لديك صلاحية لتنفيذ هذا الإجراء.",
  conflict: "تغيّرت البيانات. حدّثها وراجعها قبل إعادة المحاولة.",
  "rate-limit": "طلبات كثيرة في وقت قصير. انتظر قليلًا ثم أعد المحاولة.",
  server: "الخادم غير متاح مؤقتًا. أعد المحاولة بعد قليل.",
  malformed: "استجابة الخادم غير مكتملة. حدّث البيانات قبل إعادة المحاولة.",
  request: "تعذّر إكمال الطلب. راجع البيانات ثم أعد المحاولة.",
};

export class ApiTransportError extends Error {
  readonly category: ApiErrorCategory;
  readonly status?: number;

  constructor(category: ApiErrorCategory, status?: number) {
    super(errorMessages[category]);
    this.name = category === "aborted" ? "AbortError" : "ApiTransportError";
    this.category = category;
    this.status = status;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function safeResponseMessage(value: unknown, status: number): string {
  // Keep useful Arabic validation copy, but never surface proxy HTML, stack
  // traces, links, control characters or internal server diagnostics.
  if (status < 500 && typeof value === "string" && value.trim().length > 0 && value.length <= 300
    && /[\u0600-\u06ff]/.test(value) && !/[<>&`\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]|https?:\/\//i.test(value)) return value.trim();
  return errorMessages[classifyApiError(undefined, status)];
}

// Accept status-bearing errors from existing API clients without requiring them
// to change classes. HTTP status remains authoritative even when offline.
export function classifyApiError(error: unknown, status?: number): ApiErrorCategory {
  if (error instanceof ApiTransportError) return error.category;
  if (record(error) && error.name === "AbortError") return "aborted";
  if (record(error) && error.name === "TimeoutError") return "timeout";
  const code = status ?? (record(error) && typeof error.status === "number" ? error.status : undefined);
  if (code === 401) return "unauthorized";
  if (code === 403) return "forbidden";
  if (code === 409) return "conflict";
  if (code === 429) return "rate-limit";
  if (code !== undefined && code >= 500 && code <= 599) return "server";
  if (code !== undefined && code >= 400) return "request";
  if (error instanceof SyntaxError) return "malformed";
  if (error instanceof TypeError) return isOffline() ? "offline" : "network";
  return "request";
}

// Raw server bodies and exception messages are never suitable UI copy. The
// optional fallback is application-authored text for an unclassified error.
export function safeApiErrorMessage(error: unknown, fallback?: string): string {
  const category = classifyApiError(error);
  return category === "request" && fallback ? fallback : errorMessages[category];
}

// Keep network failures bounded, including a stalled response body and a fetch
// implementation that does not honor abort. Mutations are never replayed.
export async function requestApiJSON(path: string, options: RequestInit = {}, timeoutMs = 35_000): Promise<{ response: Response; payload: Record<string, unknown> }> {
  if (path.startsWith("/") || path.includes("://") || path.includes("..") || path.includes("\\")) {
    throw new Error("عنوان الطلب غير صالح.");
  }
  if (options.signal?.aborted) throw new ApiTransportError("aborted");
  const controller = new AbortController();
  let cancellation: ApiTransportError | undefined;
  let rejectCancellation!: (error: ApiTransportError) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const cancel = (category: "aborted" | "timeout") => {
    if (cancellation) return;
    cancellation = new ApiTransportError(category);
    rejectCancellation(cancellation);
    controller.abort(cancellation);
  };
  const externalAbort = () => cancel("aborted");
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  const timer = setTimeout(() => cancel("timeout"), timeoutMs);
  try {
    const response = await Promise.race([fetch(`/api/almadina/${path}`, {
      ...options, signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", ...options.headers },
    }), cancelled]);
    let payload: unknown;
    try { payload = await Promise.race([response.json(), cancelled]); }
    catch {
      if (cancellation) throw cancellation;
      if (response.ok) throw new ApiTransportError("malformed", response.status);
      payload = {};
    }
    if (cancellation) throw cancellation;
    if (!record(payload)) {
      if (response.ok) throw new ApiTransportError("malformed", response.status);
      payload = {};
    }
    const result = payload as Record<string, unknown>;
    // Preserve snapshots, revisions and other receipts on HTTP errors. Existing
    // callers still inspect response.ok/status and control their own session.
    const hasErrorMessage = !response.ok || typeof result.error === "string";
    return { response, payload: hasErrorMessage ? { ...result, error: safeResponseMessage(result.error, response.status) } : result };
  } catch (error) {
    if (cancellation) throw cancellation;
    if (error instanceof ApiTransportError) throw error;
    if (record(error) && error.name === "AbortError") throw new ApiTransportError("aborted");
    throw new ApiTransportError(isOffline() ? "offline" : "network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}

export function validSnapshotEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const db = item.database as Record<string, unknown> | undefined;
  return Number.isSafeInteger(item.revision) && (item.revision as number) >= 0
    && typeof item.userId === "string" && item.userId.length > 0
    && !!db && typeof db === "object" && !Array.isArray(db)
    && ["users", "orders", "collections", "recipients", "notices"].every((key) => Array.isArray(db[key]))
    && (db.users as Record<string, unknown>[]).some((user) => !!user && user.id === item.userId && ["merchant", "courier", "admin"].includes(String(user.role)));
}

export function canAcceptPolledSnapshot(currentUserId: string, currentRevision: number, incoming: { userId: string; revision: number }): boolean {
  return incoming.userId === currentUserId && Number.isSafeInteger(incoming.revision) && incoming.revision > currentRevision;
}
