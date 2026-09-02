/** Render/Node entry point for the Almadina Express application. */
import handler from "vinext/server/app-router-entry";
import { getRenderDatabase } from "../app/lib/postgres-d1-adapter";
import { handleAlmadinaApi, type AlmadinaApiConfig } from "../app/lib/server-database";
import type { PasswordResetSender } from "../app/lib/password-reset-delivery";
import type { ReverseGeocoder } from "../app/lib/reverse-geocoding";
import { withSecurityHeaders } from "./security-headers";

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

function resolveDatabase(env?: Env): D1Database {
  return env?.DB ?? getRenderDatabase();
}

function passwordResetDeliveryConfig(env: Env | undefined, ctx: ExecutionContext): AlmadinaApiConfig {
  return {
    brevoApiKey: process.env.BREVO_API_KEY,
    brevoFromEmail: process.env.BREVO_FROM_EMAIL,
    brevoFromName: process.env.BREVO_FROM_NAME,
    geoapifyApiKey: process.env.GEOAPIFY_API_KEY,
    bootstrapAdminEmail: process.env.ALMADINA_ADMIN_EMAIL,
    bootstrapAdminPassword: process.env.ALMADINA_ADMIN_PASSWORD,
    bootstrapAdminPhone: process.env.ALMADINA_ADMIN_PHONE,
    bootstrapAdminName: process.env.ALMADINA_ADMIN_NAME,
    secondaryAdminEmail: process.env.ALMADINA_SECOND_ADMIN_EMAIL,
    secondaryAdminPassword: process.env.ALMADINA_SECOND_ADMIN_PASSWORD,
    secondaryAdminPhone: process.env.ALMADINA_SECOND_ADMIN_PHONE,
    secondaryAdminName: process.env.ALMADINA_SECOND_ADMIN_NAME,
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

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      try {
        const result = await resolveDatabase(env).prepare("SELECT 1 AS ok").first<{ ok: number }>();
        const response = result?.ok === 1
          ? Response.json({ status: "ok" })
          : Response.json({ status: "unhealthy" }, { status: 503 });
        return withSecurityHeaders(request, response);
      } catch (error) {
        console.error("Render health check could not reach PostgreSQL.", error);
        return withSecurityHeaders(request, Response.json({ status: "unhealthy" }, { status: 503 }));
      }
    }

    if (url.pathname.startsWith("/api/almadina/")) {
      try {
        return withSecurityHeaders(request, await handleAlmadinaApi(request, resolveDatabase(env), passwordResetDeliveryConfig(env, ctx)));
      } catch (error) {
        console.error("Almadina API could not reach PostgreSQL.", error);
        return withSecurityHeaders(request, unavailableDatabaseResponse());
      }
    }

    return withSecurityHeaders(request, await handler.fetch(request, env ?? {}, ctx));
  },
};

export default worker;
