"use client";

import { useEffect, useState } from "react";
import { Brand, Button, IconButton } from "./ui";
import { Icon } from "./icon";
import { statusDefinitions } from "../lib/data";

type SkeletonKind = "dashboard" | "list" | "devices" | "conversation" | "detail" | "customers";
const Shape = ({ className = "" }: { className?: string }) => <span className={`loading-shape ${className}`} />;
function SkeletonRow({ kind }: { kind: SkeletonKind }) {
  return <div className={`loading-row loading-row--${kind}`}><Shape className="loading-avatar" /><div className="loading-lines"><Shape className="loading-line loading-line--title" /><Shape className="loading-line" /><Shape className="loading-line loading-line--short" /></div>{kind !== "conversation" && <Shape className="loading-badge" />}</div>;
}

/** Only mount while a real read is pending; never gives placeholder counts or names. */
export function LoadingSkeleton({ kind = "list", label = "جارٍ تحميل البيانات…", rows = 3 }: { kind?: SkeletonKind; label?: string; rows?: number }) {
  return <section className={`loading-skeleton loading-skeleton--${kind}`} role="status" aria-live="polite" aria-busy="true" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">
      {kind === "dashboard" ? <>
        <div className="loading-greeting"><Shape className="loading-line loading-line--short" /><Shape className="loading-line loading-line--heading" /></div>
        <div className="loading-hero"><Shape className="loading-line loading-line--short" /><Shape className="loading-line loading-line--amount" /><div className="loading-stats">{[0, 1].map(index => <div key={index}><Shape className="loading-avatar" /><Shape className="loading-line loading-line--short" /><Shape className="loading-line" /></div>)}</div><Shape className="loading-line" /></div>
        <div className="loading-section-title"><Shape className="loading-line loading-line--title" /></div>
        <div className="loading-status-grid">{statusDefinitions.map(status => <div className="loading-status-card" key={status.id}><Shape className="loading-avatar" /><Shape className="loading-line loading-line--short" /><Shape className="loading-line" /></div>)}</div>
        <div className="loading-section-title"><Shape className="loading-line loading-line--title" /></div>
      </> : kind === "detail" ? <div className="loading-hero"><Shape className="loading-line loading-line--heading" /><Shape className="loading-line" /><Shape className="loading-line loading-line--short" /><Shape className="loading-media" /></div> : null}
      <div className="loading-rows">{Array.from({ length: rows }, (_, index) => <SkeletonRow key={index} kind={kind} />)}</div>
    </div>
  </section>;
}

export function RefreshStatus({ label = "جارٍ تحديث البيانات…" }: { label?: string }) {
  return <p className="server-refresh" role="status" aria-live="polite"><span className="server-refresh__dot" aria-hidden="true" />{label}</p>;
}

export function useOffline() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update(); window.addEventListener("offline", update); window.addEventListener("online", update);
    return () => { window.removeEventListener("offline", update); window.removeEventListener("online", update); };
  }, []);
  return offline;
}

export function OfflineState({ onRetry, busy = false, compact = false }: { onRetry?: () => void; busy?: boolean; compact?: boolean }) {
  return <section className={`offline-state ${compact ? "offline-state--compact" : ""}`} role="status" aria-live="polite" dir="rtl">
    <span className="offline-state__symbol" aria-hidden="true"><Icon name="refresh" size={32} /></span>
    <div><h3>لا يوجد اتصال بالإنترنت</h3><p>تحقق من اتصالك ثم أعد المحاولة. ستبقى البيانات المعروضة والنص المكتوب أثناء بقاء الصفحة مفتوحة.</p></div>
    {onRetry && <Button variant="outline" loading={busy} disabled={busy} onClick={onRetry}>إعادة المحاولة</Button>}
  </section>;
}

export function RequestFailure({ message, onRetry, busy = false, compact = false }: { message: string; onRetry?: () => void; busy?: boolean; compact?: boolean }) {
  if (message.startsWith("لا يوجد اتصال بالإنترنت")) return <OfflineState onRetry={onRetry} busy={busy} compact={compact} />;
  return <section className={`server-failure ${compact ? "server-failure--compact" : ""}`} role="alert"><Icon name="alert" size={compact ? 18 : 26} /><div><p>{message}</p></div>{onRetry && <Button variant="outline" icon="refresh" disabled={busy} onClick={onRetry}>{busy ? "جارٍ إعادة المحاولة…" : "إعادة المحاولة"}</Button>}</section>;
}

export function BootstrapScreen({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return <main className="application server-bootstrap" dir="rtl">
    <header className="topbar"><div className="topbar__inner"><IconButton name="menu" label="القائمة — بعد تحميل الحساب" disabled /><div className="topbar__brand"><Brand compact /></div><div className="topbar__actions"><IconButton name="camera" label="مسح الطرد — بعد تحميل الحساب" disabled /><IconButton name="bell" label="الإشعارات — بعد تحميل الحساب" disabled /></div></div></header>
    <div className="page-content dashboard-page">{error ? <RequestFailure message={error} onRetry={onRetry} /> : <LoadingSkeleton kind="dashboard" label="جارٍ تحميل حسابك وبيانات الطرود…" />}</div>
  </main>;
}
