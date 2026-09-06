import { defaultPreferences, type Database, type User, type CollectionInvoice } from "./data.ts";

export function hiddenCollectionIds(database: Database, userId: string): Set<string> {
  const ids = database.preferences[userId]?.hiddenCollectionIds;
  const requested = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
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

/** Authoritative cleanup also protects clients which do not enforce the UI rule. */
export function normalizeCollectionVisibility(database: Database): Database {
  const invoices = new Map(database.collections.map((invoice) => [invoice.id, invoice]));
  const users = new Map(database.users.map((user) => [user.id, user]));
  return { ...database, preferences: Object.fromEntries(Object.entries(database.preferences).map(([userId, preference]) => {
    if (!Object.prototype.hasOwnProperty.call(preference, "hiddenCollectionIds")) return [userId, preference];
    const ids = Array.isArray(preference.hiddenCollectionIds) ? preference.hiddenCollectionIds : [];
    const valid = ids.filter((id) => {
      const invoice = invoices.get(id);
      return invoice && canHideCollection(users.get(userId) ?? null, invoice);
    });
    return [userId, { ...preference, hiddenCollectionIds: [...new Set(valid)].sort() }];
  })) };
}

/** Keep the invoice in the settlement ledger, changing only this account's list. */
export function setCollectionHidden(database: Database, userId: string, invoiceId: string, hidden: boolean): Database {
  const user = database.users.find((entry) => entry.id === userId) ?? null;
  const invoice = database.collections.find((entry) => entry.id === invoiceId);
  if (!invoice || !canManageCollectionVisibility(user, invoice) || (hidden && !canHideCollection(user, invoice))) return database;
  const ids = hiddenCollectionIds(database, userId);
  if (hidden) ids.add(invoiceId); else ids.delete(invoiceId);
  return { ...database, preferences: { ...database.preferences, [userId]: {
    ...defaultPreferences, ...database.preferences[userId], hiddenCollectionIds: [...ids].sort(),
  } } };
}
