import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationShell } from "../app/components/application-shell";
import { AppContext, type AppContextValue, type View } from "../app/lib/app-context";
import { createSeedDatabase, type Database, type User } from "../app/lib/data";

const account: User = {
  id: "drawer-admin", name: "مسؤول المدينة", role: "admin", store: "الإدارة",
  email: "drawer@fixture.test", phone: "0591234567", password: "", joinedAt: "2026-09-27T09:00:00Z", avatarColor: "#087c45",
};
const initialDatabase: Database = {
  ...createSeedDatabase(), users: [account], orders: [], collections: [], recipients: [],
  notices: Array.from({ length: 36 }, (_, index) => ({
    id: `notice-${index}`, userId: account.id, title: `تحديث الطرد رقم ${index + 1}`,
    message: "يمكن متابعة حركة الطرد وتفاصيل التوصيل من صفحة الطرود.", icon: "bell", read: true, createdAt: "2026-09-27T09:00:00Z",
  })),
};

function Fixture() {
  const [database, updateDatabase] = useState(initialDatabase);
  const [view, setCurrentView] = useState<View>("notifications");
  const setView = (next: View) => {
    setCurrentView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [mounted, setMounted] = useState(true);
  const [role, setRole] = useState<User["role"]>("admin");
  useEffect(() => {
    const control = (event: Event) => {
      const detail = (event as CustomEvent<{ mounted?: boolean; view?: View; role?: User["role"] }>).detail;
      if (detail.mounted !== undefined) setMounted(detail.mounted);
      if (detail.view) setCurrentView(detail.view);
      if (detail.role) setRole(detail.role);
    };
    window.addEventListener("drawer-fixture", control);
    return () => window.removeEventListener("drawer-fixture", control);
  }, []);
  const context = {
    database, updateDatabase, user: { ...account, role }, view, setView, preferences: {}, selectedOrderId: null,
    setSelectedOrderId: () => {}, showToast: () => {}, openScanner: () => {},
    logout: async () => true, confirm: () => {}, openAccountSwitcher: () => {},
    clearNotices: async () => 0, phoneNotifications: {}, appLock: {},
  } as unknown as AppContextValue;
  return <AppContext.Provider value={context}>
    {mounted ? <ApplicationShell /> : <div style={{ minHeight: 7000 }} data-testid="unmounted-shell">تم إغلاق الواجهة</div>}
  </AppContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
