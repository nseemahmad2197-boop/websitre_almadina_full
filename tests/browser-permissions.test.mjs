import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadClient(name) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../app/lib/${name}.ts`, import.meta.url))], bundle: true, write: false, format: "esm", target: "es2022", logLevel: "silent" });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
const client = await loadClient("phone-notifications");
const permissions = await loadClient("browser-permissions");

function device(t, permission = "default", optedIn = false) {
  const calls = { prompts: 0, subscriptions: 0, links: 0, unlinks: 0 };
  const saved = new Map(optedIn ? [["almadina-phone-push-enabled", "true"]] : []);
  let subscription = null;
  const system = {
    permission,
    requestPermission: async () => { calls.prompts += 1; system.permission = "granted"; return "granted"; },
  };
  const worker = { pushManager: {
    getSubscription: async () => subscription,
    subscribe: async (options) => {
      assert.equal(system.permission, "granted", "a saved preference must never bypass system permission");
      calls.subscriptions += 1;
      subscription = {
        options, endpoint: "https://push.example.test/device", expirationTime: null,
        getKey: () => new Uint8Array([1, 2, 3]).buffer,
        unsubscribe: async () => { subscription = null; return true; },
      };
      return subscription;
    },
  } };
  const replacements = {
    Notification: system,
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    window: { isSecureContext: true, matchMedia: () => ({ matches: false }), PushManager: {}, Notification: system, setTimeout, clearTimeout },
    navigator: { userAgent: "Android", platform: "Linux", maxTouchPoints: 1,
      serviceWorker: { register: async () => worker, ready: Promise.resolve(worker) },
      permissions: { query: async () => ({ state: system.permission === "default" ? "prompt" : system.permission }) },
    },
    fetch: async (url) => {
      if (url.endsWith("push/config")) return Response.json({ configured: true, publicKey: "AQID" });
      if (url.endsWith("push/subscribe")) calls.links += 1;
      else if (url.endsWith("push/unsubscribe")) calls.unlinks += 1;
      else assert.fail(`Unexpected request: ${url}`);
      return Response.json({ ok: true });
    },
  };
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  return { calls, saved, system, expire: () => { subscription = null; } };
}

test("permission is requested on activation once and reused on later visits", async (t) => {
  const { calls } = device(t);
  assert.equal((await client.inspectPhoneNotifications()).permission, "default");
  assert.equal(calls.prompts, 0);
  await client.enablePhoneNotifications();
  assert.equal((await client.inspectPhoneNotifications()).subscribed, true);
  await client.enablePhoneNotifications();
  assert.equal(calls.prompts, 1);
  assert.equal(calls.subscriptions, 1);
});

test("an existing system grant is reused without prompting or auto-enabling an unknown preference", async (t) => {
  const { calls } = device(t, "granted");
  assert.equal((await client.inspectPhoneNotifications()).subscribed, false);
  assert.equal(calls.subscriptions, 0);
  await client.enablePhoneNotifications();
  assert.equal(calls.prompts, 0);
  assert.equal(calls.subscriptions, 1);
});

test("denial and revocation override a saved preference without repeated prompts", async (t) => {
  const { calls, system } = device(t, "granted", true);
  await client.inspectPhoneNotifications();
  system.permission = "denied";
  const state = await client.inspectPhoneNotifications();
  assert.equal(state.permission, "denied");
  assert.equal(state.subscribed, false);
  await assert.rejects(client.enablePhoneNotifications(), (error) => error.code === "denied");
  assert.equal(calls.prompts, 0);
  assert.equal(calls.subscriptions, 1);
});

test("a missing subscription recovers only with an existing grant and opt-in; disabling persists", async (t) => {
  const { calls, expire, system, saved } = device(t, "granted", true);
  assert.equal((await client.inspectPhoneNotifications()).subscribed, true);
  expire();
  assert.equal((await client.inspectPhoneNotifications()).subscribed, true);
  await client.disablePhoneNotifications();
  assert.equal((await client.inspectPhoneNotifications()).subscribed, false);
  assert.equal(system.permission, "granted");
  assert.equal(saved.get("almadina-phone-push-enabled"), "false");
  assert.equal(calls.subscriptions, 2);
  assert.equal(calls.prompts, 0);
});

test("camera and location use fresh browser state and unsupported permission queries fall back", async (t) => {
  const { system } = device(t, "granted");
  assert.equal(await permissions.readBrowserPermission("camera"), "granted");
  system.permission = "denied";
  assert.equal(await permissions.readBrowserPermission("camera"), "denied");
  assert.equal(await permissions.readBrowserPermission("geolocation"), "denied");
  navigator.permissions.query = async () => { throw new TypeError("Unsupported permission"); };
  assert.equal(await permissions.readBrowserPermission("camera"), undefined);
});

test("overlapping permission refreshes cannot undo an explicit subscription disable", async (t) => {
  const { calls, saved } = device(t, "granted", true);
  await Promise.all([client.inspectPhoneNotifications(), client.inspectPhoneNotifications(), client.disablePhoneNotifications()]);
  assert.equal((await client.inspectPhoneNotifications()).subscribed, false);
  assert.equal(saved.get("almadina-phone-push-enabled"), "false");
  assert.equal(calls.subscriptions, 1);
  assert.equal(calls.unlinks, 1);
  assert.equal(calls.prompts, 0);
});
