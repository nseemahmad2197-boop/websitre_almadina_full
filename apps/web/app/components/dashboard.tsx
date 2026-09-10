"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useApp } from "../lib/app-context";
import { appendOrderTrackingEvent, appendOrderTrackingNote, formatDate, getStatus, money, normalizeMembership, normalizeParcelCode, relativeDate, statusDefinitions, type Order, type OrderStatus } from "../lib/data";
import { createQrMatrix } from "../lib/qr-code";
import { Icon } from "./icon";
import { DeleteParcelRow } from "./swipe-delete";
import { TrackingHistory, TrackingNoteComposer } from "./tracking-history";
import { Button, EmptyState, Field, IconButton, Modal, PageHeader, SectionCard, Segmented, StatusPill } from "./ui";

export function OrderCard({ order, showMerchant = false, compact = false }: { order: Order; showMerchant?: boolean; compact?: boolean }) {
  const { setView, setSelectedOrderId } = useApp();
  return (
    <DeleteParcelRow order={order}>
    <button className={`order-card ${compact ? "order-card--compact" : ""}`} onClick={() => { setSelectedOrderId(order.id); setView("order-detail"); }}>
      <div className="order-card__top"><div className="order-card__identity"><span className="order-card__icon"><Icon name="package" size={21} /></span><div><strong>{showMerchant ? order.merchantName : order.recipientName}</strong><span dir={order.trackingNumber ? "ltr" : "rtl"}>{order.trackingNumber || "بانتظار إضافة كود QR"}</span></div></div><StatusPill status={order.status} /></div>
      <div className="order-card__details"><span><Icon name="mapPin" size={15} />{order.city}</span><span><Icon name="wallet" size={15} />{money(order.amount)} ₪</span><span><Icon name="clock" size={15} />{relativeDate(order.createdAt)}</span></div>
    </button>
    </DeleteParcelRow>
  );
}

