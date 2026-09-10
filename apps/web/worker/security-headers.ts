const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

export function withSecurityHeaders(request: Request, response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", DOCUMENT_CSP);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(self), geolocation=(self), microphone=(), payment=(), publickey-credentials-get=(self), usb=()");
  headers.set("Referrer-Policy", headers.get("Referrer-Policy") || "no-referrer");
  headers.set("X-DNS-Prefetch-Control", "off");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
