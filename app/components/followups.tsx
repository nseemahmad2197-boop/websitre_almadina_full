"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import type { Order } from "../lib/data";
import { FOLLOWUP_LIMITS, FOLLOWUP_STATUSES, FOLLOWUP_TYPES, followupStatusLabel, followupTypeLabel, type Followup, type FollowupAttachment, type FollowupComment, type FollowupCommentList, type FollowupList, type FollowupStatus, type FollowupType } from "../lib/followups";
import { bindFollowupAccount, canonicalFollowupPrice, createFollowup, downloadFollowupFile, editFollowup, followupApi, FollowupApiError, postFollowupComment, uploadFollowupFile, validFollowup, validFollowupComment, validateFollowupFiles, type FollowupCommentDraft, type FollowupDraft, type FollowupEditDraft, type PendingFollowupFile } from "../lib/followup-client";
import { Button, Field, Modal, PageHeader, SectionCard, SelectField } from "./ui";

const errorText = (error: unknown) => error instanceof Error ? error.message : "تعذّر الاتصال. حاول مجددًا.";
const sizeLabel = (size: number) => `${(size / (1024 * 1024)).toFixed(1)} ميغابايت`;
const dateLabel = (value: string) => new Date(value).toLocaleString("ar-PS");

function useRequests(accountId: string): AbortSignal {
  const [controller, setController] = useState(() => new AbortController());
  bindFollowupAccount(controller.signal, accountId);
  useEffect(() => {
    // The development StrictMode remount receives a fresh request scope.
    if (controller.signal.aborted) { setController(new AbortController()); return; }
    return () => controller.abort();
  }, [controller, accountId]);
  return controller.signal;
}

export function ParcelFollowups({ order }: { order: Order }) {
  const { user } = useApp();
  return user ? <FollowupCollection key={`${user.id}:${order.id}`} accountId={user.id} order={order} /> : null;
}

export function FollowupsPage() {
  const { user, setView } = useApp();
  return user ? <div className="page-content followups-page"><PageHeader title="المتابعات" subtitle="طلبات مرتبطة بالطرود وردود فريق المتابعة" onBack={() => setView(user.role === "admin" ? "admin" : "home")} /><FollowupCollection key={user.id} accountId={user.id} /></div> : null;
}

