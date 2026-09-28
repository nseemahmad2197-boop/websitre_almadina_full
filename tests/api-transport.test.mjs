import test from "node:test";
import assert from "node:assert/strict";
import { requestApiJSON, ApiTransportError, classifyApiError, safeApiErrorMessage } from "../app/lib/api-transport.ts";

function mockFetch(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, options) => { calls.push({ url, options }); return handler(url, options); };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

function setOnline(t, online) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: online } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "navigator", original); else delete globalThis.navigator; });
}

test("successful payload and request security settings remain intact", async (t) => {
  const payload = { revision: 4, database: { orders: [] }, success: true };
  const calls = mockFetch(t, async () => Response.json(payload));
  const result = await requestApiJSON("orders", { method: "POST", body: "{}", headers: { "X-Almadina-Account": "owner" } });
  assert.equal(result.response.ok, true);
  assert.deepEqual(result.payload, payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/almadina/orders");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.headers["X-Almadina-Account"], "owner");
});

test("HTTP status categories preserve non-OK response and conflict snapshot", async (t) => {
  const categories = new Map([[401, "unauthorized"], [403, "forbidden"], [409, "conflict"], [429, "rate-limit"], [500, "server"], [502, "server"], [503, "server"], [400, "request"]]);
  let status = 401;
  mockFetch(t, async () => Response.json({ error: "<html>private upstream trace</html>", revision: 9, database: { orders: [] } }, { status }));
  for (const [code, category] of categories) {
    status = code;
    const result = await requestApiJSON("database");
    assert.equal(result.response.ok, false);
    assert.equal(result.response.status, code);
    assert.equal(classifyApiError({ status: code }), category);
    assert.equal(classifyApiError(undefined, code), category);
    assert.equal(result.payload.revision, 9);
    assert.deepEqual(result.payload.database, { orders: [] });
    assert.match(result.payload.error, /[\u0600-\u06ff]/);
    assert.doesNotMatch(result.payload.error, /html|upstream|trace|<|>/);
  }
});

test("4xx plain Arabic validation stays useful; 5xx diagnostics stay private", async (t) => {
  let status = 400;
  mockFetch(t, async () => Response.json({ error: "رقم الجوال مسجل لحساب آخر." }, { status }));
  assert.equal((await requestApiJSON("register")).payload.error, "رقم الجوال مسجل لحساب آخر.");
  status = 503;
  assert.equal((await requestApiJSON("register")).payload.error, safeApiErrorMessage({ status: 503 }));
});

test("successful HTTP responses sanitize error text without changing receipts or adding absent errors", async (t) => {
  let payload = { success: false, error: "<html>private upstream diagnostic</html>", revision: 12, receipt: { id: "saved-order" } };
  mockFetch(t, async () => Response.json(payload));
  const unsafe = await requestApiJSON("orders");
  assert.equal(unsafe.response.status, 200);
  assert.equal(unsafe.response.ok, true);
  assert.equal(unsafe.payload.success, false);
  assert.equal(unsafe.payload.revision, 12);
  assert.deepEqual(unsafe.payload.receipt, { id: "saved-order" });
  assert.doesNotMatch(unsafe.payload.error, /html|private|diagnostic|<|>/);
  assert.match(unsafe.payload.error, /[\u0600-\u06ff]/);
  payload = { success: false, error: "رقم الجوال مسجل لحساب آخر.", revision: 13 };
  assert.deepEqual((await requestApiJSON("orders")).payload, payload);
  payload = { success: true, revision: 14, receipt: { id: "saved-order" } };
  const saved = await requestApiJSON("orders");
  assert.deepEqual(saved.payload, payload);
  assert.equal(Object.hasOwn(saved.payload, "error"), false);
});

test("HTML and non-object HTTP errors retain actual status without raw bodies", async (t) => {
  let body = "<html>database secret</html>", status = 401;
  mockFetch(t, async () => new Response(body, { status }));
  for (const code of [401, 403, 409, 429, 503]) {
    status = code;
    for (const text of ["<html>database secret</html>", "null", "[]", '"internal detail"']) {
      body = text;
      const result = await requestApiJSON("session");
      assert.equal(result.response.status, code);
      assert.doesNotMatch(JSON.stringify(result.payload), /secret|html|internal/);
    }
  }
});

test("malformed successful replies throw typed safe errors", async (t) => {
  let body = "null";
  mockFetch(t, async () => new Response(body));
  for (const text of ["null", "[]", "42", "<html>proxy diagnostic</html>"]) {
    body = text;
    await assert.rejects(requestApiJSON("orders"), (error) => error instanceof ApiTransportError && error.category === "malformed" && !error.message.includes("proxy"));
  }
});

test("network and offline failures are distinct and do not expose fetch errors", async (t) => {
  setOnline(t, true);
  const calls = mockFetch(t, async () => { throw new TypeError("secret URL/internal failure"); });
  await assert.rejects(requestApiJSON("orders"), (error) => error.category === "network" && !error.message.includes("secret"));
  navigator.onLine = false;
  await assert.rejects(requestApiJSON("orders"), (error) => error.category === "offline");
  assert.equal(calls.length, 2);
  assert.equal(classifyApiError(new TypeError("Failed to fetch")), "offline");
  assert.equal(classifyApiError({ status: 503 }), "server");
});

test("stalled fetch ignoring AbortSignal is bounded and mutation is never replayed", { timeout: 1500 }, async (t) => {
  const calls = mockFetch(t, () => new Promise(() => {}));
  await assert.rejects(requestApiJSON("orders", { method: "POST", body: "{}" }, 15), (error) => error.category === "timeout" && error.name !== "AbortError");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
});

test("stalled body ignoring AbortSignal shares the bounded request deadline", { timeout: 1500 }, async (t) => {
  const calls = mockFetch(t, async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }));
  await assert.rejects(requestApiJSON("orders", { method: "POST" }, 15), (error) => error.category === "timeout");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
});

