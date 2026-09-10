// Keep network failures bounded, including a stalled response body. Mutations
// are never automatically replayed after an ambiguous timeout.
export async function requestApiJSON(path: string, options: RequestInit = {}, timeoutMs = 35_000): Promise<{ response: Response; payload: Record<string, unknown> }> {
  if (path.startsWith("/") || path.includes("://") || path.includes("..") || path.includes("\\")) {
    throw new Error("عنوان الطلب غير صالح.");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(`/api/almadina/${path}`, {
      ...options, signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    let payload: unknown;
    try { payload = await response.json(); }
    catch {
      if (controller.signal.aborted) throw new Error("تأخر رد الخادم. حدّث البيانات قبل إعادة المحاولة.");
      if (response.ok) throw new Error("استجابة الخادم غير مكتملة. حدّث البيانات قبل إعادة المحاولة.");
      payload = { error: response.status === 401 ? "انتهت جلسة الدخول. سجّل الدخول مجددًا." : "تعذّر الاتصال بالخادم. حاول مجددًا." };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("استجابة الخادم غير مكتملة. حدّث البيانات قبل إعادة المحاولة.");
    }
    return { response, payload: payload as Record<string, unknown> };
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error("تأخر رد الخادم. حدّث البيانات قبل إعادة المحاولة.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
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
