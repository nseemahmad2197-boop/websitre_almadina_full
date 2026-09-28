import type { Order, User } from "./data";

/** Read scope only. Editing/deletion and financial permissions remain separate. */
export function canViewParcel(user: User | null, order: Order): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "courier") return !order.deleted;
  return user.role === "merchant" && order.merchantId === user.id;
}
