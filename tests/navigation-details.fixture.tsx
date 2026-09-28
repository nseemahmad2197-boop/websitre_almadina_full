import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContext, type AppContextValue, type View } from "../app/lib/app-context";
import { EMPTY_NAVIGATION_DETAILS, type NavigationDetails } from "../app/lib/navigation-state";
import { createSeedDatabase, defaultPreferences, type CollectionInvoice, type Database, type Order, type User } from "../app/lib/data";
import { CustomerFollowupsPage } from "../app/components/staff-followups";
import { FollowupsPage } from "../app/components/followups";
import { CollectionsPage } from "../app/components/management-pages";
import { AdminDashboard } from "../app/components/admin";

const timestamp = "2026-09-28T12:00:00.000Z";
const account = (id: string, role: User["role"]): User => ({ id, role, name: id, store: `متجر ${id}`, email: `${id}@fixture.test`, phone: "0591234567", password: "", joinedAt: timestamp, avatarColor: "#087c45" });
const users = [account("merchant-a", "merchant"), account("merchant-b", "merchant"), account("admin", "admin"), account("courier", "courier")];
const parcel = (merchant: User): Order => ({ id: `parcel-${merchant.id}`, merchantId: merchant.id, merchantName: merchant.name, merchantStore: merchant.store, trackingNumber: `ALX-${merchant.id}`, recipientName: "مستلم", recipientPhone: "0591234567", city: "نابلس", governorate: "نابلس", address: "المدينة", pickupAddress: "المدينة", amount: 100, deliveryFee: 20, content: "ملابس", weight: "0 - 5 كغم", dimensions: "20 × 20 × 20 سم", notes: "", privateNotes: "", reference: "", type: "طرد عادي", status: "delivered", courierName: "المندوب", createdAt: timestamp, updatedAt: timestamp, deleted: false });
const invoice = (merchant: User, id: string): CollectionInvoice => ({ id, merchantId: merchant.id, merchantName: merchant.name, invoiceNumber: `#${id}`, orderIds: [`parcel-${merchant.id}`], grossAmount: 100, deliveryFees: 20, returnFees: 0, netAmount: 80, deliveredCount: 1, returnedCount: 0, status: "paid", verificationCode: "9324", authorizedRecipient: "", createdAt: timestamp, updatedAt: timestamp, scheduledAt: timestamp });
type FixtureLocation = { accountId: string; view: View; details: NavigationDetails };
const storageKey = "navigation-detail-fixture";
function initial(): FixtureLocation {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
  return saved ?? { accountId: "merchant-a", view: "followups", details: { ...EMPTY_NAVIGATION_DETAILS } };
}
function Fixture() {
  const [location, setLocation] = useState(initial);
  const user = users.find((entry) => entry.id === location.accountId)!;
  function update(patch: Partial<FixtureLocation>) { setLocation((current) => { const next = { ...current, ...patch }; sessionStorage.setItem(storageKey, JSON.stringify(next)); return next; }); }
  const database: Database = { ...createSeedDatabase(), users: user.role === "admin" ? users : [user], orders: users.slice(0, 2).filter((entry) => user.role !== "merchant" || entry.id === user.id).map(parcel), collections: [invoice(users[0], "invoice-a"), invoice(users[0], "invoice-hidden"), invoice(users[1], "invoice-b")], preferences: { [user.id]: { ...defaultPreferences, hiddenCollectionIds: ["invoice-hidden"] } }, notices: [], recipients: [] };
  const context = {
    user, database, view: location.view, preferences: defaultPreferences,
    navigationDetails: location.details,
    updateNavigationDetails: (patch: Partial<NavigationDetails>) => update({ details: { ...location.details, ...patch } }),
    setView: (view: View) => update({ view, details: { ...EMPTY_NAVIGATION_DETAILS } }),
    selectedOrderId: null, setSelectedOrderId: () => {}, showToast: () => {}, updateDatabase: () => {}, notify: () => {}, confirm: () => {}, prepareCollectionInvoice: async () => false, verifyCollectionCode: async () => false,
  } as unknown as AppContextValue;
  return <AppContext.Provider value={context}>
    <nav aria-label="أدوات الاختبار">{users.map((entry) => <button key={entry.id} data-testid={`account-${entry.id}`} onClick={() => update({ accountId: entry.id, view: entry.role === "merchant" ? "followups" : "customer-followups", details: { ...EMPTY_NAVIGATION_DETAILS } })}>{entry.id}</button>)}
      <button data-testid="invalidate-followup" onClick={() => update({ details: { ...location.details, followupId: null, followupOrderId: null } })}>إلغاء تحديد المتابعة</button>
      {(["followups", "customer-followups", "collections", "admin"] as View[]).map((view) => <button key={view} data-testid={`view-${view}`} onClick={() => update({ view, details: { ...EMPTY_NAVIGATION_DETAILS } })}>{view}</button>)}
    </nav>
    <main key={user.id} dir="rtl">{location.view === "customer-followups" ? <CustomerFollowupsPage /> : location.view === "collections" ? <CollectionsPage /> : location.view === "admin" ? <AdminDashboard /> : <FollowupsPage />}</main>
  </AppContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
