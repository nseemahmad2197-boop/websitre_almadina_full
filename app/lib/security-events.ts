// An allowlist keeps credentials, addresses, QR codes, receipt links, SQL and
// third-party error bodies out of operational logs. No client text is logged.
const API_ROUTES = new Set([
  "public/config", "login", "logout", "session", "database", "track",
  "geocode/reverse", "register", "register/request", "register/verify",
  "password-reset/request", "password-reset/verify", "password-reset/complete",
  "passkey/login/options", "passkey/login/verify", "push/config", "push/subscribe",
  "push/unsubscribe", "push/test", "security/devices", "security/devices/revoke", "security/devices/current",
  "security/status", "security/pin", "security/pin/verify", "security/disable",
  "security/webauthn/register/options", "security/webauthn/register/verify",
  "security/webauthn/authenticate/options", "security/webauthn/authenticate/verify",
  "security/webauthn/disable", "notices/broadcast", "notices/clear", "trash/purge",
  "account/deletion-receipt", "account/deletion-request", "admin/deletion-requests",
  "account/delete", "account/password", "collections/verify", "collections/prepare",
  "parcel-code-batches", "orders", "orders/assign-code", "orders/scan",
]);

export function requestEvent(request: Request, status: number, durationMs: number, requestId: string) {
  const path = new URL(request.url).pathname.replace(/^\/api\/almadina\//, "");
  const client = request.headers.get("X-Almadina-Client") ?? "";
  return {
    event: "api_request",
    requestId: /^[\da-f-]{36}$/i.test(requestId) ? requestId : "unavailable",
    route: API_ROUTES.has(path) ? path : "unknown",
    method: ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"].includes(request.method) ? request.method : "OTHER",
    client: client.startsWith("ios-native/") ? "ios" : client.startsWith("android-native/") ? "android" : "web",
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
  };
}

export function logRequestEvent(request: Request, status: number, durationMs: number, requestId: string): void {
  if (request.method === "GET" && status < 400 && durationMs < 3_000) return;
  try {
    const line = JSON.stringify(requestEvent(request, status, durationMs, requestId));
    if (status >= 500) console.error(line);
    else if (status >= 400) console.warn(line);
    else console.info(line);
  } catch { /* Logging must never fail or repeat an acknowledged transaction. */ }
}

export function logServiceEvent(event: "push_delivery_failed" | "push_prepare_failed" | "passkey_failed" | "reset_delivery_failed" | "registration_delivery_failed" | "geocoding_failed" | "database_unavailable" | "health_failed" | "asset_unavailable"): void {
  try { console.warn(JSON.stringify({ event })); } catch { /* Optional diagnostic. */ }
}
