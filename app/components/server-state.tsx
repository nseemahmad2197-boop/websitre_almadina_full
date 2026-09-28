"use client";

import { useEffect, useState } from "react";
import { Brand, Button, IconButton } from "./ui";
import { Icon } from "./icon";

import { LoadingSkeleton, readBootstrapKind, type SkeletonKind } from "./loading-skeleton";
export { LoadingSkeleton } from "./loading-skeleton";

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
  const [kind, setKind] = useState<SkeletonKind>("dashboard");
  useEffect(() => { setKind(readBootstrapKind()); }, []);
  return <main className={`application server-bootstrap ${["followup-detail", "staff-followup-detail"].includes(kind) ? "server-bootstrap--followup" : ""}`} dir="rtl">
    {!["settings", "profile"].includes(kind) && <header className="topbar"><div className="topbar__inner"><IconButton name="menu" label="القائمة — بعد تحميل الحساب" disabled /><div className="topbar__brand"><Brand compact /></div><div className="topbar__actions"><IconButton name="camera" label="مسح الطرد — بعد تحميل الحساب" disabled /><IconButton name="bell" label="الإشعارات — بعد تحميل الحساب" disabled /></div></div></header>}
    <div className={`page-content ${kind === "dashboard" ? "dashboard-page" : kind.startsWith("admin") ? "admin-page" : kind === "employee" ? "employee-dashboard" : ""}`}>{error ? <RequestFailure message={error} onRetry={onRetry} /> : <LoadingSkeleton kind={kind} page label="جارٍ تحميل الصفحة…" />}</div>
  </main>;
}
