"use client";

import { useRef, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { downloadDocument, importTemplate, ordersCsv } from "../lib/download";
import { createTrackingEvent, deliveryLocalities, formatDate, getDeliveryFee, getOversizeFee, getReturnFee, getReturnMembershipPrices, getWeightFee, governorates, money, normalizeWeightOption, parseDimensionCm, relativeDate, resolveDeliveryRegion, uid, type CollectionInvoice, type Notice, type Order } from "../lib/data";
import { parseParcelImportCsv, type ParcelImportCsvLayout, type ParcelImportRow } from "../lib/import-csv";
import { OrderCard } from "./dashboard";
import { Icon } from "./icon";
import { Avatar, Button, EmptyState, Field, IconButton, Modal, PageHeader, SectionCard } from "./ui";

export function ReturnsPage() {
  const { database, user, setView, showToast } = useApp();
  const [period, setPeriod] = useState("all");
  const [exportOpen, setExportOpen] = useState(false);
  const returns = database.orders.filter((order) => order.merchantId === user?.id && order.status === "returned" && !order.deleted);
  const total = returns.reduce((sum, order) => sum + order.amount, 0);
  const returnPrices = getReturnMembershipPrices(user?.membership);

  function exportReturns(kind: "csv" | "xls") {
    downloadDocument(`رواجع-المدينة-إكسبرس.${kind}`, ordersCsv(returns), kind === "xls" ? "application/vnd.ms-excel;charset=utf-8" : undefined);
    setExportOpen(false);
    showToast("تم تنزيل تقرير الرواجع.");
  }

  return <div className="page-content animate-page"><PageHeader title="الرواجع" subtitle="الطرود الراجعة إلى المرسل" action={<Button icon="download" onClick={() => setExportOpen(true)}>تنزيل</Button>} /><div className="alert-banner"><Icon name="info" size={20} /><span><strong>ملاحظة:</strong> تنتهي مسؤولية الشركة عن أي طرد راجع خلال مدة 5 أيام من تاريخ تغيير حالة الطرد إلى «راجع».</span></div><div className="alert-banner"><Icon name="receipt" size={20} /><span><strong>رسوم الرواجع لحسابك:</strong> الضفة الغربية {money(returnPrices.westBank)} ₪ · القدس {money(returnPrices.jerusalem)} ₪ · الداخل {money(returnPrices.interior)} ₪.</span></div><div className="metrics-row"><div className="metric-card metric-card--red"><strong>{returns.length}</strong><span>عدد الرواجع</span></div><div className="metric-card metric-card--red"><strong>{money(total)}</strong><span>إجمالي المبالغ (₪)</span></div></div><div className="filter-scroll"><Icon name="calendar" size={18} />{[{ id: "all", label: "الكل" }, { id: "today", label: "اليوم" }, { id: "yesterday", label: "أمس" }, { id: "week", label: "آخر 7 أيام" }, { id: "month", label: "آخر 30 يومًا" }].map((item) => <button key={item.id} className={period === item.id ? "filter-chip is-active" : "filter-chip"} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div>{returns.length ? <div className="order-list">{returns.map((order) => <OrderCard key={order.id} order={order} />)}</div> : <EmptyState icon="return" title="لا توجد رواجع" description="لا توجد طرود راجعة خلال الفترة المحددة." action="إنشاء طرد" onAction={() => setView("new-order")} />}{exportOpen && <Modal title="تنزيل الرواجع" onClose={() => setExportOpen(false)} sheet><p className="modal-description">اختر صيغة الملف — سيتم تصدير السجل حسب الفترة المحددة.</p><div className="export-options"><button onClick={() => exportReturns("xls")}><Icon name="spreadsheet" size={32} /><strong>Excel</strong><span>.xls</span></button><button onClick={() => exportReturns("csv")}><Icon name="file" size={32} /><strong>CSV</strong><span>.csv</span></button></div></Modal>}</div>;
}

const collectionStatus = {
  pending: { label: "قيد التجهيز", icon: "clock" as const },
  ready: { label: "جاهزة للتحويل", icon: "wallet" as const },
  paid: { label: "تم التسليم", icon: "check" as const },
};

function createVerificationCode() {
  const values = window.crypto.getRandomValues(new Uint16Array(1));
  return String(1000 + (values[0] % 9000));
}

export function CollectionsPage() {
  const { database, user, updateDatabase, showToast, notify } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [codeInvoiceId, setCodeInvoiceId] = useState<string | null>(null);
  const [authorizedRecipient, setAuthorizedRecipient] = useState("");
  const invoices = database.collections.filter((invoice) => invoice.merchantId === user?.id);
  const invoicedOrders = new Set(invoices.flatMap((invoice) => invoice.orderIds));
  const eligibleOrders = database.orders.filter((order) => order.merchantId === user?.id && !order.deleted && (order.status === "delivered" || order.status === "returned") && !invoicedOrders.has(order.id));
  const returnFeeForOrder = (order: Order) => getReturnFee(resolveDeliveryRegion(order.governorate ?? "", order.city), user?.membership);
  const selectedInvoice = invoices.find((invoice) => invoice.id === selectedId) ?? null;
  const codeInvoice = invoices.find((invoice) => invoice.id === codeInvoiceId) ?? null;
  const availableAmount = eligibleOrders.reduce((sum, order) => sum + (order.status === "delivered" ? order.amount - order.deliveryFee : -returnFeeForOrder(order)), 0);
  const pendingAmount = invoices.filter((invoice) => invoice.status === "pending").reduce((sum, invoice) => sum + invoice.netAmount, 0);
  const readyAmount = invoices.filter((invoice) => invoice.status === "ready").reduce((sum, invoice) => sum + invoice.netAmount, 0);
  const deliveredAmount = invoices.filter((invoice) => invoice.status === "paid").reduce((sum, invoice) => sum + invoice.netAmount, 0);

  function createInvoice() {
    if (!user || !eligibleOrders.length) return showToast("لا توجد طرود واصلة أو رواجع جديدة لإنشاء فاتورة.", "error");
    const delivered = eligibleOrders.filter((order) => order.status === "delivered");
    const returned = eligibleOrders.filter((order) => order.status === "returned");
    const grossAmount = delivered.reduce((sum, order) => sum + order.amount, 0);
    const deliveryFees = delivered.reduce((sum, order) => sum + order.deliveryFee, 0);
    const returnFees = returned.reduce((sum, order) => sum + returnFeeForOrder(order), 0);
    const now = new Date();
    const scheduledAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const invoice: CollectionInvoice = {
      id: uid("collection"),
      merchantId: user.id,
      merchantName: user.name,
      invoiceNumber: `#${database.nextCollection}`,
      orderIds: eligibleOrders.map((order) => order.id),
      grossAmount,
      deliveryFees,
      returnFees,
      netAmount: grossAmount - deliveryFees - returnFees,
      deliveredCount: delivered.length,
      returnedCount: returned.length,
      status: "pending",
      verificationCode: createVerificationCode(),
      authorizedRecipient: "",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
    };
    updateDatabase((current) => ({ ...current, collections: [invoice, ...current.collections], nextCollection: current.nextCollection + 1 }));
    notify({ userId: user.id, title: "تم إنشاء فاتورة التحصيل", message: `أُنشئت الفاتورة ${invoice.invoiceNumber} وستراجعها الإدارة لتجهيز التحويل.`, icon: "receipt" });
    showToast("تم إنشاء فاتورة التحصيل بنجاح.");
  }

  function invoiceOrders(invoice: CollectionInvoice) {
    const ids = new Set(invoice.orderIds);
    return database.orders.filter((order) => ids.has(order.id));
  }

  function returnFeeForInvoiceOrder(invoice: CollectionInvoice, order: Order) {
    const savedFee = invoice.returnFeeDetails?.find((item) => item.orderId === order.id)?.fee;
    return typeof savedFee === "number" && Number.isFinite(savedFee) ? savedFee : returnFeeForOrder(order);
  }

  function downloadInvoice(invoice: CollectionInvoice) {
    downloadDocument(`فاتورة-تحصيل-${invoice.invoiceNumber.replace("#", "")}.csv`, ordersCsv(invoiceOrders(invoice)));
    showToast("تم تنزيل تفاصيل فاتورة التحصيل.");
  }

  function openVerification(invoice: CollectionInvoice) {
    setAuthorizedRecipient(invoice.authorizedRecipient);
    setCodeInvoiceId(invoice.id);
  }

  function refreshVerificationCode(invoice: CollectionInvoice) {
    const verificationCode = createVerificationCode();
    updateDatabase((current) => ({ ...current, collections: current.collections.map((item) => item.id === invoice.id ? { ...item, verificationCode, updatedAt: new Date().toISOString() } : item) }));
    showToast("تم إنشاء رمز تحقق جديد.");
  }

  async function copyVerificationCode(invoice: CollectionInvoice) {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(invoice.verificationCode);
      showToast("تم نسخ رمز التحقق.");
    } catch {
      showToast(`رمز التحقق: ${invoice.verificationCode}`, "info");
    }
  }

  function saveAuthorizedRecipient(event: FormEvent) {
    event.preventDefault();
    if (!codeInvoice || !authorizedRecipient.trim()) return showToast("أدخل اسم المستلم المفوض.", "error");
    updateDatabase((current) => ({ ...current, collections: current.collections.map((invoice) => invoice.id === codeInvoice.id ? { ...invoice, authorizedRecipient: authorizedRecipient.trim(), updatedAt: new Date().toISOString() } : invoice) }));
    setCodeInvoiceId(null);
    showToast("تم حفظ اسم المستلم المفوض.");
  }

  const selectedOrders = selectedInvoice ? invoiceOrders(selectedInvoice) : [];
  const regions = selectedOrders.reduce<Record<string, { delivered: number; returned: number }>>((result, order) => {
    const region = resolveDeliveryRegion(order.governorate ?? "", order.city)?.name;
    const key = region === "القدس" ? "القدس" : region === "الداخل" ? "الداخل" : "الضفة الغربية";
    result[key] ??= { delivered: 0, returned: 0 };
    if (order.status === "returned") result[key].returned += 1;
    else result[key].delivered += 1;
    return result;
  }, {});

  return (
    <div className="page-content collections-page animate-page">
      <PageHeader title="التحصيلات" subtitle="فواتير المبالغ المحصلة من طرودك" action={<Button icon="receipt" onClick={createInvoice} disabled={!eligibleOrders.length}>إنشاء فاتورة</Button>} />

      <section className="collection-balance">
        <div><span>المبلغ المتاح للفوترة</span><strong>{money(availableAmount)} <small>₪</small></strong></div>
        <span><Icon name="wallet" size={25} /></span>
        <p>{eligibleOrders.length ? `${eligibleOrders.length} طردًا جاهزًا للإضافة إلى فاتورة جديدة` : "لا توجد طرود جديدة جاهزة للفوترة"}</p>
      </section>

      <div className="collection-metrics">
        <article><span><Icon name="clock" size={18} /></span><strong>{money(pendingAmount)} ₪</strong><small>قيد التجهيز</small></article>
        <article><span><Icon name="wallet" size={18} /></span><strong>{money(readyAmount)} ₪</strong><small>جاهز للتحويل</small></article>
        <article><span><Icon name="check" size={18} /></span><strong>{money(deliveredAmount)} ₪</strong><small>تم التسليم</small></article>
      </div>

      {invoices.length ? <div className="collection-list">{invoices.map((invoice) => {
        const status = collectionStatus[invoice.status];
        return <button type="button" className="collection-card" key={invoice.id} onClick={() => setSelectedId(invoice.id)}>
          <div className="collection-card__main"><strong dir="ltr">{invoice.invoiceNumber}</strong><span className={`collection-status collection-status--${invoice.status}`}><Icon name={status.icon} size={13} />{status.label}</span><dl><div><dt><Icon name="calendar" size={13} />تاريخ الإنشاء</dt><dd>{formatDate(invoice.createdAt)}</dd></div><div><dt><Icon name="calendar" size={13} />موعد التسليم</dt><dd>{formatDate(invoice.paidAt ?? invoice.scheduledAt)}</dd></div></dl></div>
          <div className="collection-card__numbers"><strong>{money(invoice.netAmount)} <small>₪</small></strong><span><Icon name="check" size={13} />{invoice.deliveredCount} واصل</span><span><Icon name="return" size={13} />{invoice.returnedCount} راجع</span></div>
        </button>;
      })}</div> : <EmptyState icon="receipt" title="لا توجد فواتير تحصيل" description="بعد وصول الطرود ستتمكن من جمعها في فاتورة ومتابعة تحويل المبلغ." action={eligibleOrders.length ? "إنشاء فاتورة" : undefined} onAction={createInvoice} />}

      {selectedInvoice && <Modal title="تفاصيل فاتورة التحصيل" onClose={() => setSelectedId(null)} className="collection-detail-modal" sheet>
        <div className="collection-detail__toolbar"><span className="collection-detail__marker" /><div><IconButton name="printer" label="طباعة الفاتورة" onClick={() => window.print()} /><IconButton name="download" label="تنزيل الفاتورة" onClick={() => downloadInvoice(selectedInvoice)} /></div></div>
        <div className="collection-detail__scroll">
          <section className="collection-detail__summary"><div><strong dir="ltr">{selectedInvoice.invoiceNumber}</strong><span className={`collection-status collection-status--${selectedInvoice.status}`}>{collectionStatus[selectedInvoice.status].label}</span></div><dl><div><dt>إجمالي التحصيل</dt><dd>{money(selectedInvoice.grossAmount)} ₪</dd></div><div><dt>رسوم التوصيل</dt><dd>- {money(selectedInvoice.deliveryFees)} ₪</dd></div>{selectedInvoice.returnFees > 0 && <div><dt>رسوم الرواجع</dt><dd>- {money(selectedInvoice.returnFees)} ₪</dd></div>}<div className="is-total"><dt>صافي الفاتورة</dt><dd>{money(selectedInvoice.netAmount)} ₪</dd></div></dl></section>
          <section className="collection-detail__section"><h3>طرود الفاتورة <span>{selectedOrders.length}</span></h3><div className="collection-table"><div className="collection-table__head"><span>المنطقة</span><span>واصل</span><span>راجع</span></div>{Object.entries(regions).map(([region, counts]) => <div className="collection-table__row" key={region}><strong>{region}</strong><span>{counts.delivered}</span><span>{counts.returned}</span></div>)}</div></section>
          <section className="collection-detail__section"><h3>استثناءات الفاتورة</h3>{selectedOrders.some((order) => order.status === "returned") ? <div className="collection-exceptions">{selectedOrders.filter((order) => order.status === "returned").map((order) => <div key={order.id}><Icon name="return" size={17} /><span><strong dir="ltr">{order.trackingNumber}</strong><small>{order.recipientName} · {order.city}</small></span><b>- {money(returnFeeForInvoiceOrder(selectedInvoice, order))} ₪</b></div>)}</div> : <p className="collection-detail__empty"><Icon name="check" size={17} />هذه الفاتورة لا تحتوي على استثناءات.</p>}</section>
        </div>
        <div className="collection-detail__action"><Button icon="key" full onClick={() => openVerification(selectedInvoice)}>كود التحقق</Button></div>
      </Modal>}

      {codeInvoice && <Modal ariaLabel="كود التحقق" onClose={() => setCodeInvoiceId(null)} className="verification-modal" sheet><header className="verification-modal__header"><span className="verification-modal__handle" /><IconButton type="button" name="close" label="إغلاق" onClick={() => setCodeInvoiceId(null)} /><div><span dir="ltr">{codeInvoice.invoiceNumber}</span><h2>كود التحقق</h2></div></header><form onSubmit={saveAuthorizedRecipient}><p className="verification-modal__intro">اعرض هذا الكود عند استلام مبلغ الفاتورة، ولا تشاركه إلا مع المستلم المفوض.</p><div className="verification-code"><div className="verification-code__value"><span>رمز التحقق:</span><strong dir="ltr">{codeInvoice.verificationCode}</strong></div><div className="verification-code__actions"><IconButton type="button" name="copy" label="نسخ الرمز" onClick={() => { void copyVerificationCode(codeInvoice); }} /><IconButton type="button" name="refresh" label="تحديث الرمز" onClick={() => refreshVerificationCode(codeInvoice)} /></div></div><div className="verification-recipient"><strong>مستلم مفوض</strong><Field icon="user" placeholder="الاسم" value={authorizedRecipient} onChange={(event) => setAuthorizedRecipient(event.target.value)} autoComplete="name" /></div><Button type="submit" icon="check" full>تأكيد</Button></form></Modal>}
    </div>
  );
}

export function RecipientsPage() {
  const { database, user, updateDatabase, showToast, confirm } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", governorate: "", city: "", address: "" });
  const selectedGovernorate = resolveDeliveryRegion(form.governorate);
  const localitySuggestions = selectedGovernorate
    ? deliveryLocalities.filter((item) => item.governorate === selectedGovernorate.name)
    : deliveryLocalities;
  const recipients = database.recipients.filter((item) => item.merchantId === user?.id && (!query || `${item.name} ${item.phone} ${item.governorate ?? ""} ${item.city}`.includes(query)));

  function save(event: FormEvent) {
    event.preventDefault();
    if (!user || !form.name.trim()) return showToast("أدخل اسم المستلم.", "error");
    if (!/^05\d{8}$/.test(form.phone)) return showToast("أدخل رقم جوال صحيحًا.", "error");
    if (!form.governorate.trim() || !form.city.trim()) return showToast("أدخل المحافظة والمدينة أو المنطقة.", "error");
    if (!resolveDeliveryRegion(form.governorate, form.city)) return showToast("اختر محافظة ومدينة متطابقتين من الاقتراحات.", "error");
    const recipient = { ...form, name: form.name.trim(), governorate: form.governorate.trim(), city: form.city.trim(), address: form.address.trim(), id: uid("recipient"), merchantId: user.id, favorite: true };
    updateDatabase((current) => ({ ...current, recipients: [recipient, ...current.recipients] }));
    setOpen(false); setForm({ name: "", phone: "", governorate: "", city: "", address: "" }); showToast("تمت إضافة المستلم إلى المفضلة.");
  }

  return <div className="page-content animate-page"><PageHeader title="المستلمون المفضلون" subtitle="احتفظ ببيانات العملاء الذين تتعامل معهم باستمرار" action={<Button icon="plus" onClick={() => setOpen(true)}>إضافة مستلم</Button>} /><Field icon="search" placeholder="ابحث باسم المستلم أو رقم الجوال..." value={query} onChange={(event) => setQuery(event.target.value)} wrapperClassName="search-field" />{recipients.length ? <div className="recipient-list">{recipients.map((recipient) => <article className="recipient-card" key={recipient.id}><Avatar name={recipient.name} color="#158754" /><div><strong>{recipient.name}</strong><a href={`tel:${recipient.phone}`} dir="ltr">{recipient.phone}</a><span>{recipient.governorate ? `${recipient.governorate} · ` : ""}{recipient.city}{recipient.address && ` · ${recipient.address}`}</span></div><IconButton name="trash" label="حذف المستلم" className="is-danger" onClick={() => confirm({ title: "حذف المستلم؟", message: `ستُحذف بيانات ${recipient.name} من قائمة المستلمين المحفوظين.`, confirmLabel: "حذف", danger: true, onConfirm: () => { updateDatabase((current) => ({ ...current, recipients: current.recipients.filter((item) => item.id !== recipient.id) })); showToast("تم حذف المستلم."); } })} /></article>)}</div> : <EmptyState icon="users" title="لا يوجد مستلمون محفوظون" description="أضف المستلمين الذين تتعامل معهم باستمرار لتعبئة بياناتهم بسرعة." action="إضافة مستلم" onAction={() => setOpen(true)} />}{open && <Modal title="إضافة مستلم جديد" onClose={() => setOpen(false)} sheet><form className="modal-form" onSubmit={save}><Field icon="user" label="اسم المستلم" placeholder="الاسم الكامل" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><Field icon="phone" label="رقم الجوال" placeholder="05xxxxxxxx" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value.replace(/[^\d]/g, "").slice(0, 10) })} dir="ltr" /><Field label="المحافظة" placeholder="اكتب أو اختر المحافظة" list="recipient-governorates" value={form.governorate} onChange={(event) => setForm({ ...form, governorate: event.target.value })} autoComplete="address-level1" /><Field label="المدينة أو المنطقة" placeholder="اكتب أو اختر المدينة أو المنطقة" list="recipient-localities" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} autoComplete="address-level2" /><datalist id="recipient-governorates">{governorates.map((item) => <option key={item.name} value={item.name} />)}</datalist><datalist id="recipient-localities">{localitySuggestions.map((item) => <option key={`${item.governorate}-${item.name}`} value={item.name} label={item.governorate} />)}</datalist><Field label="العنوان التفصيلي" placeholder="الشارع والمعلم القريب" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /><Button type="submit" icon="user" full>إضافة المستلم</Button></form></Modal>}</div>;
}

