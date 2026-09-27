import assert from "node:assert/strict";
import test from "node:test";
import { OperationalSecurity, HealthProbe } from "../worker/operational-security.ts";
import { documentRequest, withSecurityHeaders } from "../worker/security-headers.ts";
import { trustedClientAddress, copyTrustedClientAddress } from "../app/lib/trusted-client.ts";
import { readBoundedBody } from "../app/lib/bounded-body.ts";

const api = (path = "login", headers = {}) => new Request(`https://example.test/api/almadina/${path}`, { method: "POST", headers });
const ok = async () => Response.json({ ok: true });
const secret = "d".repeat(48);

test("unauthenticated forwarding headers cannot select an IP rate-limit identity", async () => {
  const guard = new OperationalSecurity();
  const request = api("login", { "X-Forwarded-For": "203.0.113.1", "CF-Connecting-IP": "198.51.100.2", "X-Almadina-Client-IP": "198.51.100.3" });
  assert.equal((await guard.run(request, {}, ok)).status, 200);
  assert.equal(trustedClientAddress(request), "unknown");
});

test("origin protection rejects missing/wrong keys before any database work and trusts only verified edge identity", async () => {
  const guard = new OperationalSecurity();
  let calls = 0;
  const action = async () => { calls++; return ok(); };
  for (const token of ["", "wrong"]) assert.equal((await guard.run(api("login", { "X-Almadina-Edge-Token": token }), { edgeToken: secret }, action)).status, 403);
  assert.equal(calls, 0);
  const request = api("login", { "X-Almadina-Edge-Token": secret, "X-Almadina-Client-IP": "203.0.113.9", "X-Forwarded-For": "127.0.0.1" });
  assert.equal((await guard.run(request, { edgeToken: secret }, action)).status, 200);
  assert.equal(trustedClientAddress(request), "203.0.113.9");
  assert.equal(trustedClientAddress(copyTrustedClientAddress(request, new Request(request))), "203.0.113.9");
});

test("load shedding stops costly work, reserves logout, and releases slots after failures", async () => {
  const guard = new OperationalSecurity();
  let release;
  const running = guard.run(api(), { concurrentAPI: 1, concurrentAuth: 1 }, () => new Promise(resolve => { release = resolve; }));
  const overloaded = await guard.run(api(), { concurrentAPI: 1 }, () => { throw new Error("must never run"); });
  assert.equal(overloaded.status, 503);
  assert.ok(overloaded.headers.get("Retry-After"));
  assert.equal((await guard.run(api("logout"), { concurrentAPI: 1 }, ok)).status, 200);
  release(await ok());
  await running;
  assert.equal((await guard.run(api(), {}, async () => { throw new Error("secret DB details"); })).status, 503);
  assert.equal(guard.snapshot().activeRequests, 0);
  assert.equal(guard.snapshot().activeAuthentication, 0);
});

test("authentication rate budget recovers with time and cannot be bypassed with spoofed client headers", async () => {
  let now = 100_000;
  const guard = new OperationalSecurity(() => now);
  assert.equal((await guard.run(api(), { authPerMinute: 1 }, ok)).status, 200);
  assert.equal((await guard.run(api("login", { "X-Forwarded-For": "different" }), { authPerMinute: 1 }, ok)).status, 503);
  now += 60_001;
  assert.equal((await guard.run(api(), { authPerMinute: 1 }, ok)).status, 200);
});

