import type { LinkedDevice } from "./data";
import { requestApiJSON } from "./api-transport.ts";

export class LinkedDevicesError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}
function validDevice(value: unknown): value is LinkedDevice {
  if (!record(value)) return false;
  if (!["id", "name", "browser"].every((key) => typeof value[key] === "string" && (value[key] as string).length > 0)) return false;
  if (!["mobile", "tablet", "desktop", "unknown"].includes(value.type as string) || typeof value.current !== "boolean" || !validDate(value.createdAt) || !validDate(value.lastActiveAt)) return false;
  if (!["model", "osVersion", "appVersion", "label"].every((key) => value[key] === undefined || typeof value[key] === "string")) return false;
  if (value.platform !== undefined && !["android", "ios", "ipados", "windows", "macos", "linux", "unknown"].includes(value.platform as string)) return false;
  if (value.location !== undefined && value.location !== null && typeof value.location !== "string") return false;
  if (value.locationUpdatedAt !== undefined && value.locationUpdatedAt !== null && !validDate(value.locationUpdatedAt)) return false;
  return value.locationSource === undefined || value.locationSource === "ip" || value.locationSource === "unknown";
}

type Operation = { action: "list" } | { action: "rename"; label: string } | { action: "revoke"; deviceId: string };

/** Validate the mutation receipt so an older server cannot produce false success. */
export async function requestLinkedDevices(operation: Operation, accountId?: string): Promise<LinkedDevice[]> {
  const rename = operation.action === "rename";
  const label = rename ? operation.label.trim() : "";
  if (rename && (label.length > 80 || /[\p{Cc}\p{Cf}]/u.test(label))) throw new LinkedDevicesError("اكتب اسمًا واضحًا للجهاز حتى 80 حرفًا.", 400);
  const { response, payload } = await requestApiJSON(`security/devices${rename ? "/current" : operation.action === "revoke" ? "/revoke" : ""}`, {
    credentials: "same-origin", cache: "no-store", method: operation.action === "list" ? "GET" : "POST",
    headers: { ...(operation.action !== "list" ? { "Content-Type": "application/json" } : {}), ...(accountId ? { "X-Almadina-Account": accountId } : {}) },
    ...(operation.action === "list" ? {} : { body: JSON.stringify(rename ? { label } : { deviceId: operation.deviceId }) }),
  });
  if (!response.ok) throw new LinkedDevicesError(record(payload) && typeof payload.error === "string" ? payload.error : "تعذّر تنفيذ طلب الأجهزة المرتبطة.", response.status);
  if (!record(payload) || !Array.isArray(payload.devices) || !payload.devices.every(validDevice)
    || new Set(payload.devices.map((device) => device.id)).size !== payload.devices.length
    || payload.devices.filter((device) => device.current).length > 1) throw new LinkedDevicesError("تعذّر التحقق من قائمة الأجهزة. أعد المحاولة.", 502);
  const devices = payload.devices;
  if (operation.action !== "list" && (payload.success !== true || payload.count !== devices.length)) throw new LinkedDevicesError("لم يؤكد الخادم حفظ التغيير. حدّث الموقع على الاستضافة ثم أعد المحاولة.", 502);
  if (rename && devices.find((device) => device.current)?.label !== label) throw new LinkedDevicesError("لم يؤكد الخادم اسم الجهاز الجديد. حدّث الموقع على الاستضافة ثم أعد المحاولة.", 502);
  if (operation.action === "revoke" && devices.some((device) => device.id === operation.deviceId)) throw new LinkedDevicesError("لم يؤكد الخادم تسجيل خروج الجهاز. أعد المحاولة.", 502);
  return devices;
}

export function devicePlatformName(device: LinkedDevice): string {
  const names: Record<string, string> = { ios: "آيفون · iOS", ipados: "آيباد · iPadOS", android: "أندرويد · Android", windows: "Windows", macos: "Mac · macOS", linux: "Linux" };
  return names[device.platform ?? "unknown"] ?? device.name;
}
