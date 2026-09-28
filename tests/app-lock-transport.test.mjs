import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Bundle the browser helper so Node can exercise its real request promises,
// including the shared transport, without invoking a platform authenticator.
const bundle = await build({ entryPoints: ["app/lib/app-lock-client.ts"], bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
const { getAppLockStatus, createAppLock, verifySignedOutBiometricAuthentication, AppLockApiError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = original; });
}

test("app lock bootstrap keeps endpoint and successful status payload", async (t) => {
  const status = { enabled: true, biometricEnabled: false, biometricLoginReady: false };
  mockFetch(t, async (url, options) => {
    assert.equal(url, "/api/almadina/security/status");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    return Response.json(status);
  });
  assert.deepEqual(await getAppLockStatus(), status);
});

test("app lock status can cancel an in-flight fetch that ignores abort", { timeout: 1500 }, async (t) => {
  mockFetch(t, () => new Promise(() => {}));
  const controller = new AbortController();
  const request = getAppLockStatus(controller.signal);
  controller.abort();
  await assert.rejects(request, (error) => error.name === "AbortError" && error.category === "aborted");
});

test("app lock keeps HTTP status class and sanitized Arabic messages", async (t) => {
  let status = 401;
  mockFetch(t, async () => new Response("<html>private upstream problem</html>", { status }));
  for (const code of [401, 403, 429, 503]) {
    status = code;
    await assert.rejects(getAppLockStatus(), (error) => error instanceof AppLockApiError && error.status === code && /[\u0600-\u06ff]/.test(error.message) && !/html|private/.test(error.message));
  }
});

test("PIN and passkey mutations retain endpoint, body, and one-request semantics", async (t) => {
  const calls = [];
  mockFetch(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ verified: true });
  });
  await createAppLock("123456");
  await verifySignedOutBiometricAuthentication({ id: "credential", response: { signature: "test" } });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/almadina/security/pin");
  assert.equal(calls[1].url, "/api/almadina/passkey/login/verify");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { pin: "123456" });
  assert.deepEqual(JSON.parse(calls[1].options.body), { id: "credential", response: { signature: "test" } });
});