export function NotificationsPage() {
  const { database, user, updateDatabase, clearNotices, setSelectedOrderId, setView, confirm, showToast } = useApp();
  const [clearingTarget, setClearingTarget] = useState<string | null>(null);
  const clearingNotices = clearingTarget !== null;
  const notices = database.notices.filter((notice) => notice.userId === user?.id);

  function markAllRead() {
    updateDatabase((current) => ({ ...current, notices: current.notices.map((notice) => notice.userId === user?.id ? { ...notice, read: true } : notice) }));
    showToast("تم تحديد جميع الإشعارات كمقروءة.");
  }

  function openNotice(notice: Notice) {
    updateDatabase((current) => ({ ...current, notices: current.notices.map((entry) => entry.id === notice.id && entry.userId === user?.id ? { ...entry, read: true } : entry) }));
    if (!notice.orderId) return;

    const linkedOrder = database.orders.find((order) => order.id === notice.orderId && (user?.role === "admin" || order.merchantId === user?.id));
    if (!linkedOrder) {
      showToast("الطرد المرتبط بهذا الإشعار غير متاح.", "error");
      return;
    }

    try { sessionStorage.setItem("almadina-order-note-target", linkedOrder.id); } catch { /* Navigation still works without browser storage. */ }
    setSelectedOrderId(linkedOrder.id);
    setView("order-detail");
  }

  async function performClearNotices(noticeIds: string[], target: string) {
    if (clearingNotices) return;
    setClearingTarget(target);
    try {
      const removedCount = await clearNotices(noticeIds);
      if (removedCount === null) return;
      showToast(removedCount > 0 ? target === "all" ? `تم مسح ${removedCount.toLocaleString("ar-EG")} من الإشعارات.` : "تم حذف الإشعار." : "الإشعار المحدد لم يعد موجودًا.");
    } finally {
      setClearingTarget(null);
    }
  }

  function requestClearNotice(noticeId: string, noticeTitle: string) {
    if (clearingNotices) return;
    confirm({
      title: "حذف الإشعار؟",
      message: `سيتم حذف إشعار «${noticeTitle}» من صندوق إشعارات هذا الحساب فقط، ولا يمكن استعادته.`,
      confirmLabel: "حذف الإشعار",
      danger: true,
      onConfirm: () => { void performClearNotices([noticeId], noticeId); },
    });
  }

  function requestClearNotices() {
    const visibleNoticeIds = notices.map((notice) => notice.id);
    if (!visibleNoticeIds.length) return;
    confirm({
      title: "مسح جميع الإشعارات؟",
      message: `سيتم مسح ${visibleNoticeIds.length.toLocaleString("ar-EG")} من إشعارات هذا الحساب فقط. لن تتأثر الطرود أو بيانات الحساب أو إشعارات المستخدمين الآخرين، ولا يمكن استعادة الإشعارات المحذوفة.`,
      confirmLabel: "مسح الإشعارات",
      danger: true,
      onConfirm: () => { void performClearNotices(visibleNoticeIds, "all"); },
    });
  }

  const notificationActions = notices.length ? <div className="notification-page-actions">{notices.some((notice) => !notice.read) && <Button variant="ghost" icon="check" disabled={clearingNotices} onClick={markAllRead}>قراءة الكل</Button>}<Button variant="ghost" icon="trash" className="notification-clear-button" loading={clearingTarget === "all"} disabled={clearingNotices} onClick={requestClearNotices}>{clearingTarget === "all" ? "جارٍ المسح…" : "مسح الكل"}</Button></div> : undefined;

  return <div className="page-content animate-page"><PageHeader title="الإشعارات" subtitle="آخر التحديثات المتعلقة بحسابك وطرودك" onBack={() => setView(user?.role === "admin" ? "admin" : "home")} action={notificationActions} />{notices.length ? <div className="notification-list">{notices.map((notice) => <article className={`notification-card ${notice.read ? "" : "is-unread"}`} key={notice.id}><button type="button" className="notification-card__content" aria-label={notice.orderId ? `فتح إشعار ${notice.title} والانتقال إلى الطرد` : `تحديد إشعار ${notice.title} كمقروء`} onClick={() => openNotice(notice)}><span><Icon name={notice.icon} size={21} /></span><div><strong>{notice.title}</strong><p>{notice.message}</p><small>{relativeDate(notice.createdAt)}</small></div>{!notice.read && <i />}</button><IconButton name="trash" label={`حذف الإشعار: ${notice.title}`} className="notification-card__delete is-danger" disabled={clearingNotices} aria-busy={clearingTarget === notice.id} onClick={() => requestClearNotice(notice.id, notice.title)} /></article>)}</div> : <EmptyState icon="bell" title="لا توجد إشعارات" description="ستظهر هنا التحديثات المتعلقة بحسابك وطرودك." />}</div>;
}

