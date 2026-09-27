// Real production views/client receipt validation; transport is supplied by the browser test.
import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContext, type AppContextValue, type ConfirmOptions } from "../app/lib/app-context";
import { createSeedDatabase, type Database, type Order, type LinkedDevice } from "../app/lib/data";
import { requestLinkedDevices } from "../app/lib/linked-devices";
import { LinkedDevicesPage } from "../app/components/settings-pages";
import { ParcelFollowups } from "../app/components/followups";
import { Button, Modal } from "../app/components/ui";

const database = createSeedDatabase();
database.users = [{ id: "owner", role: "merchant", name: "مستخدم المعاينة" }, { id: "other", role: "merchant", name: "حساب المعاينة الآخر" }] as Database["users"];
database.orders = [{ id: "parcel-1", trackingNumber: "ALX-TEST-001", merchantId: "owner", recipientName: "مستلم تجريبي", deleted: false }] as Order[];

function Fixture() {
  const [account, setAccount] = useState("owner"), [screen, setScreen] = useState("devices");
  const [confirmation, setConfirmation] = useState<ConfirmOptions | null>(null), [error, setError] = useState("");
  async function deviceRequest(operation: Parameters<typeof requestLinkedDevices>[0]): Promise<LinkedDevice[] | null> {
    try { setError(""); return await requestLinkedDevices(operation, account); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "خطأ"); return null; }
  }
  const context = {
    database, user: database.users.find((user) => user.id === account), setView: () => {}, showToast: () => {},
    listLinkedDevices: () => deviceRequest({ action: "list" }),
    renameCurrentDevice: (label: string) => deviceRequest({ action: "rename", label }),
    revokeLinkedDevice: (deviceId: string) => deviceRequest({ action: "revoke", deviceId }),
    confirm: setConfirmation,
  } as unknown as AppContextValue;
  return <AppContext.Provider value={context}>
    <nav aria-label="أدوات المعاينة المحلية" style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 10 }}>
      <button data-testid="account-owner" onClick={() => { setAccount("owner"); setError(""); setConfirmation(null); }}>الحساب الأول</button>
      <button data-testid="account-other" onClick={() => { setAccount("other"); setError(""); setConfirmation(null); }}>الحساب الآخر</button>
      <button data-testid="show-devices" onClick={() => setScreen("devices")}>الأجهزة</button>
      <button data-testid="show-audio" onClick={() => setScreen("audio")}>متابعة بالصوت</button>
      <button data-testid="theme" onClick={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"}>المظهر</button>
    </nav>
    <p data-testid="transport-error">{error}</p>
    <main data-testid="feature-surface" dir="rtl">{screen === "devices" ? <LinkedDevicesPage /> : <div className="page-content"><h1>معاينة محلية للتسجيل داخل الموقع</h1><ParcelFollowups order={database.orders[0]} /></div>}</main>
    {confirmation && <Modal title={confirmation.title} onClose={() => setConfirmation(null)}><div style={{ padding: 20 }}><p>{confirmation.message}</p><Button onClick={async () => { if (await confirmation.onConfirm() !== false) setConfirmation(null); }}>{confirmation.confirmLabel}</Button></div></Modal>}
  </AppContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
