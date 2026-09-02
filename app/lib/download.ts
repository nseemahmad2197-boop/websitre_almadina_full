import type { Order } from "./data";
import { getStatus } from "./data";

function escapeCsv(value: string | number): string {
  const raw = String(value ?? "");
  // Spreadsheet applications may execute untrusted cells that begin like a formula.
  // A leading apostrophe keeps exported user text inert when opened in Excel/Sheets.
  const text = typeof value === "string" && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadDocument(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF", content], { type });
  const url = URL.createObjectURL(blob);
  const element = document.createElement("a");
  element.href = url;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  element.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ordersCsv(orders: Order[]): string {
  const headers = ["رقم التتبع", "المستلم", "رقم الجوال", "المدينة", "العنوان", "القيمة", "التوصيل", "الحالة", "التاريخ"];
  const rows = orders.map((order) => [order.trackingNumber, order.recipientName, order.recipientPhone, order.city, order.address, order.amount, order.deliveryFee, getStatus(order.status).label, order.createdAt.slice(0, 10)]);
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export const importTemplate = [
  ["الاسم", "رقم الجوال", "المحافظة", "المدينة", "العنوان", "القيمة", "الوصف", "الطول سم", "العرض سم", "الارتفاع سم", "الوزن"],
  ["أحمد محمد", "0599123456", "نابلس", "نابلس", "شارع فيصل", "120", "ملابس", "40", "30", "20", "0 - 5 كغم"],
].map((row) => row.map(escapeCsv).join(",")).join("\n");
