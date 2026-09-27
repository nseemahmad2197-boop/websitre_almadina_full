import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContext, type AppContextValue, type View } from "../app/lib/app-context";
import { createSeedDatabase, type Database, type Order, type User } from "../app/lib/data";
import { CustomerFollowupsPage } from "../app/components/staff-followups";
import { OrderDetail, Shipments } from "../app/components/dashboard";
import { EmployeeDashboard } from "../app/components/employee";

const time = "2026-09-27T09:00:00.000Z";
const account = (id: string, name: string, role: User["role"], store: string): User => ({
  id, name, role, store, email: `${id}@fixture.test`, phone: "0591234567", password: "", joinedAt: time, avatarColor: "#087c45",
});
const users = [account("staff-admin", "مسؤول المتابعة", "admin", "الإدارة"), account("staff-courier", "موظف المتابعة", "courier", "التوصيل"), account("customer-a", "أحمد الخطيب", "merchant", "متجر الياسمين"), account("customer-b", "سارة النجار", "merchant", "مكتبة المدينة")];
const parcel = (id: string, merchant: User, trackingNumber: string, courierId?: string, deleted = false): Order => ({
  id, merchantId: merchant.id, merchantName: merchant.name, merchantStore: merchant.store, trackingNumber,
  recipientName: id === "parcel-b" ? "مستلم مكتبة المدينة" : "مستلم متجر الياسمين", recipientPhone: "0591234567", city: "نابلس", governorate: "نابلس",
  address: "شارع الجامعة", pickupAddress: "مركز المدينة", amount: 150, deliveryFee: 25, content: "مستلزمات منزلية",
  weight: "0 - 5 كغم", dimensions: "20 × 20 × 20 سم", notes: "يرجى الاتصال قبل الوصول", privateNotes: "", reference: "", type: "طرد عادي",
  status: "ready", courierName: courierId ? "المندوب" : "بانتظار تعيين المندوب", courierId, createdAt: time, updatedAt: time, deleted,
});
const allOrders = [parcel("parcel-a", users[2], "ALX-20260101", "staff-courier"), parcel("parcel-a-other", users[2], "ALX-20260102", "different-courier"), parcel("parcel-b", users[3], "ALX-20260103"), parcel("parcel-deleted", users[2], "ALX-20260104", undefined, true)];

function Fixture() {
  const [userId, setUserId] = useState("staff-admin");
  const [view, setView] = useState<View>("customer-followups");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const user = users.find((entry) => entry.id === userId)!;
  const database: Database = { ...createSeedDatabase(), users: user.role === "admin" ? users : [user], orders: user.role === "merchant" ? allOrders.filter((order) => order.merchantId === user.id) : allOrders.filter((order) => user.role === "admin" || !order.deleted), collections: [], notices: [], recipients: [] };
  const context = {
    database, user, view, selectedOrderId, setSelectedOrderId, setView, preferences: {},
    showToast: () => {}, updateDatabase: () => {}, confirm: () => {}, openScanner: () => {},
    prepareCollectionInvoice: async () => false, verifyCollectionCode: async () => false,
  } as unknown as AppContextValue;
  return <AppContext.Provider value={context}>
    <nav aria-label="أدوات المعاينة المحلية" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 10 }}>
      <button data-testid="account-admin" onClick={() => setUserId("staff-admin")}>حساب الإدارة</button>
      <button data-testid="account-courier" onClick={() => setUserId("staff-courier")}>حساب الموظف</button>
      <button data-testid="account-merchant" onClick={() => setUserId("customer-a")}>حساب المستخدم</button>
      <button data-testid="open-directory" onClick={() => setView("customer-followups")}>دليل المتابعة</button>
      <button data-testid="open-home" onClick={() => setView("home")}>لوحة الموظف</button>
      <button data-testid="open-shipments" onClick={() => setView("shipments")}>قائمة الطرود</button>
    </nav>
    <main data-testid="feature-surface" dir="rtl">
      {view === "order-detail" ? <OrderDetail /> : view === "shipments" ? <Shipments /> : view === "home" ? <EmployeeDashboard /> : <CustomerFollowupsPage />}
    </main>
  </AppContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