export function Dashboard() {
  const { database, user, setView } = useApp();
  const membership = normalizeMembership(user?.membership);
  const membershipLabel = membership === "diamond" ? "ماسي" : membership === "premium" ? "بريميوم" : "عادي";
  const [segment, setSegment] = useState("orders");
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | null>(null);
  const orders = database.orders.filter((order) => order.merchantId === user?.id && !order.deleted)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const selectedStatusDefinition = selectedStatus ? statusDefinitions.find((status) => status.id === selectedStatus) : undefined;
  const selectedStatusOrders = selectedStatus ? orders.filter((order) => order.status === selectedStatus) : [];
  const totalAmount = orders.reduce((sum, order) => sum + order.amount, 0);
  const delivered = orders.filter((order) => order.status === "delivered").length;
  const inProgress = orders.filter((order) => !["delivered", "returned"].includes(order.status)).length;

  return (
    <div className="page-content dashboard-page animate-page">
      <div className="greeting"><span><Icon name="sparkles" size={17} /> سعداء بالتعامل معك</span><div className="greeting__identity"><h1>{user?.store}</h1><span className={`membership-badge membership-badge--${membership}`}><Icon name={membership === "diamond" ? "sparkles" : membership === "premium" ? "star" : "user"} size={13} />{membershipLabel}</span></div></div>
      <div className="balance-card"><div className="balance-card__total"><span>إجمالي الرصيد</span><strong>{money(totalAmount)}</strong><small>شيكل</small></div><div className="balance-card__stats"><div><Icon name="truck" size={18} /><strong>{inProgress}</strong><span>قيد التوصيل</span></div><div><Icon name="wallet" size={18} /><strong>{delivered}</strong><span>طلبات مكتملة</span></div></div><button className="balance-card__banner" onClick={() => setView("new-order")}><Icon name="sparkles" size={18} />أنشئ طردًا — توصيل نفس اليوم داخل فلسطين<Icon name="chevronLeft" size={18} /></button></div>

      <div className="section-heading"><h2>حالات الطرود</h2><button onClick={() => setView("shipments")}>الطرود <Icon name="chevronLeft" size={16} /></button></div>
      <div className="status-grid">{statusDefinitions.map((status) => <button key={status.id} className={`status-card ${selectedStatus === status.id ? "is-selected" : ""}`} aria-pressed={selectedStatus === status.id} onClick={() => setSelectedStatus((current) => current === status.id ? null : status.id)} style={{ "--status-color": status.color, "--status-bg": status.surface } as CSSProperties}><span><Icon name={status.icon} size={20} /></span><strong>{orders.filter((order) => order.status === status.id).length}</strong><small>{status.label}</small></button>)}</div>

      {selectedStatusDefinition && <SectionCard className="dashboard-status-orders"><div className="section-heading"><h2>طرود حالة {selectedStatusDefinition.label}</h2><button type="button" onClick={() => setSelectedStatus(null)}>إلغاء التحديد</button></div>{selectedStatusOrders.length ? <div className="order-list">{selectedStatusOrders.map((order) => <OrderCard key={`status-${order.id}`} order={order} />)}</div> : <EmptyState icon={selectedStatusDefinition.icon} title={`لا توجد طرود بحالة ${selectedStatusDefinition.label}`} description="ستظهر طرود هذه الحالة هنا فور تحديثها." />}</SectionCard>}

      <SectionCard className="dashboard-orders"><Segmented value={segment} onChange={setSegment} items={[{ value: "orders", label: "الطرود" }, { value: "updates", label: "التحديثات" }]} />{segment === "orders" ? <><div className="section-heading"><h2>أحدث الطرود</h2><button type="button" onClick={() => setView("shipments")}>عرض الكل <Icon name="chevronLeft" size={16} /></button></div>{orders.length ? <div className="order-list">{orders.slice(0, 5).map((order) => <OrderCard key={`latest-${order.id}`} order={order} />)}</div> : <EmptyState icon="package" title="لا توجد طرود بعد" description="أنشئ أول طرد لتبدأ متابعة طرودك من هنا." action="إنشاء طرد" onAction={() => setView("new-order")} />}</> : <div className="activity-list">{database.notices.filter((notice) => notice.userId === user?.id).map((notice) => <div className="activity-item" key={notice.id}><span><Icon name={notice.icon} size={20} /></span><div><strong>{notice.title}</strong><p>{notice.message}</p></div><small>{relativeDate(notice.createdAt)}</small></div>)}</div>}</SectionCard>
    </div>
  );
}

export function Shipments() {
  const { database, user, setView } = useApp();
  const [query, setQuery] = useState("");
  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
  const [status, setStatus] = useState(() => {
    if (typeof window === "undefined") return "all";
    const stored = sessionStorage.getItem("almadina-status-filter");
    sessionStorage.removeItem("almadina-status-filter");
    return stored ?? "all";
  });

  const printableOrders = useMemo(() => database.orders.filter((order) => order.merchantId === user?.id && !order.deleted && !!order.trackingNumber.trim()), [database.orders, user?.id]);
  const orders = useMemo(() => database.orders.filter((order) => order.merchantId === user?.id && !order.deleted && (status === "all" || order.status === status) && (!query || `${order.trackingNumber} ${order.recipientName} ${order.city} ${order.recipientPhone}`.toLowerCase().includes(query.toLowerCase()))), [database.orders, user?.id, status, query]);

  return (
    <div className="page-content animate-page">
      <PageHeader
        title="الطرود"
        subtitle="طرودك النشطة ومراحل تقدّمها لحظة بلحظة"
        action={
          <div className="inline-actions shipments-page__actions">
            <Button className="shipments-page__bulk-print" variant="secondary" icon="printer" disabled={!printableOrders.length} onClick={() => setBulkPrintOpen(true)}>
              طباعة الكل
              {!!printableOrders.length && <span className="button__count">{printableOrders.length.toLocaleString("ar-EG")}</span>}
            </Button>
            <Button icon="plus" onClick={() => setView("new-order")}>طرد جديد</Button>
          </div>
        }
      />
      <Field icon="search" placeholder="ابحث برقم التتبع أو اسم المستلم..." value={query} onChange={(event) => setQuery(event.target.value)} wrapperClassName="search-field" />
      <div className="filter-scroll"><button className={status === "all" ? "filter-chip is-active" : "filter-chip"} onClick={() => setStatus("all")}>الكل</button>{statusDefinitions.map((entry) => <button key={entry.id} className={status === entry.id ? "filter-chip is-active" : "filter-chip"} onClick={() => setStatus(entry.id)}>{entry.label}</button>)}</div>
      {orders.length ? <div className="order-list">{orders.map((order) => <OrderCard key={order.id} order={order} />)}</div> : <EmptyState icon="layers" title={query ? "لا توجد نتائج مطابقة" : "لا توجد طرود نشطة"} description={query ? "جرّب البحث باسم آخر أو غيّر حالة الطرد." : "جميع طرودك مكتملة — أنشئ طردًا جديدًا لمتابعته هنا."} action={query ? "مسح البحث" : "إنشاء طرد"} onAction={query ? () => setQuery("") : () => setView("new-order")} />}
      {bulkPrintOpen && <BulkShippingLabelsModal orders={printableOrders} onClose={() => setBulkPrintOpen(false)} />}
    </div>
  );
}

