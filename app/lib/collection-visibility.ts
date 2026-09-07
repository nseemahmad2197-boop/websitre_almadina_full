import { defaultPreferences, type Database, type User, type CollectionInvoice, type Order } from "./data.ts";

export function hiddenCollectionIds(database: Database, userId: string): Set<string> {
  const ids = database.preferences[userId]?.hiddenCollectionIds;
  const requested = new Set([...(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []), ...purgedCollectionIds(database, userId)]);
  const user = database.users.find((entry) => entry.id === userId) ?? null;
  // Older clients may have hidden an outstanding invoice. It must be visible again.
  return new Set(database.collections.filter((invoice) => requested.has(invoice.id) && canHideCollection(user, invoice)).map((invoice) => invoice.id));
}

export function canManageCollectionVisibility(user: User | null, invoice: CollectionInvoice): boolean {
  return !!user && (user.role === "admin" || (user.role === "merchant" && invoice.merchantId === user.id));
}

export function canHideCollection(user: User | null, invoice: CollectionInvoice): boolean {
  return invoice.status === "paid" && canManageCollectionVisibility(user, invoice);
}

export function purgedCollectionIds(database: Database, userId: string): Set<string> {
  const ids = database.preferences[userId]?.purgedCollectionIds;
  const requested = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  const user = database.users.find((entry) => entry.id === userId) ?? null;
  return new Set(database.collections.filter((invoice) => requested.has(invoice.id) && canHideCollection(user, invoice)).map((invoice) => invoice.id));
}

export function canPurgeOrder(database: Database, user: User | null, order: Order): boolean {
  return !!user && order.deleted === true && (user.role === "admin" || (user.role === "merchant" && order.merchantId === user.id))
    && !database.collections.some((invoice) => invoice.status !== "paid" && invoice.orderIds.includes(order.id));
}

/** Validate the whole selection before changing anything. Called on the server. */
export function purgeSelectedTrash(database: Database, userId: string, orderIds: string[], invoiceIds: string[]): Database {
  const user = database.users.find((entry) => entry.id === userId) ?? null;
  if (!user || (user.role !== "merchant" && user.role !== "admin")) throw new Error("لا تملك صلاحية الحذف من سلة المحذوفات.");
  const orders = new Map(database.orders.map((order) => [order.id, order]));
  const invoices = new Map(database.collections.map((invoice) => [invoice.id, invoice]));
  const hidden = hiddenCollectionIds(database, userId);
  const purged = purgedCollectionIds(database, userId);
  for (const id of orderIds) {
    const order = orders.get(id);
    if (!order || !canPurgeOrder(database, user, order)) throw new Error("تعذّر حذف المحدد: اختر طرودًا من محذوفاتك غير مرتبطة بفاتورة مستحقة.");
  }
  for (const id of invoiceIds) {
    const invoice = invoices.get(id);
    if (!invoice || !canHideCollection(user, invoice) || !hidden.has(id) || purged.has(id)) throw new Error("تعذّر حذف المحدد: يجب أن تكون الفاتورة مسدّدة وموجودة في سلة محذوفاتك.");
  }
  const selected = new Set(orderIds);
  for (const id of invoiceIds) purged.add(id);
  return { ...database, orders: database.orders.filter((order) => !selected.has(order.id)), preferences: { ...database.preferences, [userId]: {
    ...defaultPreferences, ...database.preferences[userId],
    hiddenCollectionIds: [...hidden].sort(), purgedCollectionIds: [...purged].sort(),
  } } };
}

/** Old clients may omit this property. Only the dedicated purge route can add it. */
export function preservePurgedCollections(current: Database, proposed: Database): Database {
  const preferences = { ...proposed.preferences };
  for (const user of proposed.users) {
    const previous = current.preferences[user.id]?.purgedCollectionIds;
    const own = preferences[user.id];
    if (previous?.length || own?.purgedCollectionIds !== undefined) {
      const next = { ...defaultPreferences, ...own };
      if (previous) next.purgedCollectionIds = previous; else delete next.purgedCollectionIds;
      preferences[user.id] = next;
    }
  }
  return { ...proposed, preferences };
}

/** Authoritative cleanup also protects clients which do not enforce the UI rule. */
export function normalizeCollectionVisibility(database: Database): Database {
  const invoices = new Map(database.collections.map((invoice) => [invoice.id, invoice]));
  const users = new Map(database.users.map((user) => [user.id, user]));
  return { ...database, preferences: Object.fromEntries(Object.entries(database.preferences).map(([userId, preference]) => {
    if (!Object.prototype.hasOwnProperty.call(preference, "hiddenCollectionIds") && !Object.prototype.hasOwnProperty.call(preference, "purgedCollectionIds")) return [userId, preference];
    const ids = Array.isArray(preference.hiddenCollectionIds) ? preference.hiddenCollectionIds : [];
    const purged = [...new Set((Array.isArray(preference.purgedCollectionIds) ? preference.purgedCollectionIds : []).filter((id) => {
      const invoice = invoices.get(id);
      return invoice && canHideCollection(users.get(userId) ?? null, invoice);
    }))].sort();
    const valid = [...ids, ...purged].filter((id) => {
      const invoice = invoices.get(id);
      return invoice && canHideCollection(users.get(userId) ?? null, invoice);
    });
    return [userId, { ...preference, hiddenCollectionIds: [...new Set(valid)].sort(), ...(preference.purgedCollectionIds !== undefined ? { purgedCollectionIds: purged } : {}) }];
  })) };
}

/** Keep the invoice in the settlement ledger, changing only this account's list. */
export function setCollectionHidden(database: Database, userId: string, invoiceId: string, hidden: boolean): Database {
  const user = database.users.find((entry) => entry.id === userId) ?? null;
  const invoice = database.collections.find((entry) => entry.id === invoiceId);
  if (!invoice || !canManageCollectionVisibility(user, invoice) || (hidden && !canHideCollection(user, invoice)) || purgedCollectionIds(database, userId).has(invoiceId)) return database;
  const ids = hiddenCollectionIds(database, userId);
  if (hidden) ids.add(invoiceId); else ids.delete(invoiceId);
  return { ...database, preferences: { ...database.preferences, [userId]: {
    ...defaultPreferences, ...database.preferences[userId], hiddenCollectionIds: [...ids].sort(),
  } } };
}
