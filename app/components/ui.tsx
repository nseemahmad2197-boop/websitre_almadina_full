"use client";

import { useEffect, useRef, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icon";
import { getStatus, type OrderStatus } from "../lib/data";

export function Brand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""} ${inverse ? "brand--inverse" : ""}`}>
      <div className="brand__mark"><Icon name="truck" size={compact ? 23 : 34} /></div>
      <div className="brand__words">
        <strong>المدينة إكسبرس</strong>
        <span>ALMADINA EXPRESS</span>
      </div>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: IconName;
  label?: string;
  suffix?: ReactNode;
  hint?: ReactNode;
  wrapperClassName?: string;
};

export function Field({ icon, label, suffix, hint, wrapperClassName = "", className, ...props }: FieldProps) {
  return (
    <label className={`field ${wrapperClassName}`}>
      {label && <span className="field__label">{label}</span>}
      <span className={`field__control ${className ?? ""}`}>
        {icon && <Icon name={icon} size={20} className="field__icon" />}
        <input {...props} />
        {suffix}
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label && <span className="field__label">{label}</span>}
      <span className="field__control field__control--select">
        <select {...props}>{children}</select>
        <Icon name="chevronDown" size={18} />
      </span>
    </label>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  full?: boolean;
  loading?: boolean;
};

export function Button({ icon, children, variant = "primary", full, loading, className = "", disabled, ...props }: ButtonProps) {
  return (
    <button className={`button button--${variant} ${full ? "button--full" : ""} ${className}`} disabled={disabled || loading} {...props}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={19} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ name, label, badge, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { name: IconName; label: string; badge?: number | boolean }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      <Icon name={name} size={21} />
      {badge ? <span className="icon-button__badge">{typeof badge === "number" ? badge : ""}</span> : null}
    </button>
  );
}

export function PageHeader({ title, subtitle, onBack, action }: { title: string; subtitle?: string; onBack?: () => void; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__main">
        {onBack && <IconButton name="chevronLeft" label="رجوع" className="page-header__back" onClick={onBack} />}
        <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ icon, title, description, action, onAction }: { icon: IconName; title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Icon name={icon} size={44} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <Button onClick={onAction}>{action}</Button>}
    </div>
  );
}

export function StatusPill({ status }: { status: OrderStatus }) {
  const entry = getStatus(status);
  return (
    <span className="status-pill" style={{ "--status-color": entry.color, "--status-bg": entry.surface } as CSSProperties}>
      <Icon name={entry.icon} size={14} />{entry.label}
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? "toggle--on" : ""}`} onClick={() => onChange(!checked)}><span /></button>;
}

export function Segmented({ items, value, onChange, className = "" }: { items: { value: string; label: string; count?: number }[]; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <div className={`segmented ${className}`} role="tablist">
      {items.map((item) => <button key={item.value} role="tab" aria-selected={value === item.value} className={value === item.value ? "segmented__active" : ""} onClick={() => onChange(item.value)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}
    </div>
  );
}

export function SectionCard({ title, subtitle, icon, action, children, className = "" }: { title?: string; subtitle?: string; icon?: IconName; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section-card ${className}`}>
      {title && <header className="section-card__header"><div>{icon && <Icon name={icon} size={18} />}<div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>{action}</header>}
      {children}
    </section>
  );
}

export function Modal({ children, onClose, title, ariaLabel, className = "", sheet = false, closeDisabled = false }: { children: ReactNode; onClose: () => void; title?: string; ariaLabel?: string; className?: string; sheet?: boolean; closeDisabled?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const isTopmost = () => {
      const backdrops = Array.from(document.querySelectorAll<HTMLElement>(".modal-backdrop"));
      return backdrops.at(-1)?.contains(dialog) ?? false;
    };
    const focusTimer = window.setTimeout(() => {
      if (dialog.contains(document.activeElement)) return;
      const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector);
      if (firstFocusable) firstFocusable.focus();
      else dialog.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return;
      if (event.key === "Escape") {
        if (closeDisabledRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (!closeDisabled && event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className={`modal ${sheet ? "modal--sheet" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}>
        {title && <header className="modal__header"><h2>{title}</h2><IconButton name="close" label="إغلاق" onClick={onClose} disabled={closeDisabled} /></header>}
        {children}
      </section>
    </div>,
    document.body,
  );
}

export function Avatar({ name, color, large = false }: { name: string; color: string; large?: boolean }) {
  return <span className={`avatar ${large ? "avatar--large" : ""}`} style={{ "--avatar-color": color } as CSSProperties}>{name.trim().charAt(0).toUpperCase()}</span>;
}
