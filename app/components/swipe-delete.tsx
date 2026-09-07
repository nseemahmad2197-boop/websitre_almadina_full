"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Icon } from "./icon";
import { Button } from "./ui";
import { useApp } from "../lib/app-context";
import { canHideCollection, setCollectionHidden } from "../lib/collection-visibility";
import type { CollectionInvoice, Order } from "../lib/data";

const actionWidth = 88;

/** Physical left swipe in both RTL and LTR; vertical scrolling remains native. */
export function SwipeDelete({ children, enabled = true, label = "حذف", onDelete }: {
  children: ReactNode; enabled?: boolean; label?: string; onDelete: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointer: number; x: number; y: number; start: number; axis: "pending" | "x" | "y" } | null>(null);
  const suppressDragClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const open = offset <= -actionWidth / 2;

  useEffect(() => {
    const closeOthers = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOffset(0); };
    const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOffset(0); };
    document.addEventListener("almadina-swipe-open", closeOthers);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("almadina-swipe-open", closeOthers); document.removeEventListener("pointerdown", outside); };
  }, [id]);

  function reveal() { document.dispatchEvent(new CustomEvent("almadina-swipe-open", { detail: id })); setOffset(-actionWidth); }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    // A fresh press is intentional, even immediately after a completed swipe.
    suppressDragClick.current = false;
    if ((event.target as HTMLElement).closest("input,textarea,select,a,[data-no-swipe]")) return;
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: offset, axis: "pending" };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId || current.axis === "y") return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (current.axis === "pending") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return;
      if (Math.abs(dy) >= Math.abs(dx)) { current.axis = "y"; return; }
      current.axis = "x";
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      document.dispatchEvent(new CustomEvent("almadina-swipe-open", { detail: id }));
    }
    event.preventDefault();
    setOffset(Math.max(-actionWidth, Math.min(0, current.start + dx)));
  }
  function end(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.axis === "x") {
      suppressDragClick.current = true;
      const finalOffset = current.start + event.clientX - current.x;
      setOffset(cancelled ? current.start : finalOffset < -actionWidth / 2 ? -actionWidth : 0);
    }
    gesture.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (!enabled) return <>{children}</>;
  return <div ref={root} className={`swipe-row${dragging ? " is-dragging" : ""}${open ? " is-open" : ""}`} role="group" aria-label="اسحب لليسار لإظهار الحذف" style={{ "--swipe-offset": `${offset}px` } as CSSProperties}
    onKeyDown={(event) => { if (event.key === "Escape") setOffset(0); }}>
    <button type="button" data-no-swipe className="swipe-row__delete" tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={label} onClick={() => { setOffset(0); onDelete(); }}><Icon name="trash" size={22} /><span>حذف</span></button>
    <div className="swipe-row__content" onPointerDown={down} onPointerMove={move} onPointerUp={(event) => end(event)} onPointerCancel={(event) => end(event, true)} onLostPointerCapture={(event) => end(event, true)}
      onClickCapture={(event) => {
        // Browsers can emit click after pointerup, even after a captured drag.
        // Consume that click without undoing the settled open/closed position.
        if (suppressDragClick.current && event.detail > 0) {
          suppressDragClick.current = false;
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (open) { event.preventDefault(); event.stopPropagation(); setOffset(0); }
      }}>
      {children}
    </div>
    <button type="button" data-no-swipe className="swipe-row__keyboard" aria-label={`إظهار ${label}`} onClick={reveal}>إظهار الحذف</button>
  </div>;
}

export function DeleteParcelRow({ order, children }: { order: Order; children: ReactNode }) {
  const { user, updateDatabase, confirm } = useApp();
  const allowed = !order.deleted && !!user && (user.role === "admin" || (user.role === "merchant" && order.merchantId === user.id));
  return <SwipeDelete enabled={allowed} label={`حذف الطرد ${order.trackingNumber || order.recipientName}`} onDelete={() => confirm({
    title: "حذف الطرد؟", message: "سيُنقل الطرد إلى المحذوفات ويمكن استعادته خلال 30 يومًا.", confirmLabel: "نقل إلى المحذوفات", danger: true,
    onConfirm: () => updateDatabase((current) => {
      const actor = current.users.find((entry) => entry.id === user?.id);
      const now = new Date().toISOString();
      return { ...current, orders: current.orders.map((item) => item.id === order.id && !item.deleted && (actor?.role === "admin" || (actor?.role === "merchant" && item.merchantId === actor.id)) ? { ...item, deleted: true, deletedAt: now, updatedAt: now } : item) };
    }),
  })}>{children}</SwipeDelete>;
}

export function DeleteInvoiceRow({ invoice, children }: { invoice: CollectionInvoice; children: ReactNode }) {
  const { user, updateDatabase, confirm } = useApp();
  const allowed = canHideCollection(user, invoice);
  const requestRemoval = () => confirm({
    title: "إزالة الفاتورة من قائمتك؟", message: "ستُنقل الفاتورة إلى المحذوفات ويمكن استعادتها. يبقى سجل التسوية محفوظًا ولا تتغير مبالغ التحصيل.", confirmLabel: "نقل إلى المحذوفات", danger: true,
    onConfirm: () => { if (user) updateDatabase((current) => setCollectionHidden(current, user.id, invoice.id, true)); },
  });
  if (!allowed) return <>{children}</>;
  return <div className="invoice-row">
    <SwipeDelete label={`حذف الفاتورة ${invoice.invoiceNumber}`} onDelete={requestRemoval}>{children}</SwipeDelete>
    <div className="invoice-row__actions">
      <Button type="button" variant="danger" icon="trash" aria-label={`إزالة الفاتورة ${invoice.invoiceNumber}`} onClick={requestRemoval}>إزالة الفاتورة</Button>
    </div>
  </div>;
}