function ShippingQr({ value }: { value: string }) {
  const matrix = useMemo(() => value.trim() ? createQrMatrix(value) : [], [value]);
  if (!value.trim()) return null;
  return (
    <svg className="shipping-qr" viewBox="0 0 29 29" role="img" aria-label={`رمز QR لرقم التتبع ${value}`} shapeRendering="crispEdges">
      <rect width="29" height="29" fill="#fff" />
      {matrix.flatMap((row, rowIndex) => row.map((dark, columnIndex) => dark ? <rect key={`${rowIndex}-${columnIndex}`} x={columnIndex + 4} y={rowIndex + 4} width="1" height="1" fill="#062b20" /> : null))}
    </svg>
  );
}

function ShippingBarcode({ value }: { value: string }) {
  const bars = useMemo(() => [...`*${value}*`].flatMap((character) => {
    const bits = character.charCodeAt(0).toString(2).padStart(8, "0");
    return [true, false, ...[...bits].map((bit) => bit === "1"), false];
  }), [value]);
  const width = bars.length * 1.5;
  return <svg className="shipping-barcode" viewBox={`0 0 ${width} 24`} preserveAspectRatio="none" aria-hidden="true">{bars.map((visible, index) => visible ? <rect key={index} x={index * 1.5} width={index % 3 === 0 ? 1 : .7} height="24" fill="#24312d" /> : null)}</svg>;
}

function ShippingLabel({ order, bulk = false }: { order: Order; bulk?: boolean }) {
  const status = getStatus(order.status);
  return (
    <article className={`shipping-label ${bulk ? "shipping-label--bulk" : ""}`} aria-label={`ملصق الطرد ${order.trackingNumber}`}>
      <header className="shipping-label__top">
        <div className="shipping-label__brand"><span><Icon name="truck" size={25} /></span><div><strong>المدينة إكسبرس</strong><small>ALMADINA EXPRESS</small></div></div>
        <span className="shipping-label__status" style={{ "--label-status": status.color } as CSSProperties}><Icon name={status.icon} size={14} />{status.label}</span>
      </header>
      <ShippingQr value={order.trackingNumber} />
      <strong className="shipping-label__tracking" dir="ltr">{order.trackingNumber}</strong>
      <ShippingBarcode value={order.trackingNumber} />
      <dl className="shipping-label__details">
        <div><dt>المستلم</dt><dd>{order.recipientName}</dd></div>
        <div><dt>الجوال</dt><dd dir="ltr">{order.recipientPhone}</dd></div>
        <div><dt>العنوان</dt><dd>{order.city} — {order.address}</dd></div>
        <div><dt>التحصيل (COD)</dt><dd className="shipping-label__cod">{money(order.amount)} ₪</dd></div>
      </dl>
    </article>
  );
}