export function FollowupCollection({ accountId, order, merchantId }: { accountId: string; order?: Order; merchantId?: string }) {
  const { user, database, setSelectedOrderId, setView } = useApp();
  const canCreate = user?.id === accountId && user.role === "merchant" && !!order && !order.deleted && order.merchantId === user.id;
  const signal = useRequests(accountId);
  const [entries, setEntries] = useState<Followup[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Followup | null>(null);
  const [created, setCreated] = useState<Followup | null>(null);
  const loadNumber = useRef(0);
  async function load(cursor?: string) {
    const number = ++loadNumber.current;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (order) params.set("orderId", order.id);
    if (merchantId) params.set("merchantId", merchantId);
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await followupApi<FollowupList>(`followups?${params}`, signal);
      if (signal.aborted || number !== loadNumber.current) return;
      if (!Array.isArray(result.followups) || !result.followups.every((item) => validFollowup(item) && (!merchantId || (item.merchantId ?? database.orders.find((parcel) => parcel.id === item.orderId)?.merchantId) === merchantId))
        || (result.nextCursor !== null && typeof result.nextCursor !== "string")) throw new Error("تعذّر قراءة المتابعات.");
      setEntries((previous) => cursor ? [...previous, ...result.followups.filter((item) => !previous.some((existing) => existing.id === item.id))] : result.followups);
      setNext(result.nextCursor);
    } catch (error) { if (!signal.aborted && number === loadNumber.current) setError(errorText(error)); }
    finally { if (!signal.aborted && number === loadNumber.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [signal]); // account/parcel identity is a component key
  function updated(item: Followup) { setEntries((current) => current.map((row) => row.id === item.id ? item : row)); setSelected(item); }
  return <SectionCard title={order ? "متابعات الطرد" : "طلبات المتابعة"} icon="message" className="followup-section" action={canCreate ? <Button icon="plus" onClick={() => setCreating(true)}>إنشاء متابعة</Button> : undefined}>
    {!order && <p className="followup-hint">{user?.role === "merchant" ? "لإنشاء متابعة، افتح تفاصيل الطرد واضغط «إنشاء متابعة»." : "اختر متابعة للاطلاع على تفاصيلها ومرفقاتها والرد عليها."}</p>}
    <div className="followup-toolbar"><Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث المتابعات</Button><span aria-live="polite">{loading ? "جارٍ التحميل…" : `${entries.length.toLocaleString("ar-EG")} متابعة`}</span></div>
    {error && <p className="followup-error" role="alert">{error}</p>}
    {!loading && !error && !entries.length && <p className="followup-empty">لا توجد متابعات{order ? " لهذا الطرد" : " حتى الآن"}.</p>}
    <div className="followup-list">{entries.map((item) => <button type="button" key={item.id} className="followup-row" onClick={() => setSelected(item)}>
      <span className={`followup-status followup-status--${item.status}`}>{followupStatusLabel(item.status)}</span>
      <strong>{item.title}</strong><span>{followupTypeLabel(item.type)}</span>
      {!order && <span>{item.trackingNumber || database.orders.find((parcel) => parcel.id === item.orderId)?.trackingNumber || "متابعة طرد"}</span>}
      <small>{dateLabel(item.createdAt)}{item.attachments.length ? ` · ${item.attachments.length} مرفقات` : ""}</small>
    </button>)}</div>
    {next && <Button variant="outline" loading={loading} onClick={() => void load(next)}>عرض المزيد</Button>}
    {creating && canCreate && order && <FollowupForm key={`${accountId}:${order.id}`} order={order} accountId={accountId} onClose={() => { setCreating(false); void load(); }} onCreated={(item) => {
      if (signal.aborted) return;
      setCreating(false); setEntries((current) => [item, ...current.filter((existing) => existing.id !== item.id)]); setCreated(item);
    }} />}
    {created && <FollowupSuccess item={created} onClose={() => setCreated(null)} onDetails={() => { setSelected(created); setCreated(null); }} onCollection={() => { setCreated(null); setView("followups"); }} />}
    {selected && <FollowupDetails key={`${accountId}:${selected.id}`} item={selected} accountId={accountId} canRespond={user?.role === "admin" || user?.role === "courier"} onClose={() => setSelected(null)} onUpdated={updated} onParcel={!order ? () => { setSelectedOrderId(selected.orderId); setView("order-detail"); } : undefined} />}
  </SectionCard>;
}

function normalizeFile(file: File): File {
  if (file.type) return file;
  const extensions: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" };
  const type = extensions[file.name.split(".").pop()?.toLowerCase() ?? ""];
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}

type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; size: number; discard: boolean; timeout: ReturnType<typeof setTimeout> };
type ParcelIdentity = Pick<Order, "id" | "trackingNumber">;

function FollowupSuccess({ item, onClose, onDetails, onCollection }: { item: Followup; onClose: () => void; onDetails: () => void; onCollection: () => void }) {
  return <Modal title="تم الحفظ" ariaLabel="تم إنشاء المتابعة بنجاح" onClose={onClose} className="followup-modal followup-success">
    <div className="followup-success-check" aria-hidden="true">✓</div>
    <h2>تم إنشاء المتابعة بنجاح</h2><p>تم إرسال متابعتك إلى فريق المتابعة. يمكنك العودة إلى هذا الطلب للاطلاع على الردود والتواصل معنا.</p>
    <dl className="followup-info"><div><dt>رقم المتابعة</dt><dd><bdi>{item.ticketNumber || item.id}</bdi></dd></div><div><dt>النوع</dt><dd>{followupTypeLabel(item.type)}</dd></div></dl>
    <h3>ما الخطوة التالية؟</h3><p>افتح صفحة المتابعة للاطلاع على تقدم الطلب وإضافة رسالة أو مرفق.</p>
    <div className="followup-success-actions"><Button variant="outline" onClick={onDetails}>عرض المتابعة</Button><Button onClick={onCollection}>عرض المتابعات</Button></div>
  </Modal>;
}

function FollowupForm({ order, accountId, initial, onClose, onCreated }: { order: ParcelIdentity; accountId: string; initial?: Followup; onClose: () => void; onCreated: (item: Followup) => void }) {
  const signal = useRequests(accountId);
  const defaultTitle = initial?.title ?? `متابعة طرد ${order.trackingNumber || order.id}`;
  const [type, setType] = useState<FollowupType | "">(initial?.type ?? "");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [requestedPrice, setRequestedPrice] = useState(initial?.requestedPrice ?? "");
  const [requestedAddress, setRequestedAddress] = useState(initial?.requestedAddress ?? "");
  const [files, setFiles] = useState<PendingFollowupFile[]>([]);
  const filesRef = useRef<PendingFollowupFile[]>([]);
  const [existing, setExisting] = useState(initial?.attachments ?? []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const submittedDraft = useRef<FollowupDraft | FollowupEditDraft | null>(null);
  const confirmationUncertain = useRef(false);
  const locked = busy || submittedDraft.current !== null || conflict;
  const evidenceRequired = type === "damaged" || type === "lost";
  function changeFiles(next: PendingFollowupFile[]) { if (busyRef.current || submittedDraft.current) return; filesRef.current = next; setFiles(next); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || mediaBusy || signal.aborted || conflict) return;
    if (!submittedDraft.current) {
      if (!type || !title.trim() || !description.trim()) { setError("اختر نوع المتابعة واكتب عنوانها ووصفها."); return; }
      if (type === "price-change" && canonicalFollowupPrice(requestedPrice) === null) { setError("أدخل السعر المطلوب بين 0 و999999999.99، بخانتين عشريتين كحد أقصى."); return; }
      if (type === "address-change" && !requestedAddress.trim()) { setError("أدخل عنوان المستلم المطلوب."); return; }
      if (evidenceRequired && !files.length && !existing.length) { setError("أرفق صورة أو تسجيلًا أو فيديو لتوضيح حالة الطرد."); return; }
    }
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (!submittedDraft.current) {
        const attachmentIds = existing.map((attachment) => attachment.id);
        for (const item of filesRef.current) attachmentIds.push(await uploadFollowupFile(order.id, item, signal, setProgress));
        const details = { requestId: requestId.current, title: title.trim(), description: description.trim(), attachmentIds,
          ...(type === "price-change" ? { requestedPrice: canonicalFollowupPrice(requestedPrice)! } : {}),
          ...(type === "address-change" ? { requestedAddress: requestedAddress.trim() } : {}) };
        submittedDraft.current = initial ? { ...details, expectedUpdatedAt: initial.updatedAt } : { ...details, orderId: order.id, type: type as FollowupType, detailsVersion: 1 };
      }
      setProgress(initial ? "جارٍ حفظ التعديل…" : "جارٍ حفظ المتابعة…");
      const item = initial ? await editFollowup(initial.id, submittedDraft.current as FollowupEditDraft, signal) : await createFollowup(submittedDraft.current as FollowupDraft, signal);
      if (!signal.aborted) { confirmationUncertain.current = false; onCreated(item); }
    } catch (error) {
      if (!signal.aborted) {
        if (submittedDraft.current) {
          const rejected = error instanceof FollowupApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
          if (!rejected) confirmationUncertain.current = true;
          if (rejected && !confirmationUncertain.current) { submittedDraft.current = null; requestId.current = crypto.randomUUID(); }
          if (initial && error instanceof FollowupApiError && error.status === 409) { setConflict(true); setError("تم تحديث المتابعة. أغلق نموذج التعديل وحدّث المتابعة ثم أعد فتحها قبل التعديل."); return; }
        }
        setError(errorText(error));
      }
    } finally { busyRef.current = false; if (!signal.aborted) { setBusy(false); setProgress(""); } }
  }
  function close() {
    if (busyRef.current) return;
    const changed = title !== defaultTitle || description !== (initial?.description ?? "") || requestedPrice !== (initial?.requestedPrice ?? "") || requestedAddress !== (initial?.requestedAddress ?? "") || files.length || existing.length !== (initial?.attachments.length ?? 0) || mediaBusy;
    if (!conflict && changed && !window.confirm(confirmationUncertain.current ? "لم يصل تأكيد الحفظ وقد تكون المتابعة أُرسلت. هل تريد إغلاق النموذج ومراجعة المتابعات؟" : "الخروج دون حفظ المتابعة؟ ستُحذف المسودة من هذا الجهاز.")) return;
    onClose();
  }
  return <Modal title={initial ? "تعديل المتابعة" : "إنشاء متابعة"} onClose={close} closeDisabled={busy} className="followup-modal" sheet>
    <form onSubmit={submit} className="followup-form">
      <fieldset disabled={locked}>
        <SelectField label="نوع المتابعة" aria-label="نوع المتابعة" value={type} required disabled={!!initial || locked} onChange={(event) => setType(event.target.value as FollowupType)}><option value="" disabled>اختر نوع المتابعة</option>{FOLLOWUP_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>
        <Field label="عنوان المتابعة" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={FOLLOWUP_LIMITS.title} required />
        <label className="field"><span className="field__label">الوصف</span><textarea aria-label="الوصف" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={FOLLOWUP_LIMITS.description} rows={4} required placeholder="وضّح طلبك أو المشكلة المتعلقة بالطرد" /></label>
        <section className="followup-extra"><h3>معلومات إضافية</h3><Field label="رقم الطرد" aria-label="رقم الطرد" value={order.trackingNumber || order.id} readOnly dir="ltr" hint="هذا الحقل يُملأ تلقائيًا بناءً على رقم الطرد ولا يمكن تعديله." />
          {type === "price-change" && <Field label="السعر المطلوب" aria-label="السعر المطلوب" value={requestedPrice} onChange={(event) => setRequestedPrice(event.target.value)} inputMode="decimal" maxLength={12} required placeholder="0.00" suffix={<span>₪</span>} hint="سيُرسل السعر إلى فريق المتابعة للمراجعة." />}
          {type === "address-change" && <label className="field"><span className="field__label">عنوان المستلم المطلوب</span><textarea aria-label="عنوان المستلم المطلوب" value={requestedAddress} onChange={(event) => setRequestedAddress(event.target.value)} maxLength={1000} rows={3} required placeholder="المدينة، المنطقة، الشارع وأقرب معلم" /></label>}
        </section>
        {existing.length > 0 && <section className="followup-existing"><h3>المرفقات الحالية ({existing.length}/{FOLLOWUP_LIMITS.files})</h3>{existing.map((attachment) => <div className="followup-existing-file" key={attachment.id}><div className="followup-toolbar"><span><bdi>{attachment.name}</bdi> · {sizeLabel(attachment.size)}</span><Button type="button" variant="ghost" aria-label={`إزالة ${attachment.name}`} onClick={() => setExisting((items) => items.filter((item) => item.id !== attachment.id))}>إزالة</Button></div>{attachment.mimeType.startsWith("audio/") && <AttachmentPreview item={attachment} accountId={accountId} />}</div>)}</section>}
        <MediaPicker accountId={accountId} files={files} onChange={changeFiles} existing={existing} disabled={locked} onActivity={setMediaBusy} evidenceRequired={evidenceRequired} />
      </fieldset>
      {error && <p className="followup-error" role="alert">{error}</p>}
      {!busy && submittedDraft.current && !conflict && <p className="followup-hint">لم يصل تأكيد الحفظ. أعد المحاولة للتحقق من الطلب نفسه دون إنشاء نسخة مكررة.</p>}
      {progress && <p role="status" aria-live="polite">{progress}</p>}
      <div className="followup-submit"><Button type="submit" full loading={busy} disabled={mediaBusy || conflict}>{submittedDraft.current && !busy ? "إعادة محاولة التأكيد" : initial ? "تعديل المتابعة" : "تأكيد"}</Button></div>
    </form>
  </Modal>;
}

function MediaPicker({ accountId, files, onChange, existing = [], disabled = false, onActivity, evidenceRequired = false, prefix = "" }: { accountId: string; files: PendingFollowupFile[]; onChange: (files: PendingFollowupFile[]) => void; existing?: FollowupAttachment[]; disabled?: boolean; onActivity: (active: boolean) => void; evidenceRequired?: boolean; prefix?: string }) {
  const signal = useRequests(accountId);
  const latest = useRef({ files, onChange, existing, disabled, onActivity });
  latest.current = { files, onChange, existing, disabled, onActivity };
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const microphonePending = useRef(false);
  const recordingRef = useRef<Recording | null>(null);
  function addFiles(incoming: File[]) {
    const current = latest.current;
    if (signal.aborted || current.disabled) return;
    const next = [...current.files, ...incoming.map(normalizeFile).map((file) => ({ id: crypto.randomUUID(), file }))];
    const issue = validateFollowupFiles([...current.existing.map((file) => ({ name: file.name, size: file.size, type: file.mimeType })), ...next.map((item) => item.file)]);
    if (issue) { setError(issue); return; }
    current.onChange(next); setError("");
  }
  function choose(event: ChangeEvent<HTMLInputElement>) { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }
  function stopRecording(discard = false) {
    const current = recordingRef.current;
    if (!current) return;
    current.discard ||= discard; clearTimeout(current.timeout);
    if (current.recorder.state !== "inactive") current.recorder.stop();
    current.stream.getTracks().forEach((track) => track.stop());
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stopRecording(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); stopRecording(true); };
  }, []);
  async function startRecording() {
    if (microphonePending.current || recordingRef.current || latest.current.disabled) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("التسجيل غير متاح في هذا المتصفح. يمكنك إرفاق ملف صوتي محفوظ."); return; }
    if (latest.current.files.length + latest.current.existing.length >= FOLLOWUP_LIMITS.files) { setError("احذف مرفقًا قبل إضافة تسجيل صوتي."); return; }
    microphonePending.current = true; setMicPending(true); latest.current.onActivity(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (signal.aborted || document.hidden || latest.current.disabled) { stream.getTracks().forEach((track) => track.stop()); return; }
      const mimeType = ["audio/mp4", "audio/webm", "audio/ogg"].find((mime) => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error("التسجيل غير مدعوم. اختر ملفًا صوتيًا محفوظًا.");
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      const current: Recording = { recorder, stream, chunks: [], size: 0, discard: false, timeout: setTimeout(() => stopRecording(), 120000) };
      recordingRef.current = current;
      recorder.ondataavailable = (event) => {
        if (!event.data.size || current.discard) return;
        current.size += event.data.size;
        if (current.size > FOLLOWUP_LIMITS.fileBytes) { current.discard = true; stopRecording(true); if (!signal.aborted) setError("تجاوز التسجيل الحد المسموح. سجّل مقطعًا أقصر."); }
        else current.chunks.push(event.data);
      };
      recorder.onerror = () => { stopRecording(true); if (!signal.aborted) setError("تعذّر التسجيل. حاول مجددًا أو أرفق ملفًا صوتيًا."); };
      recorder.onstop = () => {
        clearTimeout(current.timeout); current.stream.getTracks().forEach((track) => track.stop());
        if (recordingRef.current === current) recordingRef.current = null;
        if (signal.aborted) return;
        setRecording(false); latest.current.onActivity(false);
        if (!current.discard && current.size) {
          const extension = mimeType === "audio/mp4" ? "m4a" : mimeType === "audio/ogg" ? "ogg" : "webm";
          addFiles([new File(current.chunks, `تسجيل-${Date.now()}.${extension}`, { type: mimeType })]);
        }
      };
      recorder.start(500); setRecording(true);
    } catch (error) {
      if (recordingRef.current) { clearTimeout(recordingRef.current.timeout); recordingRef.current.discard = true; recordingRef.current = null; }
      stream?.getTracks().forEach((track) => track.stop());
      if (!signal.aborted) { setRecording(false); setError(error instanceof DOMException && error.name === "NotAllowedError" ? "تم رفض إذن الميكروفون. يمكنك السماح به من إعدادات المتصفح أو إرفاق ملف صوتي." : errorText(error)); }
    } finally { microphonePending.current = false; if (!signal.aborted) { setMicPending(false); if (!recordingRef.current) latest.current.onActivity(false); } }
  }
  return <section className="followup-media" aria-label={prefix + "المرفقات"}>
    <h3>المرفقات {evidenceRequired ? <span className="followup-required">(مطلوب)</span> : "(اختياري)"} <small>{existing.length + files.length}/{FOLLOWUP_LIMITS.files}</small></h3>
    <div className="followup-media-actions"><label className="followup-file-control">اختيار صور<input disabled={disabled} aria-label={prefix + "اختيار صور من المعرض"} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple onChange={choose} /></label><label className="followup-file-control">فتح الكاميرا<input disabled={disabled} aria-label={prefix + "التقاط صورة"} type="file" accept="image/*" capture="environment" onChange={choose} /></label><label className="followup-file-control">إرفاق ملف<input disabled={disabled} aria-label={prefix + "إرفاق ملف وسائط"} type="file" accept="image/*,audio/*,video/*" multiple onChange={choose} /></label></div>
    <h3>تسجيل صوتي</h3><div className="followup-media-actions">{recording ? <Button type="button" variant="danger" onClick={() => stopRecording()}>إيقاف التسجيل</Button> : <Button type="button" variant="outline" disabled={disabled} loading={micPending} onClick={() => void startRecording()}>بدء التسجيل</Button>}<label className="followup-file-control">اختيار ملف صوتي<input disabled={disabled} aria-label={prefix + "إرفاق ملف صوتي"} type="file" accept="audio/*" onChange={choose} /></label></div>
    {recording && <p role="status" className="followup-recording">يجري التسجيل… الحد الأقصى دقيقتان. يتوقف التسجيل عند مغادرة الصفحة.</p>}
    <h3>مقاطع الفيديو</h3><div className="followup-media-actions"><label className="followup-file-control">اختيار فيديو<input disabled={disabled} aria-label={prefix + "اختيار فيديو من المعرض"} type="file" accept="video/*" onChange={choose} /></label><label className="followup-file-control">تصوير فيديو<input disabled={disabled} aria-label={prefix + "التقاط فيديو بالكاميرا"} type="file" accept="video/*" capture="environment" onChange={choose} /></label></div>
    <p className="followup-hint">{evidenceRequired ? "أرفق دليلًا يوضح حالة الطرد. " : ""}حتى 5 ملفات، 10 ميغابايت للملف و20 ميغابايت للمجموع. اختر فيديو قصيرًا.</p>
    {files.length > 0 && <ul className="followup-files">{files.map((item) => <li key={item.id}><div className="followup-draft-file"><span><bdi>{item.file.name}</bdi><small>{sizeLabel(item.file.size)}</small></span><DraftPreview item={item} /></div><Button type="button" variant="ghost" disabled={disabled} aria-label={`إزالة ${item.file.name}`} onClick={() => { if (!latest.current.disabled) latest.current.onChange(latest.current.files.filter((file) => file.id !== item.id)); }}>إزالة</Button></li>)}</ul>}
    {error && <p className="followup-error" role="alert">{error}</p>}
  </section>;
}

