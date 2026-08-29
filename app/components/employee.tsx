"use client";

import { useMemo } from "react";
import { useApp } from "../lib/app-context";
import { getStatus } from "../lib/data";
import { Icon } from "./icon";
import { Button, EmptyState, PageHeader, StatusPill } from "./ui";

export function EmployeeDashboard() {
  const { database, user, openScanner } = useApp();
  const assignedOrders = useMemo(
    () => database.orders.filter((order) => !order.deleted && order.courierId === user?.id),
    [database.orders, user?.id],
  );
  const activeOrders = assignedOrders.filter((order) => order.status !== "delivered" && order.status !== "returned");
  const completedOrders = assignedOrders.filter((order) => order.status === "delivered").length;

  return (
    <div className="page-content employee-dashboard animate-page">
      <PageHeader
        title={`مرحبًا، ${user?.name ?? "موظف المدينة"}`}
        subtitle="حساب موظف بصلاحيات تشغيلية لمسح الطرود ومتابعة ما استلمته"
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

      <section className="employee-permissions" aria-label="صلاحيات حساب الموظف">
        <article><span><Icon name="camera" size={20} /></span><div><strong>مسح الطرود</strong><small>تحديث آمن من جاهز للإرسال إلى مشحون</small></div></article>
        <article><span><Icon name="user" size={20} /></span><div><strong>إسناد تلقائي</strong><small>يُربط الطرد بحساب الموظف الذي مسحه</small></div></article>
        <article><span><Icon name="clipboard" size={20} /></span><div><strong>سجل موثّق</strong><small>يحفظ اسم الموظف ووقت استلام الطرد</small></div></article>
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
                <div><strong dir="ltr">{order.trackingNumber}</strong><span>{order.recipientName} · {order.city}</span><a href={`tel:${order.recipientPhone}`} dir="ltr">{order.recipientPhone}</a></div>
                <StatusPill status={order.status} />
                {order.notes && <div className="employee-order-card__instructions"><span><Icon name="message" size={16} /></span><div><strong>تعليمات المندوب</strong><p>{order.notes}</p></div></div>}
              </article>;
            })}
          </div>
        ) : <EmptyState icon="scan" title="لا توجد طرود مسندة بعد" description="امسح كود أول طرد جاهز للإرسال ليظهر هنا تلقائيًا." action="مسح كود الطرد" onAction={() => openScanner()} />}
      </section>
    </div>
  );
}
