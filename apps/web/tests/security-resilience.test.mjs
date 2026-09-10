import assert from "node:assert/strict";
import test from "node:test";
import { requestEvent, logRequestEvent } from "../app/lib/security-events.ts";
import { requestApiJSON, validSnapshotEnvelope, canAcceptPolledSnapshot } from "../app/lib/api-transport.ts";

const envelope = () => ({ userId: "test-owner", revision: 4, database: {
  users: [{ id: "test-owner", role: "merchant" }], orders: [], collections: [], recipients: [], notices: [],
} });

test("operational events exclude credentials, submitted content and identifying URLs", () => {
  const secret = "private-secret-example";
  const request = new Request(`https://app.test/api/almadina/account/deletion-receipt?receipt=${secret}`, {
    method: "POST", headers: { Cookie: secret, Authorization: secret, "X-Almadina-Client": `ios-native/${secret}`, "User-Agent": secret },
    body: JSON.stringify({ password: secret, phone: secret }),
  });
  const event = requestEvent(request, 403, 12.4, "c61fe174-2a27-4560-a52a-0d95bd45d987");
  assert.equal(event.client, "ios");
  assert.equal(event.route, "account/deletion-receipt");
  assert.equal(JSON.stringify(event).includes(secret), false);
  assert.equal(requestEvent(new Request(`https://app.test/api/almadina/${secret}`), 404, 0, secret).route, "unknown");
  assert.equal(requestEvent(request, 500, NaN, secret).requestId, "unavailable");
});

test("failed logging cannot change an acknowledged API result", () => {
  const original = console.info;
  console.info = () => { throw new Error("logging unavailable"); };
  try { assert.doesNotThrow(() => logRequestEvent(new Request("https://app.test/api/almadina/orders", { method: "POST" }), 200, 50, "c61fe174-2a27-4560-a52a-0d95bd45d987")); }
  finally { console.info = original; }
});

test("snapshots require usable records and reject stale or foreign account revisions", () => {
  const current = envelope();
  assert.equal(validSnapshotEnvelope(current), true);
  for (const revision of [-1, 1.5, "4", null, Infinity]) assert.equal(validSnapshotEnvelope({ ...current, revision }), false);
  for (const bad of [null, [], { ...current, userId: "other" }, { ...current, database: { ...current.database, orders: null } }]) assert.equal(validSnapshotEnvelope(bad), false);
  assert.equal(canAcceptPolledSnapshot("test-owner", 8, { userId: "test-owner", revision: 7 }), false);
  assert.equal(canAcceptPolledSnapshot("test-owner", 8, { userId: "other", revision: 9 }), false);
  assert.equal(canAcceptPolledSnapshot("test-owner", 8, { userId: "test-owner", revision: 8 }), false);
  assert.equal(canAcceptPolledSnapshot("test-owner", 8, { userId: "test-owner", revision: 9 }), true);
});

test("API reads use same-origin credentials, no cache and refuse redirects", async () => {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url, ...options }; return Response.json(envelope()); };
  try {
    const result = await requestApiJSON("session");
    assert.equal(result.payload.userId, "test-owner");
    assert.equal(captured.credentials, "same-origin");
    assert.equal(captured.cache, "no-store");
    assert.equal(captured.redirect, "error");
    for (const path of ["https://foreign.test", "//foreign.test", "../login", "\\foreign"]) await assert.rejects(requestApiJSON(path));
  } finally { globalThis.fetch = original; }
});

test("a stalled mutation times out once and is never automatically replayed", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  };
  try {
    await assert.rejects(requestApiJSON("orders", { method: "POST", body: "{}" }, 15), /حدّث البيانات/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("an expired session is recognized even when a proxy returns HTML", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>private upstream detail</html>", { status: 401 });
  try {
    const { response, payload } = await requestApiJSON("session");
    assert.equal(response.status, 401);
    assert.match(payload.error, /انتهت جلسة/);
    assert.equal(JSON.stringify(payload).includes("upstream"), false);
  } finally { globalThis.fetch = original; }
});

test("malformed successful replies cannot be accepted as saved data", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of ["<html>not json</html>", "null", "[]"]) {
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(requestApiJSON("database"), /استجابة الخادم غير مكتملة/);
    }
  } finally { globalThis.fetch = original; }
});
