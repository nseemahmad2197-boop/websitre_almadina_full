import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContext, type AppContextValue } from "../app/lib/app-context";
import { DeletionRequestsAdminPage } from "../app/components/deletion-admin";
import { DeletionRequestPanel } from "../app/components/deletion-request";

function Fixture() {
  const [screen, setScreen] = useState("public"), [account, setAccount] = useState("admin-a");
  const context = { user: { id: account, role: "admin" }, setView: () => {}, submitDeletionOperation: async () => { throw new Error("No mutation is expected in this read-state test"); } } as unknown as AppContextValue;
  return <AppContext.Provider value={context}><nav><button onClick={() => setScreen("public")}>طلب المستخدم</button><button onClick={() => setScreen("admin")}>طلبات الإدارة</button><button onClick={() => setAccount("admin-b")}>تبديل المسؤول</button></nav><main dir="rtl">{screen === "public" ? <DeletionRequestPanel publicPage /> : <DeletionRequestsAdminPage />}</main></AppContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