function ShippingLabelModal({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <Modal ariaLabel="ملصق الشحن" onClose={onClose} className="shipping-label-modal" sheet>
      <header className="shipping-label-modal__header">
        <span className="shipping-label-modal__handle" />
        <IconButton name="close" label="إغلاق ملصق الشحن" onClick={onClose} />
        <div><small>جاهز للطباعة</small><h2>ملصق الشحن</h2></div>
      </header>
      <div className="shipping-label-modal__body">
        <ShippingLabel order={order} />
        <p className="shipping-label-modal__note"><Icon name="info" size={15} />امسح رمز QR لقراءة رقم التتبع مباشرة.</p>
        <Button icon="printer" full className="shipping-label-modal__print" onClick={() => window.print()}>طباعة الملصق</Button>
      </div>
    </Modal>
  );
}

function BulkShippingLabelsModal({ orders, onClose }: { orders: Order[]; onClose: () => void }) {
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set(orders.map((order) => order.id)));
  const selectedOrders = orders.filter((order) => selectedOrderIds.has(order.id));
  const allSelected = orders.length > 0 && selectedOrders.length === orders.length;
  const selectedCount = selectedOrders.length.toLocaleString("ar-EG");
  const totalCount = orders.length.toLocaleString("ar-EG");

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedOrderIds(allSelected ? new Set() : new Set(orders.map((order) => order.id)));
  }

  return (
    <Modal ariaLabel="طباعة جميع الطرود" onClose={onClose} className="bulk-shipping-labels-modal" sheet>
      <header className="bulk-shipping-labels-modal__header">
        <span className="bulk-shipping-labels-modal__handle" />
        <IconButton name="close" label="إغلاق نافذة الطباعة" onClick={onClose} />
        <div><small aria-live="polite">تم تحديد {selectedCount} من أصل {totalCount}</small><h2>طباعة جميع الطرود</h2></div>
      </header>
      <div className="bulk-shipping-labels-modal__body">
        <section className="bulk-shipping-labels-modal__summary">
          <span><Icon name="printer" size={23} /></span>
          <div><strong>{selectedOrders.length ? <>سيتم طباعة {selectedCount} ملصق شحن</> : "لم تحدد أي طرد للطباعة"}</strong><small>كل طرد في صفحة مستقلة ضمن عملية طباعة واحدة.</small></div>
        </section>
        <div className="bulk-shipping-labels-modal__selection">
          <div><strong>اختر الطرود</strong><small>{selectedCount} من {totalCount} محدد</small></div>
          <button type="button" className="bulk-shipping-labels-modal__select-all" onClick={toggleAll}>{allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}</button>
        </div>
        <div className="bulk-shipping-labels-modal__preview" role="group" aria-label="اختيار ملصقات الشحن">
          {orders.map((order) => {
            const selected = selectedOrderIds.has(order.id);
            return (
              <label key={order.id} className={selected ? "is-selected" : ""}>
                <span className="bulk-shipping-labels-modal__checkbox">
                  <input type="checkbox" checked={selectedOrderIds.has(order.id)} onChange={() => toggleOrder(order.id)} aria-label={`تحديد الطرد ${order.trackingNumber}`} />
                  <span aria-hidden="true"><Icon name="check" size={14} /></span>
                </span>
                <span className="bulk-shipping-labels-modal__parcel-icon"><Icon name="qrCode" size={20} /></span>
                <span className="bulk-shipping-labels-modal__parcel-details"><strong dir="ltr">{order.trackingNumber}</strong><small>{order.recipientName} · {order.city}</small></span>
                <StatusPill status={order.status} />
              </label>
            );
          })}
        </div>
        <div className="bulk-shipping-labels-modal__actions">
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button icon="printer" disabled={!selectedOrders.length} onClick={() => window.print()}>طباعة {selectedCount} ملصقًا</Button>
        </div>
      </div>
      <div className="bulk-shipping-labels-print" aria-hidden="true">
        {selectedOrders.map((order) => <ShippingLabel key={order.id} order={order} bulk />)}
      </div>
    </Modal>
  );
}