function DraftPreview({ item }: { item: PendingFollowupFile }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const objectUrl = URL.createObjectURL(item.file); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [item.file]);
  if (!url) return null;
  return item.file.type.startsWith("image/") ? <img className="followup-draft-image" src={url} alt={`معاينة ${item.file.name}`} /> : item.file.type.startsWith("audio/") ? <audio aria-label={`معاينة ${item.file.name}`} controls src={url} preload="metadata" /> : <video aria-label={`معاينة ${item.file.name}`} controls playsInline src={url} preload="metadata" />;
}

function FollowupDetails({ item, accountId, canRespond, onClose, onUpdated, onParcel }: { item: Followup; accountId: string; canRespond: boolean; onClose: () => void; onUpdated: (item: Followup) => void; onParcel?: () => void }) {
  const { database } = useApp();
  const signal = useRequests(accountId);
  const [status, setStatus] = useState<FollowupStatus>(item.status);
  const [response, setResponse] = useState(item.response);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const tracking = item.trackingNumber || database.orders.find((parcel) => parcel.id === item.orderId)?.trackingNumber || item.orderId;
  useEffect(() => { setStatus(item.status); setResponse(item.response); }, [item.status, item.response]);
  async function refresh() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await followupApi<{ followup: unknown }>(`followups/${encodeURIComponent(item.id)}`, signal);
      if (!validFollowup(result.followup) || result.followup.id !== item.id || result.followup.orderId !== item.orderId) throw new Error("تعذّر تحديث المتابعة. أغلق التفاصيل وحدّث القائمة.");
      if (!signal.aborted) onUpdated(result.followup);
    } catch (error) { if (!signal.aborted) setError(errorText(error)); }
    finally { busyRef.current = false; if (!signal.aborted) setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await followupApi<{ followup: Followup }>(`followups/${encodeURIComponent(item.id)}/status`, signal, { status, response: response.trim() });
      if (!validFollowup(result.followup) || result.followup.id !== item.id) throw new Error("لم يصل تأكيد التحديث كاملًا. أعد المحاولة أو حدّث قائمة المتابعات.");
      if (!signal.aborted) onUpdated(result.followup);
    } catch (error) { if (!signal.aborted) setError(errorText(error)); }
    finally { busyRef.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <Modal title="تفاصيل المتابعة" onClose={onClose} className="followup-modal" closeDisabled={busy} sheet>
    <div className="followup-detail"><div className="followup-detail-actions"><Button variant="ghost" onClick={() => void refresh()} loading={busy}>تحديث المتابعة</Button>{item.canEdit === true && item.creatorId === accountId && item.status !== "resolved" && <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>تعديل المتابعة</Button>}<Button variant="ghost" onClick={onClose} disabled={busy}>رجوع إلى المتابعات</Button></div>
      <section className="followup-summary"><div><span className={`followup-status followup-status--${item.status}`}>{followupStatusLabel(item.status)}</span><h2>{item.title}</h2><p>{followupTypeLabel(item.type)}</p><p className="followup-description">{item.description}</p></div><dl className="followup-info"><div><dt>رقم المتابعة</dt><dd><bdi>{item.ticketNumber || item.id}</bdi></dd></div><div><dt>المنشئ</dt><dd>{item.creatorName}</dd></div><div><dt>تاريخ الإنشاء</dt><dd>{dateLabel(item.createdAt)}</dd></div><div><dt>آخر تحديث</dt><dd>{dateLabel(item.updatedAt)}</dd></div></dl></section>
      <section className="followup-extra"><h3>معلومات إضافية</h3><dl className="followup-info"><div><dt>رقم الطرد</dt><dd><bdi>{tracking}</bdi></dd></div>{item.type === "price-change" && <div><dt>السعر المطلوب</dt><dd>{item.requestedPrice != null ? <><bdi>{item.requestedPrice}</bdi> ₪</> : "لم يُحدد في المتابعة السابقة"}</dd></div>}{item.type === "address-change" && <div><dt>عنوان المستلم المطلوب</dt><dd className="followup-description">{item.requestedAddress || "لم يُحدد في المتابعة السابقة"}</dd></div>}</dl></section>
      {item.attachments.length > 0 && <section><h3>المرفقات ({item.attachments.length})</h3><PrivateAttachments items={item.attachments} accountId={accountId} /></section>}
      {item.response && <section className="followup-response"><h3>رد فريق المتابعة</h3><p className="followup-hint">رد سابق محفوظ مع حالة المتابعة</p><p className="followup-description">{item.response}</p><small>آخر تحديث: {dateLabel(item.updatedAt)}</small></section>}
      {onParcel && <Button variant="ghost" onClick={onParcel}>فتح تفاصيل الطرد</Button>}
      {error && <p role="alert" className="followup-error">{error}</p>}
      <FollowupConversation key={`${accountId}:${item.id}`} item={item} accountId={accountId} />
      {canRespond && <form onSubmit={submit} className="followup-form followup-response-form"><h3>إدارة حالة المتابعة</h3><SelectField label="حالة المتابعة" aria-label="حالة المتابعة" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as FollowupStatus)}>{FOLLOWUP_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</SelectField><label className="field"><span className="field__label">الرد على صاحب المتابعة</span><textarea aria-label="الرد على صاحب المتابعة" value={response} onChange={(event) => setResponse(event.target.value)} maxLength={FOLLOWUP_LIMITS.response} rows={4} disabled={busy} required /></label><Button type="submit" loading={busy}>حفظ الرد والحالة</Button></form>}
    </div>
    {editing && <FollowupForm order={{ id: item.orderId, trackingNumber: tracking }} accountId={accountId} initial={item} onClose={() => setEditing(false)} onCreated={(updated) => { setEditing(false); onUpdated(updated); }} />}
  </Modal>;
}

