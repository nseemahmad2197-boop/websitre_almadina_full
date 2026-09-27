import { setTrustedClientAddress, setTrustedClientLocation, trustedClientAddress } from "../app/lib/trusted-client.ts";

export type SecurityConfig = {
  edgeToken?: string;
  monitorToken?: string;
  concurrentAPI?: number;
  concurrentAuth?: number;
  authPerMinute?: number;
  requestsPerMinute?: number;
};
type Bucket = { start: number; count: number };
const authRoutes = new Set(["login", "register/request", "register/verify", "password-reset/request", "password-reset/verify", "password-reset/complete", "passkey/login/options", "passkey/login/verify"]);

async function equalSecret(provided: string, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32 || provided.length > 512) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([provided, expected].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function rejected(status: number, retry = 30): Response {
  return Response.json({ error: status === 403 ? "مصدر الطلب غير مسموح." : "الخدمة مشغولة مؤقتًا. انتظر قليلًا ثم حاول مجددًا." }, {
    status, headers: { "Cache-Control": "no-store", ...(status === 429 || status === 503 ? { "Retry-After": String(retry) } : {}) },
  });
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && value! > 0 && value! <= maximum ? value! : fallback;
}

/** Per-process load shedding complements persistent account limits and the edge WAF.
 * Memory is bounded, it never retries writes, and overload cannot disable logout.
 */
export class OperationalSecurity {
  private active = 0;
  private authActive = 0;
  private logoutActive = 0;
  private authBudget: Bucket = { start: 0, count: 0 };
  private requestBudget: Bucket = { start: 0, count: 0 };
  private clients = new Map<string, Bucket>();
  private minutes = new Map<number, { requests: number; failures: number; denied: number; slow: number }>();

  private readonly clock: () => number;
  constructor(clock: () => number = Date.now) { this.clock = clock; }

  private record(status: number, elapsed: number): void {
    const minute = Math.floor(this.clock() / 60_000);
    for (const key of this.minutes.keys()) if (key < minute - 4) this.minutes.delete(key);
    const bucket = this.minutes.get(minute) ?? { requests: 0, failures: 0, denied: 0, slow: 0 };
    bucket.requests++;
    if (status >= 500) bucket.failures++;
    if (status === 401 || status === 403 || status === 429) bucket.denied++;
    if (elapsed >= 3_000) bucket.slow++;
    this.minutes.set(minute, bucket);
  }

  snapshot() {
    const since = Math.floor(this.clock() / 60_000) - 4;
    const totals = { requests: 0, failures: 0, denied: 0, slow: 0 };
    for (const [minute, bucket] of this.minutes) if (minute >= since) {
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += bucket[key];
    }
    return { windowSeconds: 300, activeRequests: this.active, activeAuthentication: this.authActive, ...totals };
  }

  async metrics(request: Request, config: SecurityConfig): Promise<Response> {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!await equalSecret(token, config.monitorToken)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(this.snapshot(), { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }

  async run(request: Request, config: SecurityConfig, action: () => Promise<Response>, cloudflareRuntime = false): Promise<Response> {
    const started = this.clock();
    const route = new URL(request.url).pathname.replace(/^\/api\/almadina\//, "");
    const logout = route === "logout";
    const costly = authRoutes.has(route);
    let counted = false;
    let response: Response;
    try {
      // This opt-in origin restriction is enabled only AFTER native apps have
      // migrated to a proxied custom domain. Token/IP headers must be overwritten
      // by an authenticated edge rule; the secret must never ship in an app.
      if (config.edgeToken) {
        if (!await equalSecret(request.headers.get("x-almadina-edge-token") ?? "", config.edgeToken)) return this.finish(rejected(403), started);
        setTrustedClientAddress(request, request.headers.get("x-almadina-client-ip") ?? "");
        // These headers are overwritten by our ingress Worker, which owns the
        // secret. Percent encoding keeps non-ASCII region names valid HTTP.
        const locationHeader = (name: string) => {
          try { return decodeURIComponent((request.headers.get(name) ?? "").slice(0, 1200)); } catch { return ""; }
        };
        if (trustedClientAddress(request) !== "unknown") setTrustedClientLocation(request, {
          city: locationHeader("x-almadina-client-city"), region: locationHeader("x-almadina-client-region"),
          country: locationHeader("x-almadina-client-country"),
        });
      } else if (cloudflareRuntime && "cf" in request) {
        setTrustedClientAddress(request, request.headers.get("cf-connecting-ip") ?? "");
        const cf = (request as Request & { cf?: { city?: unknown; region?: unknown; country?: unknown } }).cf;
        if (cf && trustedClientAddress(request) !== "unknown") setTrustedClientLocation(request, cf);
      }
      // Do not trust X-Forwarded-For on Render: its trust chain has not been
      // established. Persistent account/global limits still apply in that mode.
      const client = trustedClientAddress(request);
      if (logout && this.logoutActive >= 4) return this.finish(rejected(503, 5), started);
      if (!logout) {
        if (started - this.requestBudget.start >= 60_000) this.requestBudget = { start: started, count: 0 };
        if (this.requestBudget.count >= bounded(config.requestsPerMinute, 3000, 120000)) return this.finish(rejected(503, 10), started);
        this.requestBudget.count++;
      }
      if (!logout && client !== "unknown") {
        if (this.clients.size >= 10_000) {
          for (const [key, value] of this.clients) if (started - value.start >= 60_000) this.clients.delete(key);
          if (this.clients.size >= 10_000 && !this.clients.has(client)) return this.finish(rejected(503), started);
        }
        const old = this.clients.get(client);
        const bucket = old && started - old.start < 60_000 ? old : { start: started, count: 0 };
        bucket.count++;
        this.clients.set(client, bucket);
        if (bucket.count > 300) return this.finish(rejected(429), started);
      }
      if (!logout && this.active >= bounded(config.concurrentAPI, 32, 256)) return this.finish(rejected(503, 10), started);
      if (costly) {
        if (started - this.authBudget.start >= 60_000) this.authBudget = { start: started, count: 0 };
        if (this.authActive >= bounded(config.concurrentAuth, 4, 32) || this.authBudget.count >= bounded(config.authPerMinute, 120, 6000)) return this.finish(rejected(503, 30), started);
        this.authBudget.count++;
        this.authActive++;
      }
      this.active++;
      if (logout) this.logoutActive++;
      counted = true;
      response = await action();
    } catch {
      response = rejected(503);
    } finally {
      if (counted) { this.active--; if (costly) this.authActive--; if (logout) this.logoutActive--; }
    }
    return this.finish(response, started);
  }

  private finish(response: Response, started: number): Response {
    this.record(response.status, this.clock() - started);
    return response;
  }
}

/** One in-flight health query, short cache and a deadline for Render's 5s probe. */
export class HealthProbe {
  private pending: Promise<boolean> | null = null;
  private last: { at: number; healthy: boolean } | null = null;
  private readonly timeoutMs: number;
  private readonly clock: () => number;
  constructor(timeoutMs = 2500, clock: () => number = Date.now) { this.timeoutMs = timeoutMs; this.clock = clock; }

  async check(query: () => Promise<boolean>): Promise<Response> {
    if (this.last && this.clock() - this.last.at < 3000) return this.response(this.last.healthy);
    if (!this.pending) this.pending = Promise.resolve().then(query).catch(() => false).finally(() => { this.pending = null; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const healthy = await Promise.race([this.pending, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), this.timeoutMs); })]);
    clearTimeout(timer);
    this.last = { at: this.clock(), healthy };
    return this.response(healthy);
  }
  private response(healthy: boolean): Response {
    return Response.json({ status: healthy ? "ok" : "unhealthy" }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