test("monitor endpoint is closed by default and only exposes anonymous aggregate counters", async () => {
  const guard = new OperationalSecurity();
  await guard.run(api(), {}, async () => new Response(null, { status: 401 }));
  const request = new Request("https://example.test/ops/metrics", { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal((await guard.metrics(request, {})).status, 404);
  assert.equal((await guard.metrics(new Request(request.url), { monitorToken: secret })).status, 404);
  const response = await guard.metrics(request, { monitorToken: secret });
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.denied, 1);
  assert.deepEqual(Object.keys(value).sort(), ["windowSeconds", "activeRequests", "activeAuthentication", "requests", "failures", "denied", "slow"].sort());
  assert.equal(JSON.stringify(value).includes(secret), false);
});

test("health requests coalesce, cache briefly and time out without disclosing database errors", async () => {
  let calls = 0;
  const probe = new HealthProbe(15);
  const query = () => { calls++; return new Promise(() => {}); };
  const responses = await Promise.all([probe.check(query), probe.check(query), probe.check(query)]);
  assert.equal(calls, 1);
  for (const response of responses) { assert.equal(response.status, 503); assert.deepEqual(await response.json(), { status: "unhealthy" }); }
  await probe.check(query);
  assert.equal(calls, 1);
});

test("CSP uses fresh server-created nonces and HTML cannot be publicly cached", () => {
  const request = new Request("https://example.test/", { headers: { "Content-Security-Policy": "script-src 'unsafe-inline'", "X-Almadina-CSP-Nonce": "attacker" } });
  const a = documentRequest(request), b = documentRequest(request);
  assert.notEqual(a.headers.get("X-Almadina-CSP-Nonce"), b.headers.get("X-Almadina-CSP-Nonce"));
  const response = withSecurityHeaders(a, new Response("<html></html>", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=9999" } }));
  const scriptPolicy = response.headers.get("Content-Security-Policy").split(";").find(x => x.trim().startsWith("script-src "));
  assert.match(scriptPolicy, /'nonce-/);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline|attacker/);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.match(response.headers.get("Permissions-Policy"), /microphone=\(self\)/);
  assert.match(response.headers.get("Permissions-Policy"), /camera=\(self\)/);
  assert.doesNotMatch(response.headers.get("Permissions-Policy"), /microphone=\(\*\)/);
});

test("body bounds stop oversized and stalled streams even when cancel never resolves", async () => {
  const large = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); } , cancel() { return new Promise(() => {}); } });
  await assert.rejects(readBoundedBody(large, 10, 20), error => error.status === 413);
  const slow = new ReadableStream({ cancel() { return new Promise(() => {}); } });
  await assert.rejects(readBoundedBody(slow, 10, 15), error => error.status === 408);
  assert.equal(new TextDecoder().decode(await readBoundedBody(new Response("valid").body, 10)), "valid");
});

test("document requests share the concurrency and minute budgets with API work", async () => {
  const guard = new OperationalSecurity();
  const config = { requestsPerMinute: 1 };
  assert.equal((await guard.run(new Request("https://example.test/"), config, ok)).status, 200);
  assert.equal((await guard.run(new Request("https://example.test/arbitrary-missing-page"), config, ok)).status, 503);
  assert.equal((await guard.run(api("logout"), config, ok)).status, 200);
});

test("login region comes only from authenticated edge or Worker cf metadata and survives body clones", async () => {
  const { trustedClientLocation } = await import('../app/lib/trusted-client.ts');
  const geoHeaders = { 'X-Almadina-Client-IP': '203.0.113.9', 'X-Almadina-Client-City': encodeURIComponent('نابلس'), 'X-Almadina-Client-Region': encodeURIComponent('نابلس'), 'X-Almadina-Client-Country': 'PS', 'CF-IPCity': 'spoofed', 'CF-IPCountry': 'US' };
  const untrusted = api('login', geoHeaders);
  await new OperationalSecurity().run(untrusted, {}, ok);
  assert.equal(trustedClientLocation(untrusted), null);
  const wrong = api('login', { ...geoHeaders, 'X-Almadina-Edge-Token': 'wrong' });
  assert.equal((await new OperationalSecurity().run(wrong, { edgeToken: secret }, ok)).status, 403);
  assert.equal(trustedClientLocation(wrong), null);
  const trusted = api('login', { ...geoHeaders, 'X-Almadina-Edge-Token': secret });
  assert.equal((await new OperationalSecurity().run(trusted, { edgeToken: secret }, ok)).status, 200);
  assert.match(trustedClientLocation(trusted), /نابلس/);
  assert.equal(trustedClientLocation(copyTrustedClientAddress(trusted, new Request(trusted))), trustedClientLocation(trusted));
  const workerRequest = api('login', { ...geoHeaders, 'CF-Connecting-IP': '203.0.113.8' });
  Object.defineProperty(workerRequest, 'cf', { value: { city: 'Ramallah', region: 'West Bank', country: 'PS' } });
  await new OperationalSecurity().run(workerRequest, {}, ok, true);
  assert.match(trustedClientLocation(workerRequest), /Ramallah/);
  assert.doesNotMatch(trustedClientLocation(workerRequest), /نابلس|spoofed/);
  const malformed = api('login', { ...geoHeaders, 'X-Almadina-Edge-Token': secret, 'X-Almadina-Client-Country': '%bad' });
  await new OperationalSecurity().run(malformed, { edgeToken: secret }, ok);
  assert.equal(trustedClientLocation(malformed), null);
});
