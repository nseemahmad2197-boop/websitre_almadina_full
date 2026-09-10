import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContext, type AppContextValue, type ConfirmOptions } from "../app/lib/app-context";
import { createSeedDatabase, type Database, type Order, type CollectionInvoice } from "../app/lib/data";
import { hiddenCollectionIds } from "../app/lib/collection-visibility";
import { DeleteParcelRow, DeleteInvoiceRow } from "../app/components/swipe-delete";

// Isolated, local test data. This fixture never contacts the live API.
const seed = createSeedDatabase();
seed.users = [{ id: "owner", role: "merchant" }, { id: "courier", role: "courier" }] as Database["users"];
seed.orders = [{ id: "o1", merchantId: "owner", recipientName: "طرد الاختبار", trackingNumber: "", deleted: false }] as Order[];
seed.collections = [{ id: "i1", merchantId: "owner", invoiceNumber: "#TEST", status: "paid", netAmount: 85 }] as CollectionInvoice[];
function Fixture() {
  const [database, setDatabase] = useState(seed);
  const [role, setRole] = useState("owner");
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [opened, setOpened] = useState(0);
  const user = database.users.find((item) => item.id === role)!;
  const context = { database, user, updateDatabase: setDatabase, confirm: setDialog } as unknown as AppContextValue;
  return <AppContext.Provider value={context}>
    <main style={{ padding: 20 }} dir="rtl">
      <h1>اختبار السحب محليًا</h1>
      <button id="courier" onClick={() => setRole("courier")}>مندوب</button>
      <button id="owner" onClick={() => setRole("owner")}>تاجر</button>
      <output id="opened">{opened}</output>
      <div style={{ display: "grid", gap: 24, marginTop: 20 }}>
        {database.orders.filter((order) => !order.deleted).map((order) => <DeleteParcelRow key={order.id} order={order}><button id="parcel" className="order-card" style={{ minHeight: 130 }} onClick={() => setOpened((n) => n + 1)}>طرد الاختبار</button></DeleteParcelRow>)}
        {database.collections.filter((invoice) => !hiddenCollectionIds(database, user.id).has(invoice.id)).map((invoice) => <DeleteInvoiceRow key={invoice.id} invoice={invoice}><button id="invoice" className="collection-card" style={{ minHeight: 130 }} onClick={() => setOpened((n) => n + 1)}>فاتورة الاختبار</button></DeleteInvoiceRow>)}
      </div>
      {dialog && <div role="dialog" style={{ position: "fixed", inset: "30% 20px auto", background: "white", color: "black", zIndex: 10, padding: 20, border: "2px solid" }}>
        <p>{dialog.message}</p><button id="confirm" onClick={() => { void dialog.onConfirm(); setDialog(null); }}>تأكيد الحذف</button><button id="cancel" onClick={() => setDialog(null)}>إلغاء</button>
      </div>}
      <pre id="state" style={{ marginTop: 1000 }}>{JSON.stringify(database)}</pre>
    </main>
  </AppContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