export function TrashPage() {
  const { database, user, updateDatabase, setView, confirm, showToast } = useApp();
  const deleted = database.orders.filter((order) => order.deleted && (user?.role === "admin" || order.merchantId === user?.id));
  return <div className="page-content animate-page"><PageHeader title="الطرود المحذوفة" subtitle="يمكنك استعادة الطرود المحذوفة أو حذفها نهائيًا" onBack={() => setView(user?.role === "admin" ? "admin" : "home")} />{deleted.length ? <div className="trash-list">{deleted.map((order) => <SectionCard key={order.id}><div className="trash-item"><div><strong dir="ltr">{order.trackingNumber}</strong><span>{order.recipientName} · {order.city}</span></div><div><IconButton name="refresh" label="استعادة الطرد" onClick={() => { updateDatabase((current) => ({ ...current, orders: current.orders.map((item) => item.id === order.id ? { ...item, deleted: false } : item) })); showToast("تمت استعادة الطرد."); }} /><IconButton name="trash" label="حذف نهائي" className="is-danger" onClick={() => confirm({ title: "حذف الطرد نهائيًا؟", message: "لن تتمكن من استعادة الطرد بعد حذفه نهائيًا.", danger: true, confirmLabel: "حذف نهائي", onConfirm: () => { updateDatabase((current) => ({ ...current, orders: current.orders.filter((item) => item.id !== order.id) })); showToast("تم حذف الطرد نهائيًا."); } })} /></div></div></SectionCard>)}</div> : <EmptyState icon="trash" title="لا توجد طرود محذوفة" description="أي طرد تنقله إلى سلة المحذوفات سيظهر هنا." />}</div>;
}