test("external cancellation before a request prevents fetch", async (t) => {
  const calls = mockFetch(t, () => assert.fail("fetch should not run"));
  const controller = new AbortController(); controller.abort(new Error("navigation private detail"));
  await assert.rejects(requestApiJSON("session", { signal: controller.signal }), (error) => error.name === "AbortError" && error.category === "aborted" && !error.message.includes("private"));
  assert.equal(calls.length, 0);
});

test("external abort settles a non-cooperative pending fetch without timeout error", { timeout: 1500 }, async (t) => {
  const calls = mockFetch(t, () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = requestApiJSON("session", { signal: controller.signal }, 1000);
  controller.abort();
  await assert.rejects(pending, (error) => classifyApiError(error) === "aborted" && error.name === "AbortError");
  assert.equal(calls[0].options.signal.aborted, true);
});

test("external abort during JSON body remains intentional cancellation", { timeout: 1500 }, async (t) => {
  const controller = new AbortController();
  mockFetch(t, async () => ({ ok: true, status: 200, json: () => { queueMicrotask(() => controller.abort()); return new Promise(() => {}); } }));
  await assert.rejects(requestApiJSON("session", { signal: controller.signal }, 1000), (error) => error.category === "aborted");
});

test("completed request removes external abort listener and clears deadline", { timeout: 1500 }, async (t) => {
  const controller = new AbortController();
  let listenerCount = 0;
  const originalAdd = controller.signal.addEventListener.bind(controller.signal);
  const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { listenerCount++; return originalAdd(...args); };
  controller.signal.removeEventListener = (...args) => { listenerCount--; return originalRemove(...args); };
  const calls = mockFetch(t, async () => Response.json({ success: true }));
  await requestApiJSON("session", { signal: controller.signal }, 15);
  assert.equal(listenerCount, 0);
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls[0].options.signal.aborted, false);
});

test("unknown exceptions have safe Arabic copy and status errors stay classified", () => {
  assert.doesNotMatch(safeApiErrorMessage(new Error("<html>private stack</html>")), /html|private|stack/);
  assert.equal(safeApiErrorMessage(new Error("internal"), "تعذّر تحميل القائمة."), "تعذّر تحميل القائمة.");
  assert.equal(classifyApiError(new DOMException("user navigated away", "AbortError")), "aborted");
  assert.equal(classifyApiError(new DOMException("deadline", "TimeoutError")), "timeout");
  assert.equal(classifyApiError(new SyntaxError("bad JSON")), "malformed");
});
