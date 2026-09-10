import { copyTrustedClientAddress } from "../app/lib/trusted-client.ts";

function documentPolicy(nonce?: string) { return [
  "default-src 'self'",
  nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
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
].join("; "); }

export function documentRequest(request: Request): Request {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = btoa(String.fromCharCode(...bytes));
  const headers = new Headers(request.headers);
  // Framework reads the request CSP to nonce its SSR/hydration scripts.
  // Never accept a policy or nonce supplied by the visitor.
  headers.set("Content-Security-Policy", documentPolicy(nonce));
  headers.delete("Content-Security-Policy-Report-Only");
  headers.set("X-Almadina-CSP-Nonce", nonce);
  return copyTrustedClientAddress(request, new Request(request, { headers }));
}

export function withSecurityHeaders(request: Request, response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", documentPolicy());
  if (headers.get("content-type")?.includes("text/html")) {
    const nonce = request.headers.get("X-Almadina-CSP-Nonce");
    headers.set("Content-Security-Policy", documentPolicy(nonce && /^[A-Za-z0-9+/]{32}$/.test(nonce) ? nonce : undefined));
    headers.set("Cache-Control", "private, no-store");
  }
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
