"use client";

import { useRef, useState } from "react";
import { useApp } from "../lib/app-context";
import { formatDate, parcelBatchCodes, uid, type ParcelCodeBatch } from "../lib/data";
import { createQrMatrix } from "../lib/qr-code";
import { Button, EmptyState, Field, Modal, PageHeader, SectionCard } from "./ui";

export function ParcelCodeLabel({ code }: { code: string }) {
  const matrix = createQrMatrix(code);
  return <article className="parcel-code-label"><strong>المدينة إكسبرس</strong><svg viewBox="0 0 29 29" role="img" aria-label={`رمز QR للكود ${code}`} shapeRendering="crispEdges"><rect width="29" height="29" fill="#fff" />{matrix.flatMap((row, y) => row.map((dark, x) => dark ? <rect key={`${x}-${y}`} x={x + 4} y={y + 4} width="1" height="1" fill="#000" /> : null))}</svg><b dir="ltr">{code}</b></article>;
}

export function ParcelCodeSheets({ codes }: { codes: string[] }) {
  return <div className="parcel-code-sheets">{Array.from({ length: Math.ceil(codes.length / 24) }, (_, page) => <div className="parcel-code-sheet" key={page}>{codes.slice(page * 24, (page + 1) * 24).map((code) => <ParcelCodeLabel code={code} key={code} />)}</div>)}</div>;
}

export function ParcelCodeBatchesPage() {
  const { database, user, setView, generateParcelCodes, showToast } = useApp();
  const [count, setCount] = useState("50");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const pendingRequest = useRef<{ key: string; id: string } | null>(null);
  if (user?.role !== "admin") return <EmptyState title="غير متاح" description="إنشاء أكواد الطرود وطباعتها متاحان للمسؤول فقط." icon="qrCode" />;
  const batches = database.parcelCodeBatches ?? [];
  const claims = database.parcelCodeClaims ?? {};
  const unusedCodes = (batch: ParcelCodeBatch) => parcelBatchCodes(batch).filter((code) => !claims[code]);
  const selected = batches.find((batch) => batch.id === selectedId);
  const printable = selected ? unusedCodes(selected) : [];

  async function generate() {
    if (inFlight.current) return;
    const number = Number(count.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)));
    if (!Number.isInteger(number) || number < 1 || number > 500) return showToast("اختر عددًا من 1 إلى 500 كود.", "error");
    const key = JSON.stringify([number, label.trim()]);
    const request = pendingRequest.current?.key === key ? pendingRequest.current : { key, id: uid("parcel-batch") };
    pendingRequest.current = request;
    inFlight.current = true;
    setBusy(true);
    try {
      if (!await generateParcelCodes(request.id, number, label.trim())) return;
      pendingRequest.current = null;
      setSelectedId(request.id);
      showToast("تم حفظ دفعة الأكواد وأصبحت جاهزة للطباعة.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="page-content parcel-code-page"><PageHeader title="أكواد الطرود للطباعة" subtitle="جهّز الملصقات ووزّعها على الزبائن قبل إنشاء الطرود" onBack={() => setView("admin")} />
    <SectionCard title="دفعة جديدة" icon="qrCode"><div className="form-grid"><Field label="عدد الأكواد" value={count} onChange={(event) => setCount(event.target.value)} inputMode="numeric" disabled={busy} /><Field label="اسم الدفعة (اختياري)" placeholder="مثلاً: ملصقات الفرع" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} disabled={busy} /></div><Button icon="plus" loading={busy} onClick={() => void generate()}>إنشاء أكواد جاهزة للطباعة</Button><p className="field-hint">تُحجز الأرقام عند إنشاء الدفعة. امسح كود QR من صفحة تفاصيل الطرد بعد إنشائه؛ لا يمكن استخدامه مرة أخرى.</p></SectionCard>
    <div className="section-heading"><h2>الدفعات المحفوظة</h2></div>
    {batches.length ? batches.map((batch) => { const remaining = unusedCodes(batch).length; return <SectionCard key={batch.id}><div className="parcel-batch-summary"><div><h3>{batch.label || "دفعة أكواد"}</h3><p>{formatDate(batch.createdAt)} · {batch.count} كود · {remaining} غير مستخدم</p><span dir="ltr">ALX-{batch.startNumber} — ALX-{batch.startNumber + batch.count - 1}</span></div><Button icon="printer" variant="secondary" disabled={!remaining} onClick={() => setSelectedId(batch.id)}>طباعة غير المستخدم</Button></div></SectionCard>; }) : <EmptyState icon="qrCode" title="لا توجد دفعات بعد" description="اختر عدد الأكواد وأنشئ أول دفعة للطباعة." />}
    {selected && <Modal title={selected.label || "طباعة أكواد الطرود"} onClose={() => setSelectedId(null)} className="parcel-codes-print-modal" sheet><div className="parcel-code-print-controls"><p>{printable.length} ملصقًا غير مستخدم · 24 ملصقًا لكل ورقة A4. اختر الحجم الفعلي 100%، ويمكنك الحفظ بصيغة PDF من نافذة الطباعة.</p><Button icon="printer" disabled={!printable.length} onClick={() => window.print()}>طباعة / حفظ PDF</Button></div><ParcelCodeSheets codes={printable} /></Modal>}
  </div>;
}
