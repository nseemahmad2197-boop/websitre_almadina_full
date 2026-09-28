import type { View } from "./app-context";
import type { Database, Role, User } from "./data";
import { canViewParcel } from "./parcel-visibility.ts";
import { hiddenCollectionIds } from "./collection-visibility.ts";

export const NAVIGATION_STORAGE_KEY = "almadina-navigation-v1";
export type NavigationDetails = {
  followupId: string | null;
  followupOrderId: string | null;
  customerId: string | null;
  customerTab: "followups" | "parcels";
  invoiceId: string | null;
  adminTab: "orders" | "users" | "collections" | "couriers";
};
export const EMPTY_NAVIGATION_DETAILS: NavigationDetails = {
  followupId: null, followupOrderId: null, customerId: null, customerTab: "followups", invoiceId: null, adminTab: "orders",
};
export type NavigationState = { view: View; selectedOrderId: string | null; details: NavigationDetails };
const common: readonly View[] = ["home", "shipments", "order-detail", "followups", "settings", "security", "change-password", "linked-devices", "delete-account", "notification-settings", "preferences", "help", "privacy", "notifications", "profile"];
const allowed: Record<Role, readonly View[]> = {
  merchant: [...common, "returns", "collections", "new-order", "recipients", "trash", "import"],
  courier: [...common, "customer-followups"],
  admin: [...common, "admin", "customer-followups", "deletion-requests", "parcel-codes", "trash"],
};
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function identifier(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value) ? value : null; }
export function defaultNavigation(role: Role): NavigationState { return { view: role === "admin" ? "admin" : "home", selectedOrderId: null, details: { ...EMPTY_NAVIGATION_DETAILS } }; }

/** Local state is only a location hint; current server data determines access. */
export function validateNavigation(value: unknown, user: User, database: Database): NavigationState {
  const raw = object(value);
  if (typeof raw.view !== "string" || !allowed[user.role].includes(raw.view as View)) return defaultNavigation(user.role);
  const state: NavigationState = { view: raw.view as View, selectedOrderId: null, details: { ...EMPTY_NAVIGATION_DETAILS } };
  if (state.view === "order-detail") {
    const selected = identifier(raw.selectedOrderId);
    const order = database.orders.find((entry) => entry.id === selected && !entry.deleted && canViewParcel(user, entry));
    if (!order) return { ...state, view: "shipments" };
    state.selectedOrderId = order.id;
  }
  const detail = object(raw.details);
  if (state.view === "admin" || (state.view === "home" && user.role === "admin")) {
    if (["orders", "users", "collections", "couriers"].includes(String(detail.adminTab))) state.details.adminTab = detail.adminTab as NavigationDetails["adminTab"];
  }
  if (state.view === "customer-followups") {
    state.details.customerId = identifier(detail.customerId);
    state.details.customerTab = detail.customerTab === "parcels" ? "parcels" : "followups";
  }
  if (state.view === "collections") {
    const invoiceId = identifier(detail.invoiceId);
    if (database.collections.some((invoice) => invoice.id === invoiceId && invoice.merchantId === user.id && !hiddenCollectionIds(database, user.id).has(invoice.id))) state.details.invoiceId = invoiceId;
  }
  if (state.view === "followups" || state.view === "order-detail" || (state.view === "customer-followups" && state.details.customerId && state.details.customerTab === "followups")) {
    const followupId = identifier(detail.followupId), orderId = identifier(detail.followupOrderId);
    const order = database.orders.find((entry) => entry.id === orderId && !entry.deleted && canViewParcel(user, entry));
    if (followupId && order && (state.view !== "order-detail" || order.id === state.selectedOrderId) && (state.view !== "customer-followups" || order.merchantId === state.details.customerId)) {
      state.details.followupId = followupId; state.details.followupOrderId = order.id;
    }
  }
  return state;
}

export function readNavigation(user: User, database: Database): NavigationState {
  try {
    const record = object(JSON.parse(window.sessionStorage.getItem(NAVIGATION_STORAGE_KEY) ?? "null"));
    return record.version === 1 && record.userId === user.id ? validateNavigation(record, user, database) : defaultNavigation(user.role);
  } catch { return defaultNavigation(user.role); }
}
export function saveNavigation(userId: string, state: NavigationState, role?: Role): void {
  try { window.sessionStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ version: 1, userId, role, ...state })); } catch { /* Navigation still works when browser storage is unavailable. */ }
}
export function clearNavigation(): void {
  try { window.sessionStorage.removeItem(NAVIGATION_STORAGE_KEY); } catch { /* Storage is optional. */ }
}

export function notificationNavigation(search: string, user: User, database: Database): NavigationState | null {
  const params = new URLSearchParams(search), orderId = params.get("notificationOrder")?.trim();
  if (orderId) return validateNavigation({ view: "order-detail", selectedOrderId: orderId }, user, database);
  return params.get("openNotifications") === "1" ? { ...defaultNavigation(user.role), view: "notifications" } : null;
}
