"use client";

import type { CSSProperties, FormEvent } from "react";
import { getOrderTrackingEvents, getStatus, type OrderStatus, type TrackableOrder } from "../lib/data";
import { Icon } from "./icon";
import { Button, StatusPill } from "./ui";

function trackingTimestamp(value: string) {
  return new Intl.DateTimeFormat("ar-PS", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TrackingNoteComposer({ status, value, onChange, onSubmit, submitLabel = "حفظ الملاحظة", optional = false }: {
  status: OrderStatus;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitLabel?: string;
  optional?: boolean;
}) {
  const statusDetails = getStatus(status);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!optional && !value.trim()) return;
    onSubmit();
  }

  return (
    <form className="tracking-note-form" onSubmit={submit}>
      <div className="tracking-note-form__heading">
        <span style={{ "--note-status-color": statusDetails.color } as CSSProperties}><Icon name={statusDetails.icon} size={16} />{statusDetails.label}</span>
        <small dir="ltr">{value.length} / 500</small>
      </div>
      <label className="tracking-note-form__field">
        <span>{optional ? "ملاحظة الحالة (اختياري)" : "نص الملاحظة"}</span>
        <textarea
          value={value}
          maxLength={500}
          rows={4}
          placeholder={optional ? "مثلًا: تم التواصل مع المستلم وسيتم التسليم مساءً" : "اكتب ملاحظة مرتبطة بحالة الطرد الحالية..."}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <Button type="submit" icon="message" full disabled={!optional && !value.trim()}>{submitLabel}</Button>
    </form>
  );
}

export function TrackingHistory({ order, compact = false }: { order: TrackableOrder; compact?: boolean }) {
  const events = getOrderTrackingEvents(order).reverse();

  return (
    <section className={`tracking-history ${compact ? "tracking-history--compact" : ""}`} aria-label={`سجل تتبع الطرد ${order.trackingNumber}`}>
      {!compact && (
        <header className="tracking-history__header">
          <div><span><Icon name="mapPin" size={22} /></span><div><h2>تتبّع الطرد</h2><p>كل تحديث على رحلة الطرد يظهر هنا بالوقت والتفاصيل.</p></div></div>
          <StatusPill status={order.status} />
        </header>
      )}
      <div className="tracking-history__rail">
        {events.map((event, index) => {
          const status = getStatus(event.status);
          const current = index === 0;
          return (
            <article
              className={`tracking-history__event ${current ? "is-current" : ""}`}
              key={event.id}
              style={{ "--tracking-color": status.color, "--tracking-surface": status.surface } as CSSProperties}
            >
              <time dateTime={event.createdAt} dir="rtl">{trackingTimestamp(event.createdAt)}</time>
              <span className="tracking-history__marker" aria-hidden="true"><i /><i /><i /></span>
              <div className="tracking-history__card">
                <div className="tracking-history__facts">
                  <span><Icon name="mapPin" size={15} />{event.location}</span>
                  <span><Icon name={status.icon} size={15} />{event.title}</span>
                  <span><Icon name="user" size={15} />{event.actor}</span>
                </div>
                <div className="tracking-history__note">
                  {event.kind === "note" ? <small className="is-note"><Icon name="message" size={13} />ملاحظة مضافة</small> : current && <small><Icon name="check" size={13} />الحالة الحالية</small>}
                  <p>{event.note || "لا توجد ملاحظات"}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