function FollowupConversation({ item, accountId }: { item: Followup; accountId: string }) {
  const signal = useRequests(accountId);
  const [comments, setComments] = useState<FollowupComment[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFollowupFile[]>([]);
  const filesRef = useRef<PendingFollowupFile[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [progress, setProgress] = useState("");
  const sequence = useRef(0);
  const submitted = useRef<FollowupCommentDraft | null>(null);
  const uncertain = useRef(false);
  const requestId = useRef(crypto.randomUUID());
  const locked = busy || submitted.current !== null;
  async function load(cursor?: string) {
    const current = ++sequence.current; setLoading(true); setLoadError("");
    try {
      const result = await followupApi<FollowupCommentList>(`followups/${encodeURIComponent(item.id)}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, signal);
      if (signal.aborted || current !== sequence.current) return;
      if (!Array.isArray(result.comments) || !result.comments.every((comment) => validFollowupComment(comment) && comment.followupId === item.id) || result.nextCursor !== null && typeof result.nextCursor !== "string") throw new Error("تعذّر قراءة المحادثة. أعد المحاولة.");
      setComments((previous) => [...new Map([...result.comments, ...(cursor ? previous : [])].map((comment) => [comment.id, comment])).values()]); setNext(result.nextCursor);
    } catch (error) { if (!signal.aborted && current === sequence.current) setLoadError(errorText(error)); }
    finally { if (!signal.aborted && current === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [signal]);
  async function send(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || mediaBusy || signal.aborted) return;
    if (!submitted.current && !text.trim() && !filesRef.current.length) { setError("اكتب رسالة أو أرفق ملفًا قبل الإرسال."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (!submitted.current) {
        const attachmentIds: string[] = [];
        for (const file of filesRef.current) attachmentIds.push(await uploadFollowupFile(item.orderId, file, signal, setProgress));
        submitted.current = { requestId: requestId.current, text: text.trim(), attachmentIds };
      }
      setProgress("جارٍ إرسال الرسالة…");
      const comment = await postFollowupComment(item.id, submitted.current, signal);
      if (signal.aborted) return;
      ++sequence.current; setLoading(false);
      setComments((previous) => [...previous.filter((entry) => entry.id !== comment.id), comment].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      submitted.current = null; uncertain.current = false; requestId.current = crypto.randomUUID(); setText(""); filesRef.current = []; setFiles([]); setMediaOpen(false);
    } catch (error) {
      if (!signal.aborted) {
        if (submitted.current) {
          const rejected = error instanceof FollowupApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
          if (!rejected) uncertain.current = true;
          if (rejected && !uncertain.current) { submitted.current = null; requestId.current = crypto.randomUUID(); }
        }
        setError(errorText(error));
      }
    } finally { busyRef.current = false; if (!signal.aborted) { setBusy(false); setProgress(""); } }
  }
  return <section className="followup-conversation" aria-label="تواصل معنا"><div className="followup-toolbar"><h3>تواصل معنا</h3><Button variant="ghost" disabled={loading || busy} onClick={() => void load()}>تحديث المحادثة</Button></div>
    {loading && <p role="status">جارٍ تحميل المحادثة…</p>}{loadError && <div><p className="followup-error" role="alert">{loadError}</p><Button variant="outline" onClick={() => void load()}>إعادة تحميل المحادثة</Button></div>}
    {!comments.length && !loading && !loadError && <p className="followup-hint">لا توجد رسائل بعد. أضف رسالة للتواصل حول هذه المتابعة.</p>}
    <ol className="followup-thread" aria-live="polite">{comments.map((comment) => <li key={comment.id} className={comment.authorId === accountId ? "followup-comment followup-comment--own" : "followup-comment"}><div className="followup-toolbar"><strong>{comment.authorName}</strong><span>{comment.authorRole === "admin" ? "فريق المتابعة" : comment.authorRole === "courier" ? "المندوب" : "التاجر"}</span></div>{comment.text && <p className="followup-description">{comment.text}</p>}<PrivateAttachments items={comment.attachments} accountId={accountId} /><time dateTime={comment.createdAt}>{dateLabel(comment.createdAt)}</time></li>)}</ol>
    {next && <Button variant="outline" disabled={loading || busy} onClick={() => void load(next)}>عرض الرسائل الأقدم</Button>}
    <form className="followup-form followup-composer" onSubmit={send}><label className="field"><span className="field__label">رسالتك</span><textarea aria-label="رسالتك" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={3} disabled={locked} placeholder="تواصل معنا بشأن هذه المتابعة" /></label>
      <Button type="button" variant="outline" aria-expanded={mediaOpen} disabled={locked || mediaBusy} onClick={() => setMediaOpen((value) => !value)}>{mediaOpen ? "إخفاء أدوات المرفقات" : "إضافة صور أو صوت أو فيديو"}</Button>
      {mediaOpen && <MediaPicker prefix="الرسالة: " accountId={accountId} files={files} onChange={(next) => { if (busyRef.current || submitted.current) return; filesRef.current = next; setFiles(next); }} disabled={locked} onActivity={setMediaBusy} />}
      {error && <p className="followup-error" role="alert">{error}</p>}{submitted.current && !busy && <p className="followup-hint">لم يصل تأكيد الإرسال. أعد تأكيد الرسالة نفسها دون تكرارها.</p>}{progress && <p role="status">{progress}</p>}<Button type="submit" loading={busy} disabled={mediaBusy}>{submitted.current && !busy ? "إعادة تأكيد الرسالة" : "إرسال الرسالة"}</Button>
    </form>
  </section>;
}

function PrivateAttachments({ items, accountId }: { items: FollowupAttachment[]; accountId: string }) {
  const [preview, setPreview] = useState<FollowupAttachment | null>(null);
  useEffect(() => { if (preview && !items.some((item) => item.id === preview.id)) setPreview(null); }, [items, preview]);
  return <>{items.length > 0 && <div className="followup-media-actions">{items.map((attachment) => <Button key={attachment.id} variant="outline" onClick={() => setPreview(attachment)}><bdi>{attachment.name}</bdi> · {sizeLabel(attachment.size)}</Button>)}</div>}{preview && <AttachmentPreview key={preview.id} item={preview} accountId={accountId} onClose={() => setPreview(null)} />}</>;
}

function AttachmentPreview({ item, accountId, onClose }: { item: FollowupAttachment; accountId: string; onClose?: () => void }) {
  const signal = useRequests(accountId);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true, objectUrl = "";
    setUrl(""); setError("");
    void downloadFollowupFile(item, signal).then((blob) => {
      if (!alive || signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch((error) => { if (alive && !signal.aborted) setError(errorText(error)); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item, signal, retry]);
  return <section className="followup-preview" aria-label={`معاينة ${item.name}`}><div className="followup-toolbar"><strong><bdi>{item.name}</bdi></strong>{onClose && <Button type="button" variant="ghost" onClick={onClose}>إغلاق المعاينة</Button>}</div>
    {!url && !error && <p role="status">جارٍ تحميل المرفق…</p>}
    {error && <><p role="alert" className="followup-error">{error}</p><Button type="button" onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</Button></>}
    {url && <>{item.mimeType.startsWith("image/") ? <img src={url} alt={item.name} onError={() => setError("لا يدعم المتصفح معاينة هذه الصورة. يمكنك تنزيلها.")} /> : item.mimeType.startsWith("audio/") ? <audio aria-label={`تشغيل ${item.name}`} controls src={url} preload="metadata" onError={() => setError("تعذّر تشغيل هذا الصوت داخل المتصفح. أعد المحاولة أو نزّل المرفق.")} /> : <video controls playsInline src={url} preload="metadata" />}<a className="button button--outline" href={url} download={item.name}>تنزيل المرفق</a></>}
  </section>;
}
