import { copyTrustedClientAddress } from "../app/lib/trusted-client";
import { logServiceEvent } from "../app/lib/security-events";
/** Render/Node entry point for the Almadina Express application. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import handler from "vinext/server/app-router-entry";
import { getRenderDatabase } from "../app/lib/postgres-d1-adapter";
import { handleAlmadinaApi, type AlmadinaApiConfig } from "../app/lib/server-database";
import type { PasswordResetSender } from "../app/lib/password-reset-delivery";
import type { ReverseGeocoder } from "../app/lib/reverse-geocoding";
import { documentRequest, withSecurityHeaders } from "./security-headers";
import { HealthProbe, OperationalSecurity, type SecurityConfig } from "./operational-security";

interface Env {
  DB?: D1Database;
  PASSWORD_RESET_SENDER?: PasswordResetSender;
  REVERSE_GEOCODER?: ReverseGeocoder;
  ASSETS?: {
    fetch(request: Request): Promise<Response> | Response;
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type RenderPublicAsset = {
  file: string;
  contentType: string;
  cacheControl: string;
  serviceWorker?: boolean;
};

// vinext's Node adapter can return empty responses for files in public/ on
// Render. Serve the PWA files explicitly so WebKit receives real bytes and the
// correct MIME type for the service worker, manifest, and application icons.
const RENDER_PUBLIC_ASSETS = new Map<string, RenderPublicAsset>([
  ["/almadina-sw.js", {
    file: "almadina-sw.js",
    contentType: "text/javascript; charset=utf-8",
    cacheControl: "no-cache, no-store, must-revalidate",
    serviceWorker: true,
  }],
  ["/manifest.webmanifest", {
    file: "manifest.webmanifest",
    contentType: "application/manifest+json; charset=utf-8",
    cacheControl: "no-cache, max-age=0",
  }],
  ["/almadina-mark.svg", {
    file: "almadina-mark.svg",
    contentType: "image/svg+xml; charset=utf-8",
    cacheControl: "public, max-age=86400",
  }],
  ["/almadina-icon-192.png", {
    file: "almadina-icon-192.png",
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
  }],
  ["/almadina-icon-512.png", {
    file: "almadina-icon-512.png",
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
  }],
  ["/almadina-icon-maskable-512.png", {
    file: "almadina-icon-maskable-512.png",
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
  }],
  ["/apple-touch-icon.png", {
    file: "apple-touch-icon.png",
    contentType: "image/png",
    cacheControl: "public, max-age=86400",
  }],
]);

async function renderPublicAsset(request: Request, pathname: string): Promise<Response | null> {
  const asset = RENDER_PUBLIC_ASSETS.get(pathname);
  if (!asset || (request.method !== "GET" && request.method !== "HEAD")) return null;
  try {
    const bytes = new Uint8Array(await readFile(join(process.cwd(), "public", asset.file)));
    const headers = new Headers({
      "Cache-Control": asset.cacheControl,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": asset.contentType,
    });
    if (asset.serviceWorker) headers.set("Service-Worker-Allowed", "/");
    return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
  } catch (error) {
    logServiceEvent("asset_unavailable");
    return Response.json({ error: "ملف التطبيق المطلوب غير متاح على الخادم." }, { status: 500 });
  }
}

function resolveDatabase(env?: Env): D1Database {
  return env?.DB ?? getRenderDatabase();
}

function passwordResetDeliveryConfig(env: Env | undefined, ctx: ExecutionContext): AlmadinaApiConfig {
  return {
    brevoApiKey: process.env.BREVO_API_KEY,
    brevoFromEmail: process.env.BREVO_FROM_EMAIL,
    brevoFromName: process.env.BREVO_FROM_NAME,
    geoapifyApiKey: process.env.GEOAPIFY_API_KEY,
    supportPhone: process.env.ALMADINA_SUPPORT_PHONE,
    supportEmail: process.env.ALMADINA_SUPPORT_EMAIL,
    bootstrapAdminEmail: process.env.ALMADINA_ADMIN_EMAIL,
    bootstrapAdminPassword: process.env.ALMADINA_ADMIN_PASSWORD,
    bootstrapAdminPhone: process.env.ALMADINA_ADMIN_PHONE,
    bootstrapAdminName: process.env.ALMADINA_ADMIN_NAME,
    secondaryAdminEmail: process.env.ALMADINA_SECOND_ADMIN_EMAIL,
    secondaryAdminPassword: process.env.ALMADINA_SECOND_ADMIN_PASSWORD,
    secondaryAdminPhone: process.env.ALMADINA_SECOND_ADMIN_PHONE,
    secondaryAdminName: process.env.ALMADINA_SECOND_ADMIN_NAME,
    webPushEnabled: true,
    reverseGeocoder: env?.REVERSE_GEOCODER,
    sender: env?.PASSWORD_RESET_SENDER,
    defer: (promise) => ctx.waitUntil(promise),
  };
}

function unavailableDatabaseResponse(): Response {
  return Response.json(
    { error: "قاعدة بيانات الموقع غير متاحة مؤقتًا. حاول مجددًا بعد قليل." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

const protection = new OperationalSecurity();
const health = new HealthProbe();
function securityConfig(): SecurityConfig {
  return {
    edgeToken: process.env.ALMADINA_EDGE_TOKEN,
    monitorToken: process.env.ALMADINA_MONITOR_TOKEN,
    concurrentAPI: Number(process.env.ALMADINA_MAX_API_CONCURRENCY),
    concurrentAuth: Number(process.env.ALMADINA_MAX_AUTH_CONCURRENCY),
    authPerMinute: Number(process.env.ALMADINA_AUTH_BUDGET_PER_MINUTE),
    requestsPerMinute: Number(process.env.ALMADINA_REQUEST_BUDGET_PER_MINUTE),
  };
}
// Called only inside OperationalSecurity's authenticated-edge action.
// This preserves the public origin for CSRF, cookies and passkey RP validation
// while the ingress-to-Render hop uses the fixed onrender.com origin.
function publicEdgeRequest(request: Request): Request {
  if (!process.env.ALMADINA_EDGE_TOKEN || !process.env.ALMADINA_PUBLIC_ORIGIN) return request;
  let origin: URL;
  try { origin = new URL(process.env.ALMADINA_PUBLIC_ORIGIN); } catch { throw new Error("Invalid public origin"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid public origin");
  const source = new URL(request.url);
  origin.pathname = source.pathname; origin.search = source.search;
  return copyTrustedClientAddress(request, new Request(origin, request));
}

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const publicAsset = await renderPublicAsset(request, url.pathname);
    if (publicAsset) return withSecurityHeaders(request, publicAsset);

    if (url.pathname === "/health") {
      return withSecurityHeaders(request, await health.check(async () => {
        const result = await resolveDatabase(env).prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return result?.ok === 1;
      }));
    }

    if (url.pathname === "/ops/metrics") return withSecurityHeaders(request, await protection.metrics(request, securityConfig()));

    if (url.pathname.startsWith("/api/almadina/")) {
      return withSecurityHeaders(request, await protection.run(request, securityConfig(), async () => { try {
        return withSecurityHeaders(request, await handleAlmadinaApi(publicEdgeRequest(request), resolveDatabase(env), passwordResetDeliveryConfig(env, ctx)));
      } catch (error) {
        logServiceEvent("database_unavailable");
        return withSecurityHeaders(request, unavailableDatabaseResponse());
      } }));
    }

    return protection.run(request, securityConfig(), async () => {
      const secured = documentRequest(publicEdgeRequest(request));
      return withSecurityHeaders(secured, await handler.fetch(secured, env ?? {}, ctx));
    });
  },
};

export default worker;