export function ImportPage() {
  const { user, updateDatabase, setView, showToast } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParcelImportRow[]>([]);
  const [layout, setLayout] = useState<ParcelImportCsvLayout>("governorate-city");

  function openFile(file?: File) {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return showToast("احفظ ملف Excel بصيغة CSV ثم ارفعه هنا.", "error");
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseParcelImportCsv(String(reader.result ?? ""));
      if (!parsed.rows.length) return showToast("الملف لا يحتوي على طلبات صالحة.", "error");
      setFileName(file.name); setRows(parsed.rows); setLayout(parsed.layout);
      showToast(`تم العثور على ${parsed.rows.length} طلب في الملف${parsed.layout === "legacy-region" ? " باستخدام تنسيق المنطقة القديم" : ""}.`);
    };
    reader.readAsText(file);
  }

  function importRows() {
    if (!user || !rows.length) return;
    const validRows = rows.filter((row) => row.name && row.phone);
    if (!validRows.length) return showToast("لا توجد صفوف تحتوي على اسم مستلم ورقم جوال.", "error");
    const invalidRows = validRows.filter((row) => (
      (layout === "governorate-city" && (!row.governorate || !row.city))
      || !resolveDeliveryRegion(row.governorate, row.city)
    ));
    if (invalidRows.length) return showToast(`تعذّر تحديد محافظة ومدينة متطابقتين في ${invalidRows.length.toLocaleString("ar-EG")} صف. استخدم القيم الموجودة في قوائم المناطق.`, "error");
    updateDatabase((current) => {
      let counter = current.nextOrder;
      const created: Order[] = validRows.map((row) => {
        const region = resolveDeliveryRegion(row.governorate, row.city);
        if (!region) throw new Error("منطقة توصيل غير معروفة في ملف الاستيراد.");
        const lengthCm = parseDimensionCm(row.length);
        const widthCm = parseDimensionCm(row.width);
        const heightCm = parseDimensionCm(row.height);
        const weight = normalizeWeightOption(row.weight);
        const weightFee = getWeightFee(weight);
        const oversizeFee = getOversizeFee(lengthCm, widthCm, heightCm);
        const dimensions = [lengthCm, widthCm, heightCm].some(Boolean) ? `${lengthCm ?? 0} × ${widthCm ?? 0} × ${heightCm ?? 0} سم` : "غير محددة";
        const now = new Date().toISOString();
        const order: Order = {
          id: uid("order"), trackingNumber: `ALX-${counter++}`, merchantId: user.id, merchantName: user.name, merchantStore: user.store,
          recipientName: row.name, recipientPhone: row.phone, governorate: region.name, city: row.city, address: row.address || "يُحدد لاحقًا",
          pickupAddress: user.store, amount: Number(row.amount) || 0, deliveryFee: getDeliveryFee(region, user.membership) + weightFee + oversizeFee,
          content: row.content, weight, dimensions, lengthCm, widthCm, heightCm, weightFee, oversizeFee,
          notes: "", privateNotes: "", reference: "", type: "طرد عادي", status: "draft", courierName: "بانتظار تعيين المندوب",
          trackingEvents: [createTrackingEvent("draft", user.name, { location: "مع المرسل", note: "تم إنشاء الطرد عبر ملف الاستيراد وحالته قيد الإنشاء.", createdAt: now })],
          createdAt: now, updatedAt: now, deleted: false,
        };
        return order;
      });
      return { ...current, orders: [...created, ...current.orders], nextOrder: counter };
    });
    showToast(`تم استيراد ${validRows.length} طرد بحالة قيد الإنشاء.`); setView("shipments");
  }

  return <div className="page-content animate-page"><PageHeader title="استيراد طرود من Excel" subtitle="أنشئ عدة طرود دفعة واحدة" onBack={() => setView("home")} /><SectionCard title="تعليمات الاستيراد" icon="info"><ol className="instruction-list"><li>حمّل نموذج الاستيراد وافتحه باستخدام Excel أو Google Sheets.</li><li>املأ الاسم ورقم الجوال، ثم أدخل المحافظة والمدينة في عمودين منفصلين.</li><li>يبقى القالب القديم ذو عمود المدينة أو المنطقة الواحد مدعومًا للمناطق التي يمكن تحديدها دون التباس.</li><li>اختر الوزن، وأدخل الأبعاد اختياريًا؛ يحسب النظام رسوم الوزن والحجم تدريجيًا.</li><li>احفظ الملف بصيغة CSV ثم اختره من منطقة الرفع.</li></ol><Button variant="outline" icon="download" onClick={() => { downloadDocument("نموذج-استيراد-طرود-المدينة-إكسبرس.csv", importTemplate); showToast("تم تنزيل نموذج الاستيراد."); }}>تحميل نموذج الاستيراد</Button></SectionCard><button className={`upload-zone ${fileName ? "has-file" : ""}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); openFile(event.dataTransfer.files[0]); }}><Icon name="upload" size={42} /><strong>{fileName || "اسحب ملف CSV إلى هنا أو اضغط لاختياره"}</strong><span>{rows.length ? `${rows.length} طلب جاهز للاستيراد${layout === "legacy-region" ? " · قالب قديم" : ""}` : "ملفات CSV المتوافقة مع Excel — بحد أقصى 1000 طلب"}</span></button><input ref={inputRef} type="file" accept=".csv,.txt" className="sr-only" onChange={(event) => openFile(event.target.files?.[0])} />{rows.length > 0 && <Button icon="upload" full onClick={importRows}>استيراد {rows.length} طلب</Button>}</div>;
}

export function ProfilePage() {
  const { database, user, updateDatabase, setView, showToast } = useApp();
  const canEdit = user?.role === "admin";
  const [form, setForm] = useState({ name: user?.name ?? "", phone: user?.phone ?? "", store: user?.store ?? "", email: user?.email ?? "" });
  function save(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    if (!user || !form.name.trim() || !form.store.trim()) return showToast("أدخل الاسم واسم المتجر.", "error");
    if (!/^05\d{8}$/.test(form.phone)) return showToast("أدخل رقم جوال صحيحًا.", "error");
    const email = form.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast("أدخل بريدًا إلكترونيًا صحيحًا.", "error");
    if (database.users.some((entry) => entry.id !== user.id && entry.email.toLowerCase() === email)) return showToast("هذا البريد الإلكتروني مسجل لحساب آخر.", "error");
    updateDatabase((current) => ({ ...current, users: current.users.map((entry) => entry.id === user.id ? { ...entry, name: form.name.trim(), phone: form.phone, store: form.store.trim(), email } : entry) }));
    showToast("تم تحديث بيانات الحساب.");
  }
  return <form className={`page-content animate-page ${canEdit ? "" : "profile-readonly"}`} onSubmit={save}><PageHeader title="الملف الشخصي" subtitle={canEdit ? "إدارة بيانات حساب المسؤول" : "بيانات الحساب للعرض فقط"} onBack={() => setView("settings")} /><SectionCard className="profile-hero"><Avatar name={user?.name ?? "م"} color={user?.avatarColor ?? "#087c45"} large /><strong>{user?.name}</strong><span>{user?.email}</span><small>عضو منذ {formatDate(user?.joinedAt ?? new Date().toISOString())}</small></SectionCard><SectionCard title="بيانات الحساب" icon="user"><Field label="الاسم الكامل" icon="user" value={canEdit ? form.name : user?.name ?? ""} readOnly={!canEdit} onChange={canEdit ? (event) => setForm({ ...form, name: event.target.value }) : undefined} /><Field label="رقم الجوال" icon="phone" value={canEdit ? form.phone : user?.phone ?? ""} readOnly={!canEdit} onChange={canEdit ? (event) => setForm({ ...form, phone: event.target.value.replace(/[^\d]/g, "").slice(0, 10) }) : undefined} dir="ltr" /><Field label={user?.role === "courier" ? "المنطقة" : "اسم المتجر"} icon="store" value={canEdit ? form.store : user?.store ?? ""} readOnly={!canEdit} onChange={canEdit ? (event) => setForm({ ...form, store: event.target.value }) : undefined} /><Field label="البريد الإلكتروني" icon="mail" value={canEdit ? form.email : user?.email ?? ""} readOnly={!canEdit} onChange={canEdit ? (event) => setForm({ ...form, email: event.target.value }) : undefined} dir="ltr" /></SectionCard>{user?.governorate && user.city && user.address && <SectionCard title="عنوان الحساب" icon="mapPin"><Field label="المدينة" icon="mapPin" value={user.governorate} readOnly /><Field label="المنطقة" icon="mapPin" value={user.city} readOnly /><Field label="الشارع / وصف العنوان" icon="mapPin" value={user.address} readOnly /></SectionCard>}{canEdit && <Button type="submit" icon="check" full>حفظ التغييرات</Button>}</form>;
}