function ParcelCodeEntry({ order }: { order: Order }) {
  const { assignParcelCode, openScanner, showToast } = useApp();
  const [scannedCode, setScannedCode] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  async function saveScannedCode(value: string) {
    if (inFlight.current || order.deleted) return;
    const trackingNumber = normalizeParcelCode(value);
    if (!/^ALX-\d{6,20}$/.test(trackingNumber)) return showToast("هذا الرمز ليس كود طرد صالحًا. امسح ملصق الشركة.", "error");
    inFlight.current = true;
    setScannedCode(trackingNumber);
    setSaving(true);
    try {
      if (await assignParcelCode(order.id, trackingNumber)) showToast("تمت قراءة QR وحفظ كود الطرد.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  if (order.deleted) return <SectionCard title="كود الطرد" icon="qrCode"><p>استعد الطرد من المحذوفات لإضافة كود QR.</p></SectionCard>;
  return <SectionCard title="كود الطرد" icon="qrCode" className="parcel-code-entry"><div className="parcel-code-entry__actions"><Button icon="camera" loading={saving} onClick={() => openScanner((value) => { void saveScannedCode(value); }, { purpose: "assign-parcel-code" })}>{scannedCode ? "قراءة QR آخر" : "إضافة كود QR"}</Button>{scannedCode && <><strong dir="ltr" aria-live="polite">{scannedCode}</strong><Button variant="outline" disabled={saving} onClick={() => { void saveScannedCode(scannedCode); }}>إعادة محاولة الحفظ</Button></>}<p className="field-hint">امسح بالكاميرا رمز QR الموجود على ملصق الشركة. سيُضاف الكود لهذا الطرد تلقائيًا بعد التحقق منه.</p></div></SectionCard>;
}

export function OrderDetail() {
  const { database, user, selectedOrderId, setView, updateDatabase, showToast, confirm } = useApp();
  const [labelOpen, setLabelOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"tracking" | "details">("tracking");
  const [trackingNote, setTrackingNote] = useState("");
  const [statusUpdate, setStatusUpdate] = useState<{ status: OrderStatus; note: string } | null>(null);
  const noteComposerTarget = useRef<HTMLDivElement>(null);
  const order = database.orders.find((item) => item.id === selectedOrderId && (user?.role === "admin" || item.merchantId === user?.id));

  useEffect(() => {
    if (!selectedOrderId) return;

    try {
      if (sessionStorage.getItem("almadina-order-note-target") !== selectedOrderId) return;
      sessionStorage.removeItem("almadina-order-note-target");
    } catch {
      return;
    }

    const target = noteComposerTarget.current;
    target?.classList.add("is-highlighted");
    const scrollFrame = window.requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: "center" }));
    const highlightTimer = window.setTimeout(() => target?.classList.remove("is-highlighted"), 2_200);
    return () => {
      window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(highlightTimer);
      target?.classList.remove("is-highlighted");
    };
  }, [selectedOrderId]);

  if (!order) return <div className="page-content"><EmptyState icon="package" title="الطرد غير موجود" description="ربما حُذف هذا الطرد أو تغيّر رقم التتبع." action="العودة للطرود" onAction={() => setView(user?.role === "admin" ? "admin" : "shipments")} /></div>;
  const weightFee = order.weightFee ?? 0;
  const oversizeFee = order.oversizeFee ?? 0;
  const baseDeliveryFee = Math.max(order.deliveryFee - weightFee - oversizeFee, 0);

  function changeStatus(status: OrderStatus) {
    const currentOrder = order;
    if (!currentOrder || currentOrder.status === status) return;
    setStatusUpdate({ status, note: "" });
  }

  function saveStatusUpdate() {
    const currentOrder = order;
    if (!currentOrder || !statusUpdate || currentOrder.status === statusUpdate.status) return setStatusUpdate(null);
    const nextStatus = statusUpdate.status;
    const writtenNote = statusUpdate.note.trim();
    updateDatabase((current) => ({ ...current, orders: current.orders.map((item) => item.id === currentOrder.id ? appendOrderTrackingEvent(item, nextStatus, user?.name ?? "إدارة المدينة إكسبرس", writtenNote || `تم تغيير حالة الطرد من «${getStatus(item.status).label}» إلى «${getStatus(nextStatus).label}».`) : item) }));
    setStatusUpdate(null);
    showToast(`تم تحديث حالة الطرد إلى: ${getStatus(nextStatus).label}`);
  }

  function addTrackingNote() {
    const currentOrder = order;
    if (!currentOrder) return;
    const note = trackingNote.trim();
    if (!note) return showToast("اكتب الملاحظة أولًا.", "error");
    updateDatabase((current) => ({ ...current, orders: current.orders.map((item) => item.id === currentOrder.id ? appendOrderTrackingNote(item, user?.name ?? "مستخدم المدينة إكسبرس", note) : item) }));
    setTrackingNote("");
    showToast("تمت إضافة الملاحظة إلى الحالة الحالية.");
  }

  function removeOrder() {
    const currentOrder = order;
    if (!currentOrder) return;
    confirm({ title: "حذف الطرد؟", message: `سيُنقل الطرد ${currentOrder.trackingNumber} إلى المحذوفات ويمكنك استعادته لاحقًا.`, confirmLabel: "نقل إلى المحذوفات", danger: true, onConfirm: () => { updateDatabase((current) => ({ ...current, orders: current.orders.map((item) => item.id === currentOrder.id ? { ...item, deleted: true } : item) })); showToast("تم نقل الطرد إلى المحذوفات."); setView(user?.role === "admin" ? "admin" : "shipments"); } });
  }

  async function copyTrackingNumber() {
    const currentOrder = order;
    if (!currentOrder?.trackingNumber.trim()) return;
    try {
      await navigator.clipboard.writeText(currentOrder.trackingNumber);
      showToast("تم نسخ رقم التتبع.");
    } catch {
      showToast(`رقم التتبع: ${currentOrder.trackingNumber}`, "info");
    }
  }

  return (
    <div className="page-content animate-page order-detail-page">
      <PageHeader title="تفاصيل الطرد" subtitle={order.trackingNumber} onBack={() => setView(user?.role === "admin" ? "admin" : "shipments")} />
      <SectionCard className="detail-hero"><div><Icon name="package" size={30} /><div><strong dir={order.trackingNumber ? "ltr" : "rtl"}>{order.trackingNumber || "بانتظار إضافة كود QR"}</strong><span>أُنشئ في {formatDate(order.createdAt)}</span></div></div><StatusPill status={order.status} /></SectionCard>
      {!order.trackingNumber.trim() && <ParcelCodeEntry key={order.id} order={order} />}
      <Segmented className="order-detail-tabs" value={detailTab} onChange={(value) => setDetailTab(value as "tracking" | "details")} items={[{ value: "tracking", label: "التتبّع" }, { value: "details", label: "تفاصيل الطرد" }]} />
      {detailTab === "tracking" ? (
        <div className="order-tracking-panel animate-page">
          {user?.role === "admin" && <SectionCard title="تحديث حالة الطرد" icon="settings"><p className="tracking-note-intro">اختر الحالة الجديدة، ثم أضف ملاحظة اختيارية قبل الحفظ.</p><div className="status-actions">{statusDefinitions.map((entry) => <button key={entry.id} className={`status-action ${order.status === entry.id ? "is-active" : ""}`} disabled={order.status === entry.id} style={{ "--status-color": entry.color } as CSSProperties} onClick={() => changeStatus(entry.id)}><Icon name={entry.icon} size={15} />{entry.label}</button>)}</div></SectionCard>}
          <TrackingHistory order={order} />
          <div ref={noteComposerTarget} className="tracking-note-target">
            <SectionCard title="إضافة ملاحظة للحالة الحالية" icon="message">
              <p className="tracking-note-intro">ستُحفظ الملاحظة مع حالة «{getStatus(order.status).label}» واسم كاتبها ووقت إضافتها.</p>
              <TrackingNoteComposer status={order.status} value={trackingNote} onChange={setTrackingNote} onSubmit={addTrackingNote} />
            </SectionCard>
          </div>
        </div>
      ) : (
        <div className="order-detail-panel animate-page">
          <div className="order-detail-actions" aria-label="إجراءات الطرد">
            <button type="button" disabled={!order.trackingNumber.trim()} onClick={() => setLabelOpen(true)}><span><Icon name="qrCode" size={23} /></span><strong>ملصق الشحن</strong></button>
            <button type="button" disabled={!order.trackingNumber.trim()} onClick={() => { void copyTrackingNumber(); }}><span><Icon name="copy" size={22} /></span><strong>نسخ الرقم</strong></button>
            <button type="button" onClick={() => window.print()}><span><Icon name="printer" size={22} /></span><strong>طباعة البيانات</strong></button>
            <button type="button" className="is-danger" onClick={removeOrder}><span><Icon name="trash" size={22} /></span><strong>حذف</strong></button>
          </div>
          <div className="detail-columns"><SectionCard title="بيانات المستلم" icon="user"><div className="detail-row"><span>الاسم</span><strong>{order.recipientName}</strong></div><div className="detail-row"><span>رقم الجوال</span><a href={`tel:${order.recipientPhone}`} dir="ltr">{order.recipientPhone}</a></div><div className="detail-row"><span>المدينة</span><strong>{order.city}</strong></div><div className="detail-row"><span>عنوان التوصيل</span><strong>{order.address}</strong></div>{order.preferredDeliveryDate && <div className="detail-row"><span>تاريخ التوصيل المفضل</span><strong dir="ltr">{order.preferredDeliveryDate.split("-").reverse().join(" / ")}</strong></div>}</SectionCard><SectionCard title="تفاصيل الطرد" icon="receipt"><div className="detail-row"><span>نوع الطرد</span><strong>{order.type}</strong></div><div className="detail-row"><span>سعر الطرد (التحصيل)</span><strong>{money(order.amount)} ₪</strong></div><div className="detail-row"><span>رسوم التوصيل الأساسية</span><strong>- {money(baseDeliveryFee)} ₪</strong></div>{weightFee > 0 && <div className="detail-row"><span>رسوم الوزن الإضافية</span><strong>- {money(weightFee)} ₪</strong></div>}{oversizeFee > 0 && <div className="detail-row"><span>رسوم الحجم الإضافية</span><strong>- {money(oversizeFee)} ₪</strong></div>}<div className="detail-row"><span>إجمالي رسوم التوصيل</span><strong>- {money(order.deliveryFee)} ₪</strong></div><div className="detail-row"><span>قيمة المحتويات بعد الخصم</span><strong>{money(Math.max(order.amount - order.deliveryFee, 0))} ₪</strong></div><div className="detail-row"><span>الأبعاد</span><strong>{order.dimensions}</strong></div><div className="detail-row"><span>الوصف</span><strong>{order.content || "غير محدد"}</strong></div><div className="detail-row"><span>الوزن</span><strong>{order.weight}</strong></div></SectionCard></div>
          {user?.role === "admin" && order.privateNotes && <SectionCard title="الملاحظة الخاصة للمسؤول" subtitle="لا تظهر للمندوب أو المستخدم" icon="lock" className="admin-private-note"><p className="detail-note">{order.privateNotes}</p></SectionCard>}
        </div>
      )}
      {labelOpen && !!order.trackingNumber.trim() && <ShippingLabelModal order={order} onClose={() => setLabelOpen(false)} />}
      {statusUpdate && <Modal title="تحديث حالة الطرد" onClose={() => setStatusUpdate(null)} className="tracking-status-modal" sheet><p className="modal-description">سيتم تغيير الحالة من «{getStatus(order.status).label}» إلى «{getStatus(statusUpdate.status).label}». يمكنك كتابة ملاحظة تظهر في سجل التتبع.</p><TrackingNoteComposer status={statusUpdate.status} value={statusUpdate.note} onChange={(note) => setStatusUpdate({ ...statusUpdate, note })} onSubmit={saveStatusUpdate} submitLabel="حفظ الحالة والملاحظة" optional /></Modal>}
    </div>
  );
}
