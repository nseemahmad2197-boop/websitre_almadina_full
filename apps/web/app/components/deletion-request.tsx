"use client";

import { useEffect, useState, type FormEvent } from "react";
import { deletionPolicy, deletionStatusLabels, type AccountDeletionRequest, type DeletionResponse } from "../lib/account-deletion";
import { Button, Field, SectionCard } from "./ui";

export async function deletionApi<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(`/api/almadina/${path}`, {
    method: payload === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "تعذّر إتمام الطلب. أعد المحاولة.");
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
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Omit<AccountDeletionRequest, "receiptUrl"> | null>(null);
  const [receiptMode, setReceiptMode] = useState(false);

  useEffect(() => {
    let active = true;
    const token = publicPage ? new URLSearchParams(window.location.hash.slice(1)).get("receipt") : null;
    setReceiptMode(Boolean(token));
    if (token) {
      deletionApi<{ request: Omit<AccountDeletionRequest, "receiptUrl"> }>("account/deletion-receipt", { receiptToken: token })
        .then((data) => { if (active) setReceipt(data.request); })
        .catch((error) => { if (active) setError(error.message); })
        .finally(() => { if (active) setLoading(false); });
    } else {
      fetch("/api/almadina/account/deletion-request", { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          if (response.status === 401 && publicPage) return;
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "تعذّر تحميل حالة الطلب.");
          if (active) { setStatus(data); onStatus?.(data); }
        })
        .catch((error) => { if (active) setError(error.message); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [publicPage, onStatus]);

  async function reload() {
    setBusy(true); setError("");
    try {
      const token = receiptMode ? new URLSearchParams(window.location.hash.slice(1)).get("receipt") : null;
      if (token) setReceipt((await deletionApi<{ request: Omit<AccountDeletionRequest, "receiptUrl"> }>("account/deletion-receipt", { receiptToken: token })).request);
      else { const next = await deletionApi<DeletionResponse>("account/deletion-request"); setStatus(next); onStatus?.(next); }
    } catch (error) { setError(error instanceof Error ? error.message : "تعذّر تحميل الحالة."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || confirmation !== "حذف حسابي") return;
    setBusy(true); setError("");
    try {
      if (publicPage) await deletionApi("login", { email, password });
      const next = submitRequest ? await submitRequest(password, confirmation)
        : await deletionApi<DeletionResponse>("account/deletion-request", { password, confirmation });
      setStatus(next); onStatus?.(next); setConfirmation("");
    } catch (error) { setError(error instanceof Error ? error.message : "تعذّر تسجيل الطلب. حدّث الحالة قبل إعادة المحاولة."); }
    finally { setBusy(false); setPassword(""); }
  }

  return <SectionCard className="deletion-request-panel">
    <h2>طلب حذف الحساب والبيانات</h2>
    <p>{deletionPolicy.reviewTimeline}</p>
    {loading && <p role="status">جارٍ تحميل حالة الطلب…</p>}
    {error && <p role="alert" className="deletion-error">{error}</p>}
    {status?.account && <p>الحساب: {status.account.name} · <bdi>{status.account.email}</bdi></p>}
    {(receipt ?? status?.request) && <DeletionRequestStatus request={(receipt ?? status!.request)!} />}
    {status?.eligibility && <p>طرود نشطة: {status.eligibility.activeOrderCount} · فواتير غير مدفوعة: {status.eligibility.unsettledCollectionCount} · طرود بلا تحصيل مكتمل: {status.eligibility.unsettledOrderCount}</p>}
    {!loading && !receiptMode && !status?.request && <form className="deletion-request-form" onSubmit={submit}>
      <p>يمكنك تقديم الطلب مع وجود التزامات. بتأكيده تطلب حذف الحساب نهائيًا بعد مراجعة الإدارة وإتمام التسوية. نزّل السجلات التي تحتاجها قبل الإتمام.</p>
      {publicPage && <Field label="البريد الإلكتروني للحساب المطلوب حذفه" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} />}
      <Field label="كلمة المرور الحالية" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} disabled={busy} />
      <Field label="اكتب «حذف حسابي» لتأكيد تقديم الطلب" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={busy} />
      <Button type="submit" variant="danger" icon="trash" loading={busy} disabled={!password || confirmation !== "حذف حسابي" || (publicPage && !email)}>تقديم طلب حذف الحساب</Button>
    </form>}
    {!loading && <Button variant="outline" onClick={reload} disabled={busy}>تحديث حالة الطلب</Button>}
    {receiptMode && <p><a href="/delete-account">تقديم طلب جديد</a></p>}
    <details><summary>ما البيانات التي تُحذف ومتى؟</summary><p>{deletionPolicy.retentionNotice}</p></details>
  </SectionCard>;
}
