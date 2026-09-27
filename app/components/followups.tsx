"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import type { Order } from "../lib/data";
import { FOLLOWUP_LIMITS, FOLLOWUP_STATUSES, FOLLOWUP_TYPES, followupStatusLabel, followupTypeLabel, type Followup, type FollowupAttachment, type FollowupList, type FollowupStatus, type FollowupType } from "../lib/followups";
import { bindFollowupAccount, createFollowup, downloadFollowupFile, followupApi, FollowupApiError, uploadFollowupFile, validFollowup, validateFollowupFiles, type FollowupDraft, type PendingFollowupFile } from "../lib/followup-client";
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

function FollowupCollection({ accountId, order }: { accountId: string; order?: Order }) {
  const { user, database, setSelectedOrderId, setView, showToast } = useApp();
  const signal = useRequests(accountId);
  const [entries, setEntries] = useState<Followup[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Followup | null>(null);
  const loadNumber = useRef(0);
  async function load(cursor?: string) {
    const number = ++loadNumber.current;
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (order) params.set("orderId", order.id);
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await followupApi<FollowupList>(`followups?${params}`, signal);
      if (signal.aborted || number !== loadNumber.current) return;
      if (!Array.isArray(result.followups) || !result.followups.every(validFollowup)
        || (result.nextCursor !== null && typeof result.nextCursor !== "string")) throw new Error("تعذّر قراءة المتابعات.");
      setEntries((previous) => cursor ? [...previous, ...result.followups.filter((item) => !previous.some((existing) => existing.id === item.id))] : result.followups);
      setNext(result.nextCursor);
    } catch (error) { if (!signal.aborted && number === loadNumber.current) setError(errorText(error)); }
    finally { if (!signal.aborted && number === loadNumber.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [signal]); // account/parcel identity is a component key
  function updated(item: Followup) { setEntries((current) => current.map((row) => row.id === item.id ? item : row)); setSelected(item); }
  return <SectionCard title={order ? "متابعات الطرد" : "طلبات المتابعة"} icon="message" className="followup-section" action={order && !order.deleted ? <Button icon="plus" onClick={() => setCreating(true)}>إنشاء متابعة</Button> : undefined}>
    {!order && <p className="followup-hint">لإنشاء متابعة، افتح تفاصيل الطرد واضغط «إنشاء متابعة».</p>}
    <div className="followup-toolbar"><Button variant="ghost" onClick={() => void load()} disabled={loading}>تحديث المتابعات</Button><span aria-live="polite">{loading ? "جارٍ التحميل…" : `${entries.length.toLocaleString("ar-EG")} متابعة`}</span></div>
    {error && <p className="followup-error" role="alert">{error}</p>}
    {!loading && !error && !entries.length && <p className="followup-empty">لا توجد متابعات{order ? " لهذا الطرد" : " حتى الآن"}.</p>}
    <div className="followup-list">{entries.map((item) => <button type="button" key={item.id} className="followup-row" onClick={() => setSelected(item)}>
      <span className={`followup-status followup-status--${item.status}`}>{followupStatusLabel(item.status)}</span>
      <strong>{item.title}</strong><span>{followupTypeLabel(item.type)}</span>
      {!order && <span>{database.orders.find((parcel) => parcel.id === item.orderId)?.trackingNumber || "متابعة طرد"}</span>}
      <small>{dateLabel(item.createdAt)}{item.attachments.length ? ` · ${item.attachments.length} مرفقات` : ""}</small>
    </button>)}</div>
    {next && <Button variant="outline" loading={loading} onClick={() => void load(next)}>عرض المزيد</Button>}
    {creating && order && <FollowupForm key={`${accountId}:${order.id}`} order={order} accountId={accountId} onClose={() => { setCreating(false); void load(); }} onCreated={(item) => {
      if (signal.aborted) return;
      setCreating(false); setEntries((current) => [item, ...current.filter((existing) => existing.id !== item.id)]); setSelected(item); showToast("تم إنشاء المتابعة وإرسالها للمراجعة.");
    }} />}
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

function FollowupForm({ order, accountId, onClose, onCreated }: { order: Order; accountId: string; onClose: () => void; onCreated: (item: Followup) => void }) {
  const signal = useRequests(accountId);
  const [type, setType] = useState<FollowupType | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<PendingFollowupFile[]>([]);
  const filesRef = useRef<PendingFollowupFile[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [recording, setRecording] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const microphonePending = useRef(false);
  const recordingRef = useRef<Recording | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const submittedDraft = useRef<FollowupDraft | null>(null);
  const confirmationUncertain = useRef(false);
  const locked = busy || submittedDraft.current !== null;

  function addFiles(incoming: File[]) {
    // A file picker can resolve after submission started. Keep the displayed
    // attachment list identical to the immutable request being uploaded.
    if (signal.aborted || busyRef.current || submittedDraft.current) return;
    const next = [...filesRef.current, ...incoming.map(normalizeFile).map((file) => ({ id: crypto.randomUUID(), file }))];
    const issue = validateFollowupFiles(next.map((item) => item.file));
    if (issue) { setError(issue); return; }
    filesRef.current = next; setFiles(next); setError("");
  }
  function choose(event: ChangeEvent<HTMLInputElement>) { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }
  function stopRecording(discard = false) {
    const current = recordingRef.current;
    if (!current) return;
    current.discard ||= discard;
    clearTimeout(current.timeout);
    if (current.recorder.state !== "inactive") current.recorder.stop();
    current.stream.getTracks().forEach((track) => track.stop());
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stopRecording(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); stopRecording(true); filesRef.current = []; };
  }, []);

  async function startRecording() {
    if (microphonePending.current || recordingRef.current || locked) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("التسجيل غير متاح في هذا المتصفح. يمكنك إرفاق ملف صوتي محفوظ."); return; }
    if (filesRef.current.length >= FOLLOWUP_LIMITS.files) { setError("احذف مرفقًا قبل إضافة تسجيل صوتي."); return; }
    microphonePending.current = true; setMicPending(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (signal.aborted || document.hidden) { stream.getTracks().forEach((track) => track.stop()); return; }
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
        setRecording(false);
        if (!current.discard && current.size) {
          const extension = mimeType === "audio/mp4" ? "m4a" : mimeType === "audio/ogg" ? "ogg" : "webm";
          addFiles([new File(current.chunks, `تسجيل-${Date.now()}.${extension}`, { type: mimeType })]);
        }
      };
      recorder.start(500); setRecording(true);
    } catch (error) {
      if (recordingRef.current) { clearTimeout(recordingRef.current.timeout); recordingRef.current.discard = true; recordingRef.current = null; }
      stream?.getTracks().forEach((track) => track.stop());
      if (!signal.aborted) setRecording(false);
      if (!signal.aborted) setError(error instanceof DOMException && error.name === "NotAllowedError" ? "تم رفض إذن الميكروفون. يمكنك السماح به من إعدادات المتصفح أو إكمال المتابعة دون تسجيل." : errorText(error));
    } finally { microphonePending.current = false; if (!signal.aborted) setMicPending(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || recordingRef.current || microphonePending.current || signal.aborted) return;
    if (!submittedDraft.current && (!type || !title.trim() || !description.trim())) { setError("اختر نوع المتابعة واكتب عنوانها ووصفها."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      if (!submittedDraft.current) {
        const attachmentIds: string[] = [];
        for (const item of filesRef.current) attachmentIds.push(await uploadFollowupFile(order.id, item, signal, setProgress));
        submittedDraft.current = { requestId: requestId.current, orderId: order.id, type: type as FollowupType, title: title.trim(), description: description.trim(), attachmentIds };
      }
      setProgress("جارٍ حفظ المتابعة…");
      const item = await createFollowup(submittedDraft.current, signal);
      if (!signal.aborted) { confirmationUncertain.current = false; onCreated(item); }
    } catch (error) {
      if (!signal.aborted) {
        // Once any create response is uncertain, even a later 401/429/409 does
        // not prove the original request failed. Preserve its exact retry body.
        if (submittedDraft.current) {
          const rejected = error instanceof FollowupApiError && error.status >= 400 && error.status < 500 && error.status !== 408;
          if (!rejected) confirmationUncertain.current = true;
          if (rejected && !confirmationUncertain.current) submittedDraft.current = null;
        }
        setError(errorText(error));
      }
    } finally { busyRef.current = false; if (!signal.aborted) { setBusy(false); setProgress(""); } }
  }
  function close() {
    if (busyRef.current) return;
    if ((title || description || files.length || recording) && !window.confirm(confirmationUncertain.current
      ? "لم يصل تأكيد الحفظ وقد تكون المتابعة أُرسلت. هل تريد إغلاق النموذج ومراجعة قائمة المتابعات؟"
      : "الخروج دون إرسال المتابعة؟ ستُحذف المسودة من هذا الجهاز.")) return;
    stopRecording(true); onClose();
  }

  return <Modal title="إنشاء متابعة" onClose={close} closeDisabled={busy} className="followup-modal" sheet>
    <form onSubmit={submit} className="followup-form">
      <p className="followup-parcel">الطرد: <bdi>{order.trackingNumber || order.recipientName}</bdi></p>
      <fieldset disabled={locked}>
        <SelectField label="نوع المتابعة" aria-label="نوع المتابعة" value={type} required onChange={(event) => setType(event.target.value as FollowupType)}><option value="" disabled>اختر نوع المتابعة</option>{FOLLOWUP_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>
        <Field label="عنوان المتابعة" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={FOLLOWUP_LIMITS.title} required placeholder="اكتب عنوانًا مختصرًا" />
        <label className="field"><span className="field__label">الوصف</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={FOLLOWUP_LIMITS.description} rows={5} required placeholder="وضّح طلبك أو المشكلة المتعلقة بالطرد" /></label>
        <section className="followup-media" aria-label="المرفقات"><h3>المرفقات</h3><div className="followup-media-actions">
          <label className="followup-file-control">اختيار صور<input aria-label="اختيار صور من المعرض" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple onChange={choose} /></label>
          <label className="followup-file-control">فتح الكاميرا<input aria-label="التقاط صورة" type="file" accept="image/*" capture="environment" onChange={choose} /></label>
        </div><h3>تسجيل صوتي</h3><div className="followup-media-actions">
          {recording ? <Button type="button" variant="danger" onClick={() => stopRecording()}>إيقاف التسجيل</Button> : <Button type="button" variant="outline" loading={micPending} onClick={() => void startRecording()}>بدء التسجيل</Button>}
          <label className="followup-file-control">اختيار ملف صوتي<input aria-label="إرفاق ملف صوتي" type="file" accept="audio/*" onChange={choose} /></label>
        </div>{recording && <p role="status" className="followup-recording">يجري التسجيل… الحد الأقصى دقيقتان. يتوقف التسجيل عند مغادرة الصفحة.</p>}
        <h3>مقاطع الفيديو</h3><div className="followup-media-actions">
          <label className="followup-file-control">اختيار فيديو<input aria-label="اختيار فيديو من المعرض" type="file" accept="video/*" onChange={choose} /></label>
          <label className="followup-file-control">تصوير فيديو<input aria-label="التقاط فيديو بالكاميرا" type="file" accept="video/*" capture="environment" onChange={choose} /></label>
        </div><p className="followup-hint">المرفقات اختيارية: حتى 5 ملفات، 10 ميغابايت للملف و20 ميغابايت للمجموع. اختر فيديو قصيرًا.</p></section>
        {files.length > 0 && <ul className="followup-files">{files.map((item) => <li key={item.id}><span><bdi>{item.file.name}</bdi><small>{sizeLabel(item.file.size)}</small></span><Button type="button" variant="ghost" aria-label={`إزالة ${item.file.name}`} onClick={() => { const next = filesRef.current.filter((file) => file.id !== item.id); filesRef.current = next; setFiles(next); }}>إزالة</Button></li>)}</ul>}
      </fieldset>
      {error && <p className="followup-error" role="alert">{error}</p>}
      {!busy && submittedDraft.current && <p className="followup-hint">لم يصل تأكيد الحفظ. أعد المحاولة للتحقق من الطلب نفسه دون إنشاء نسخة مكررة، أو راجع قائمة المتابعات.</p>}
      {progress && <p role="status" aria-live="polite">{progress}</p>}
      <div className="followup-submit"><Button type="submit" full loading={busy} disabled={recording || micPending}>{submittedDraft.current && !busy ? "إعادة محاولة التأكيد" : "تأكيد"}</Button></div>
    </form>
  </Modal>;
}

function FollowupDetails({ item, accountId, canRespond, onClose, onUpdated, onParcel }: { item: Followup; accountId: string; canRespond: boolean; onClose: () => void; onUpdated: (item: Followup) => void; onParcel?: () => void }) {
  const signal = useRequests(accountId);
  const [status, setStatus] = useState<FollowupStatus>(item.status);
  const [response, setResponse] = useState(item.response);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<FollowupAttachment | null>(null);
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
    <div className="followup-detail"><span className={`followup-status followup-status--${item.status}`}>{followupStatusLabel(item.status)}</span><h2>{item.title}</h2><p>{followupTypeLabel(item.type)}</p><p className="followup-description">{item.description}</p><small>{item.creatorName} · {dateLabel(item.createdAt)}</small>
      {item.response && <section className="followup-response"><h3>رد فريق المتابعة</h3><p className="followup-description">{item.response}</p><small>آخر تحديث: {dateLabel(item.updatedAt)}</small></section>}
      {item.attachments.length > 0 && <section><h3>المرفقات</h3><div className="followup-media-actions">{item.attachments.map((attachment) => <Button key={attachment.id} variant="outline" onClick={() => setPreview(attachment)}><bdi>{attachment.name}</bdi> · {sizeLabel(attachment.size)}</Button>)}</div></section>}
      {preview && <AttachmentPreview key={preview.id} item={preview} accountId={accountId} onClose={() => setPreview(null)} />}
      {onParcel && <Button variant="ghost" onClick={onParcel}>فتح تفاصيل الطرد</Button>}
      {canRespond && <form onSubmit={submit} className="followup-form followup-response-form"><h3>تحديث المتابعة</h3><SelectField label="حالة المتابعة" aria-label="حالة المتابعة" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as FollowupStatus)}>{FOLLOWUP_STATUSES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</SelectField><label className="field"><span className="field__label">الرد على صاحب المتابعة</span><textarea value={response} onChange={(event) => setResponse(event.target.value)} maxLength={FOLLOWUP_LIMITS.response} rows={4} disabled={busy} required /></label>{error && <p role="alert" className="followup-error">{error}</p>}<Button type="submit" loading={busy}>حفظ الرد والحالة</Button></form>}
    </div>
  </Modal>;
}

function AttachmentPreview({ item, accountId, onClose }: { item: FollowupAttachment; accountId: string; onClose: () => void }) {
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
  return <section className="followup-preview" aria-label={`معاينة ${item.name}`}><div className="followup-toolbar"><strong><bdi>{item.name}</bdi></strong><Button variant="ghost" onClick={onClose}>إغلاق المعاينة</Button></div>
    {!url && !error && <p role="status">جارٍ تحميل المرفق…</p>}
    {error && <><p role="alert" className="followup-error">{error}</p><Button onClick={() => setRetry((value) => value + 1)}>إعادة المحاولة</Button></>}
    {url && <>{item.mimeType.startsWith("image/") ? <img src={url} alt={item.name} onError={() => setError("لا يدعم المتصفح معاينة هذه الصورة. يمكنك تنزيلها.")} /> : item.mimeType.startsWith("audio/") ? <audio controls src={url} preload="metadata" /> : <video controls playsInline src={url} preload="metadata" />}<a className="button button--outline" href={url} download={item.name}>تنزيل المرفق</a></>}
  </section>;
}
