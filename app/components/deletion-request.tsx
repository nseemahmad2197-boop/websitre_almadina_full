"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { deletionPolicy, deletionStatusLabels, type AccountDeletionRequest, type DeletionResponse } from "../lib/account-deletion";
import { requestApiJSON } from "../lib/api-transport";
import { Button, Field, SectionCard } from "./ui";
import { LoadingSkeleton, RefreshStatus, RequestFailure } from "./server-state";

class DeletionApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function deletionApi<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const { response, payload: value } = await requestApiJSON(path, {
    method: payload === undefined ? "GET" : "POST", signal,
    ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  });
  if (!response.ok) throw new DeletionApiError(typeof value.error === "string" ? value.error : "تعذّر إتمام الطلب. أعد المحاولة.", response.status);
  return value as T;
}

const dateLabel = (value: string) => new Date(value).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });

export function DeletionRequestStatus({ request }: { request: Omit<AccountDeletionRequest, "receiptUrl"> & { receiptUrl?: string } }) {
  return <div className="deletion-request-status" role="status">
    <h3>{deletionStatusLabels[request.status]}</h3>
    <p>رقم الطلب: <bdi className="deletion-reference">{request.id}</bdi></p>
    <p>تاريخ التقديم: {dateLabel(request.createdAt)}</p>
    {request.completedAt ? <p>اكتمل الحذف: {dateLabel(request.completedAt)}</p> : <p>موعد المراجعة أو المتابعة: {dateLabel(request.reviewDueAt)}</p>}
    <p className="deletion-message">{request.message}</p>
    {request.receiptUrl && <><a href={request.receiptUrl} target="_blank" rel="noopener noreferrer">افتح رابط متابعة الطلب واحفظه</a><p className="muted-text">الرابط خاص بك. يتيح متابعة الإتمام حتى بعد حذف حسابك، وينتهي بعد 30 يومًا من الإتمام.</p></>}
  </div>;
}

export function DeletionRequestPanel({ publicPage = false, submitRequest, onStatus }: {
  publicPage?: boolean;
  submitRequest?: (password: string, confirmation: string) => Promise<DeletionResponse>;
  onStatus?: (response: DeletionResponse) => void;
}) {
  const [status, setStatus] = useState<(DeletionResponse & { account?: { name: string; email: string } }) | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Omit<AccountDeletionRequest, "receiptUrl"> | null>(null);
  const [receiptMode, setReceiptMode] = useState(false);
  const requestVersion = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const mutationActive = useRef(false);
  const statusCallback = useRef(onStatus);
  statusCallback.current = onStatus;

  useEffect(() => {
    const scope = new AbortController(); lifetime.current = scope;
    setStatus(null); setReceipt(null); setLoaded(false);
    void reload();
    return () => { scope.abort(); readRequest.current?.abort(); ++requestVersion.current; };
  }, [publicPage]);

  async function reload() {
    if (mutationActive.current || lifetime.current?.signal.aborted) return;
    readRequest.current?.abort();
    const request = new AbortController(); readRequest.current = request;
    const version = ++requestVersion.current;
    const token = publicPage ? new URLSearchParams(window.location.hash.slice(1)).get("receipt") : null;
    setReceiptMode(Boolean(token)); setLoading(true); setError("");
    try {
      if (token) {
        const data = await deletionApi<{ request: Omit<AccountDeletionRequest, "receiptUrl"> }>("account/deletion-receipt", { receiptToken: token }, request.signal);
        if (request.signal.aborted || version !== requestVersion.current) return;
        if (!data.request?.id) throw new Error("تعذّر قراءة حالة طلب الحذف.");
        setReceipt(data.request);
      } else {
        const next = await deletionApi<DeletionResponse>("account/deletion-request", undefined, request.signal);
        if (request.signal.aborted || version !== requestVersion.current) return;
        if (!("request" in next)) throw new Error("تعذّر قراءة حالة طلب الحذف.");
        setStatus(next); statusCallback.current?.(next);
      }
      setLoaded(true);
    } catch (error) {
      if (!request.signal.aborted && version === requestVersion.current) {
        if (publicPage && !token && error instanceof DeletionApiError && error.status === 401) { setStatus(null); setLoaded(true); }
        else setError(error instanceof Error ? error.message : "تعذّر تحميل الحالة.");
      }
    } finally { if (!request.signal.aborted && version === requestVersion.current) setLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const scope = lifetime.current;
    if (mutationActive.current || loading || !scope || scope.signal.aborted || confirmation !== "حذف حسابي") return;
    mutationActive.current = true; readRequest.current?.abort(); ++requestVersion.current;
    setBusy(true); setError("");
    try {
      if (publicPage) await deletionApi("login", { email, password }, scope.signal);
      if (scope.signal.aborted) return;
      const next = submitRequest ? await submitRequest(password, confirmation)
        : await deletionApi<DeletionResponse>("account/deletion-request", { password, confirmation }, scope.signal);
      if (scope.signal.aborted) return;
      setStatus(next); setLoaded(true); statusCallback.current?.(next); setConfirmation("");
    } catch (error) { if (!scope.signal.aborted) setError(error instanceof Error ? error.message : "تعذّر تسجيل الطلب. حدّث الحالة قبل إعادة المحاولة."); }
    finally { mutationActive.current = false; if (!scope.signal.aborted) { setBusy(false); setPassword(""); } }
  }

  return <SectionCard className="deletion-request-panel">
    <h2>طلب حذف الحساب والبيانات</h2>
    <p>{deletionPolicy.reviewTimeline}</p>
    {loading && (loaded ? <RefreshStatus label="جارٍ تحديث حالة الطلب…" /> : <LoadingSkeleton kind="detail" label="جارٍ تحميل حالة الطلب…" />)}
    {error && <RequestFailure message={error} onRetry={() => void reload()} busy={loading || busy} compact={loaded} />}
    {status?.account && <p>الحساب: {status.account.name} · <bdi>{status.account.email}</bdi></p>}
    {(receipt ?? status?.request) && <DeletionRequestStatus request={(receipt ?? status!.request)!} />}
    {status?.eligibility && <p>طرود نشطة: {status.eligibility.activeOrderCount} · فواتير غير مدفوعة: {status.eligibility.unsettledCollectionCount} · طرود بلا تحصيل مكتمل: {status.eligibility.unsettledOrderCount}</p>}
    {loaded && !receiptMode && !status?.request && <form className="deletion-request-form" onSubmit={submit}>
      <p>يمكنك تقديم الطلب مع وجود التزامات. بتأكيده تطلب حذف الحساب نهائيًا بعد مراجعة الإدارة وإتمام التسوية. نزّل السجلات التي تحتاجها قبل الإتمام.</p>
      {publicPage && <Field label="البريد الإلكتروني للحساب المطلوب حذفه" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} />}
      <Field label="كلمة المرور الحالية" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} disabled={busy} />
      <Field label="اكتب «حذف حسابي» لتأكيد تقديم الطلب" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={busy} />
      <Button type="submit" variant="danger" icon="trash" loading={busy} disabled={loading || !password || confirmation !== "حذف حسابي" || (publicPage && !email)}>{busy ? "جارٍ تقديم طلب الحذف…" : "تقديم طلب حذف الحساب"}</Button>
    </form>}
    {loaded && <Button variant="outline" onClick={() => void reload()} disabled={busy || loading}>تحديث حالة الطلب</Button>}
    {receiptMode && <p><a href="/delete-account">تقديم طلب جديد</a></p>}
    <details><summary>ما البيانات التي تُحذف ومتى؟</summary><p>{deletionPolicy.retentionNotice}</p></details>
  </SectionCard>;
}
