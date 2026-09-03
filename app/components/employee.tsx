"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "../lib/app-context";
import { formatDate, getStatus } from "../lib/data";
import { Icon } from "./icon";
import { Button, EmptyState, Field, Modal, PageHeader, StatusPill } from "./ui";

export function EmployeeDashboard() {
  const { database, user, openScanner, prepareCollectionInvoice, verifyCollectionCode } = useApp();
  const [collectionVerification, setCollectionVerification] = useState<{ invoiceId: string; invoiceNumber: string; code: string } | null>(null);
  const [verifyingCollection, setVerifyingCollection] = useState(false);
  const [preparingCollectionId, setPreparingCollectionId] = useState<string | null>(null);
  const assignedOrders = useMemo(
    () => database.orders.filter((order) => !order.deleted && order.courierId === user?.id),
    [database.orders, user?.id],
  );
  const collectionInvoices = useMemo(
    () => database.collections,
    [database.collections],
  );
  const pendingCollections = collectionInvoices.filter((invoice) => invoice.status === "pending");
  const readyCollections = collectionInvoices.filter((invoice) => invoice.status === "ready");
  const activeOrders = assignedOrders.filter((order) => order.status !== "delivered" && order.status !== "returned");
  const completedOrders = assignedOrders.filter((order) => order.status === "delivered").length;

  async function submitCollectionVerification(event: FormEvent) {
    event.preventDefault();
    if (!collectionVerification || collectionVerification.code.length !== 4) return;
    setVerifyingCollection(true);
    const verified = await verifyCollectionCode(collectionVerification.invoiceId, collectionVerification.code);
    setVerifyingCollection(false);
    if (verified) setCollectionVerification(null);
  }

  async function prepareCollection(invoiceId: string) {
    if (preparingCollectionId) return;
    setPreparingCollectionId(invoiceId);
    await prepareCollectionInvoice(invoiceId);
    setPreparingCollectionId(null);
  }

  return (
    <div className="page-content employee-dashboard animate-page">
      <PageHeader
        title={`مرحبًا، ${user?.name ?? "موظف المدينة"}`}
        subtitle="حساب موظف بصلاحيات تشغيلية لمسح الطرود والتحقق من فواتير التحصيل"
        action={<span className="employee-role-badge"><Icon name="shield" size={15} />موظف · مندوب</span>}
      />

      <section className="employee-scan-card">
        <div className="employee-scan-card__icon"><Icon name="scan" size={34} /></div>
        <div className="employee-scan-card__copy">
          <span>استلام طرد جديد</span>
          <h2>مسح كود الطرد بالكاميرا</h2>
          <p>امسح كود QR الموجود على ملصق الشحن. إذا كان الطرد «جاهزًا للإرسال» ستصبح حالته «مشحون» ويُسجّل باسمك مباشرة.</p>
        </div>
        <Button icon="camera" className="employee-scan-card__button" onClick={() => openScanner()}>فتح الكاميرا ومسح الكود</Button>
        <div className="employee-scan-card__rule"><Icon name="shield" size={16} /><span>لا يستطيع حساب المستخدم العادي تنفيذ هذا التحديث.</span></div>
      </section>

      <section className="employee-collections" aria-label="تجهيز فواتير التحصيل والتحقق منها">
        <header><div><h2>تحصيل الفواتير</h2><p>جهّز الفاتورة أولًا، ثم أدخل كود المستخدم المكوّن من 4 أرقام لتصبح «تم التسليم» وتسجّل باسمك.</p></div><span>{(pendingCollections.length + readyCollections.length).toLocaleString("ar-EG")}</span></header>
        {collectionInvoices.length ? <div className="employee-collection-list">{collectionInvoices.map((invoice) => <article className="employee-collection-card" key={invoice.id}>
          <span className="employee-collection-card__icon"><Icon name={invoice.status === "pending" ? "receipt" : invoice.status === "ready" ? "key" : "check"} size={21} /></span>
          <div><strong dir="ltr">{invoice.invoiceNumber}</strong><span>{invoice.merchantName}</span><small>{invoice.status === "pending" ? "يمكنك تجهيز هذه الفاتورة للمستخدم." : "تحقق من الكود المعروض في حساب المستخدم."}</small></div>
          <span className={`collection-status collection-status--${invoice.status}`}>{invoice.status === "pending" ? "قيد التجهيز" : invoice.status === "ready" ? "جاهزة للتحويل" : "تم التسليم"}</span>
          <footer>{invoice.status === "pending"
            ? <Button icon="receipt" loading={preparingCollectionId === invoice.id} disabled={preparingCollectionId !== null} onClick={() => { void prepareCollection(invoice.id); }}>تجهيز للتحويل</Button>
            : invoice.status === "ready"
              ? <Button icon="key" onClick={() => setCollectionVerification({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, code: "" })}>قراءة كود التحقق</Button>
              : <span><Icon name="check" size={15} />تم التسليم في {formatDate(invoice.verifiedAt ?? invoice.paidAt ?? invoice.updatedAt)}</span>}
          </footer>
        </article>)}</div> : <EmptyState icon="receipt" title="لا توجد فواتير تحصيل" description="ستظهر هنا فواتير المستخدمين الجديدة لتجهيزها والتحقق من كودها." />}
      </section>

      <section className="employee-permissions" aria-label="صلاحيات حساب الموظف">
        <article><span><Icon name="camera" size={20} /></span><div><strong>مسح الطرود</strong><small>تحديث آمن من جاهز للإرسال إلى مشحون</small></div></article>
        <article><span><Icon name="user" size={20} /></span><div><strong>إسناد تلقائي</strong><small>يُربط الطرد بحساب الموظف الذي مسحه</small></div></article>
        <article><span><Icon name="receipt" size={20} /></span><div><strong>تجهيز الفواتير</strong><small>تحويل فاتورة المستخدم من قيد التجهيز إلى جاهزة للتحويل</small></div></article>
        <article><span><Icon name="clipboard" size={20} /></span><div><strong>تحقق موثّق</strong><small>يحفظ اسم الموظف ووقت شحن الطرد أو تسليم التحصيل</small></div></article>
      </section>

      <section className="employee-stats">
        <article><span>الطرود النشطة</span><strong>{activeOrders.length.toLocaleString("ar-EG")}</strong></article>
        <article><span>تم تسليمها</span><strong>{completedOrders.toLocaleString("ar-EG")}</strong></article>
        <article><span>إجمالي المسند</span><strong>{assignedOrders.length.toLocaleString("ar-EG")}</strong></article>
      </section>

      <section className="employee-orders">
        <header><div><h2>الطرود المسندة إليك</h2><p>تظهر هنا فقط الطرود التي استلمتها بمسح الكود.</p></div><span>{assignedOrders.length.toLocaleString("ar-EG")}</span></header>
        {assignedOrders.length ? (
          <div className="employee-order-list">
            {assignedOrders.map((order) => {
              const status = getStatus(order.status);
              return <article className="employee-order-card" key={order.id}>
                <span className="employee-order-card__icon" style={{ color: status.color, background: status.surface }}><Icon name={status.icon} size={21} /></span>
                <div><strong dir="ltr">{order.trackingNumber}</strong><span>{order.recipientName} · {order.city}</span><div className="employee-order-card__contacts"><a href={`tel:${order.recipientPhone}`} dir="ltr">{order.recipientPhone}</a><a href={`sms:${order.recipientPhone}`}><Icon name="message" size={14} />إشعار العميل</a></div></div>
                <StatusPill status={order.status} />
                {order.notes && <div className="employee-order-card__instructions"><span><Icon name="message" size={16} /></span><div><strong>تعليمات المندوب</strong><p>{order.notes}</p></div></div>}
              </article>;
            })}
          </div>
        ) : <EmptyState icon="scan" title="لا توجد طرود مسندة بعد" description="امسح كود أول طرد جاهز للإرسال ليظهر هنا تلقائيًا." action="مسح كود الطرد" onAction={() => openScanner()} />}
      </section>

      {collectionVerification && <Modal title="قراءة كود التحقق" onClose={() => !verifyingCollection && setCollectionVerification(null)} className="employee-verification-modal" sheet><form className="modal-form employee-verification-form" onSubmit={submitCollectionVerification}><div className="employee-verification-form__intro"><span><Icon name="key" size={24} /></span><div><strong dir="ltr">{collectionVerification.invoiceNumber}</strong><p>أدخل الكود المكوّن من 4 أرقام الذي يعرضه المستخدم. عند صحته تصبح حالة الفاتورة «تم التسليم» مباشرة.</p></div></div><Field icon="key" label="كود التحقق" aria-label="كود تحقق فاتورة التحصيل للموظف" placeholder="0000" value={collectionVerification.code} onChange={(event) => setCollectionVerification({ ...collectionVerification, code: event.target.value.replace(/[^\d]/g, "").slice(0, 4) })} inputMode="numeric" autoComplete="one-time-code" maxLength={4} dir="ltr" autoFocus /><p className="employee-verification-form__note"><Icon name="shield" size={16} />لن تتغير الفاتورة إذا كان الكود غير صحيح، والمحاولات المتكررة محدودة للحماية.</p><Button type="submit" icon="check" full loading={verifyingCollection} disabled={collectionVerification.code.length !== 4}>تحقق وتسليم التحصيل</Button></form></Modal>}
    </div>
  );
}
