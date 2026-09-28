"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import type { AccountDeletionRequest, DeletionEligibility } from "../lib/account-deletion";
import { deletionApi, DeletionRequestStatus } from "./deletion-request";
import { Button, Field, Modal, PageHeader, SectionCard } from "./ui";
import { LoadingSkeleton, RefreshStatus, RequestFailure } from "./server-state";

type QueueEntry = { request: Omit<AccountDeletionRequest, "receiptUrl">; account: { id: string; name: string; email: string; role: string } | null; eligibility: DeletionEligibility | null };
const nextReviewTime = () => { const date = new Date(Date.now() + 7 * 86400_000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export function DeletionRequestsAdminPage() {
  const { user } = useApp();
  return user?.role === "admin" ? <DeletionRequestsAdminContent key={user.id} /> : null;
}

function DeletionRequestsAdminContent() {
  const { user, setView, submitDeletionOperation } = useApp();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<QueueEntry | null>(null);
  const [action, setAction] = useState<"review" | "complete">("review");
  const [message, setMessage] = useState("");
  const [due, setDue] = useState(nextReviewTime);
  const [confirmation, setConfirmation] = useState("");
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutationActive = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; ++requestVersion.current; controller.current?.abort(); };
  }, []);
  async function reload() {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const version = ++requestVersion.current;
    setError(""); setLoading(true);
    try {
      const data = await deletionApi<{ requests: QueueEntry[] }>("admin/deletion-requests", undefined, request.signal);
      if (!mounted.current || request.signal.aborted || version !== requestVersion.current) return;
      if (!Array.isArray(data.requests)) throw new Error("تعذّر قراءة طلبات حذف الحسابات.");
      setEntries(data.requests); setLoaded(true);
    } catch (error) { if (mounted.current && !request.signal.aborted && version === requestVersion.current) setError(error instanceof Error ? error.message : "تعذّر تحميل الطلبات."); }
    finally { if (mounted.current && !request.signal.aborted && version === requestVersion.current) setLoading(false); }
  }
  function open(entry: QueueEntry, operation: "review" | "complete") {
    setSelected(entry); setAction(operation); setMessage(""); setDue(nextReviewTime()); setConfirmation(""); setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!selected || mutationActive.current) return;
    mutationActive.current = true;
    setBusy(true); setError("");
    try {
      await submitDeletionOperation("admin/deletion-requests", { id: selected.request.id, action, message, confirmation, ...(action === "review" ? { reviewDueAt: new Date(due).toISOString() } : {}) });
      if (!mounted.current) return;
      setSelected(null); await reload();
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "تعذّر معالجة الطلب."); }
    finally { mutationActive.current = false; if (mounted.current) setBusy(false); }
  }
  if (user?.role !== "admin") return null;
  return <div className="page-content deletion-admin-page"><PageHeader title="طلبات حذف الحسابات" subtitle="راجع الطلبات خلال 7 أيام وأبلغ صاحب الطلب بخطوات التسوية وموعد المتابعة." onBack={() => setView("admin")} />
    <Button variant="outline" onClick={reload} disabled={busy || loading}>تحديث الطلبات</Button>
    {error && !selected && <RequestFailure message={error} onRetry={() => void reload()} busy={busy || loading} compact={loaded} />}
    {loading && (loaded ? <RefreshStatus label="جارٍ تحديث طلبات الحذف…" /> : <LoadingSkeleton kind="list" label="جارٍ تحميل طلبات الحذف…" />)}
    {loaded && !loading && !error && !entries.length && <p>لا توجد طلبات حذف حساب.</p>}
    {entries.map((entry) => <SectionCard key={entry.request.id}>
      {entry.account && <h2>{entry.account.name} · <bdi>{entry.account.email}</bdi></h2>}
      {entry.request.status !== "completed" && Date.parse(entry.request.reviewDueAt) < Date.now() && <p className="deletion-error">تجاوز الطلب موعد المراجعة. حدّث حالة الطلب وإجراءات المتابعة.</p>}
      <DeletionRequestStatus request={entry.request} />
      {entry.eligibility && <p>طرود نشطة: {entry.eligibility.activeOrderCount} · فواتير غير مدفوعة: {entry.eligibility.unsettledCollectionCount} · طرود بلا تحصيل مكتمل: {entry.eligibility.unsettledOrderCount}</p>}
      {entry.account && entry.request.status !== "completed" && <div className="deletion-admin-actions"><Button onClick={() => open(entry, "review")} disabled={busy}>تحديث إجراءات المتابعة</Button><Button variant="danger" onClick={() => open(entry, "complete")} disabled={busy || !entry.eligibility?.eligible}>إتمام حذف الحساب</Button></div>}
    </SectionCard>)}
    {selected && <Modal title={action === "review" ? "إجراءات التسوية والمتابعة" : "إتمام الحذف النهائي"} onClose={() => { if (!busy) setSelected(null); }} closeDisabled={busy}>
      <form onSubmit={submit} className="deletion-request-form"><p>{selected.account?.name} · <bdi>{selected.account?.email}</bdi></p>
        {action === "review" ? <><label className="field"><span className="field__label">رسالة لصاحب الحساب تتضمن خطوات التسوية</span><textarea required maxLength={1500} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} /></label><Field label="موعد المتابعة القادم (خلال 30 يومًا)" type="datetime-local" required value={due} onChange={(event) => setDue(event.target.value)} disabled={busy} /></> : <><p>سيُحذف الحساب وبياناته نهائيًا وتُلغى وسائل دخوله. يعيد الخادم التحقق من التسوية قبل التنفيذ.</p><Field label="اكتب «إتمام الحذف»" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} required /></>}
        {error && <p role="alert" className="deletion-error">{error}</p>}
        <Button type="submit" variant={action === "complete" ? "danger" : "primary"} loading={busy} disabled={action === "complete" ? confirmation !== "إتمام الحذف" : !message.trim() || !due}>{busy ? action === "complete" ? "جارٍ إتمام حذف الحساب…" : "جارٍ حفظ إجراءات المتابعة…" : "تأكيد"}</Button>
      </form>
    </Modal>}
  </div>;
}
