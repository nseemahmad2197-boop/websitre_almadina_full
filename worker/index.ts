/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleAlmadinaApi } from "../app/lib/server-database";
import type { PasswordResetDeliveryConfig, PasswordResetSender } from "../app/lib/password-reset-delivery";

interface Env extends PasswordResetDeliveryBindings {
  ASSETS: Fetcher;
  DB: D1Database;
  PASSWORD_RESET_SENDER?: PasswordResetSender;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

function passwordResetDeliveryConfig(env: Env, ctx: ExecutionContext): PasswordResetDeliveryConfig {
  return {
    brevoApiKey: env.BREVO_API_KEY,
    brevoFromEmail: env.BREVO_FROM_EMAIL,
    brevoFromName: env.BREVO_FROM_NAME,
    sender: env.PASSWORD_RESET_SENDER,
    defer: (promise) => ctx.waitUntil(promise),
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/almadina/")) {
      if (!env.DB) return Response.json({ error: "قاعدة البيانات المشتركة غير متاحة على الخادم." }, { status: 503 });
      return handleAlmadinaApi(request, env.DB, passwordResetDeliveryConfig(env, ctx));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
