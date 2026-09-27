import test from "node:test";
import assert from "node:assert/strict";
import { requestLinkedDevices, LinkedDevicesError } from "../app/lib/linked-devices.ts";

const device = (extra = {}) => ({ id: "device-a", name: "آيفون", browser: "تطبيق المدينة إكسبرس", type: "mobile", current: true, createdAt: "2026-09-27T19:00:00Z", lastActiveAt: "2026-09-27T19:00:00Z", ...extra });
function transport(t, payload, status = 200) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, ...init }); return Response.json(payload, { status }); };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test("linked devices client accepts legacy records and keeps missing area unknown", async (t) => {
  transport(t, { devices: [device()] });
  const list = await requestLinkedDevices({ action: "list" }, "owner");
  assert.equal(list.length, 1); assert.equal(list[0].location, undefined); assert.equal(list[0].label, undefined);
});
test("device rename pins account and validates exact trimmed receipt; empty clears", async (t) => {
  const calls = transport(t, { success: true, count: 1, devices: [device({ label: "آيفون نسيم" })] });
  assert.equal((await requestLinkedDevices({ action: "rename", label: "  آيفون نسيم  " }, "owner"))[0].label, "آيفون نسيم");
  assert.equal(calls[0].headers["X-Almadina-Account"], "owner"); assert.equal(calls[0].credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[0].body), { label: "آيفون نسيم" });
  globalThis.fetch = async () => Response.json({ success: true, count: 1, devices: [device({ label: "" })] });
  assert.equal((await requestLinkedDevices({ action: "rename", label: " " }))[0].label, "");
});
test("old server or contradictory rename receipts cannot report success", async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const payload of [
    { success: true, count: 1, devices: [device()] },
    { success: true, count: 1, devices: [device({ label: "قديم" })] },
    { success: true, count: 2, devices: [device({ label: "جديد" })] },
    { success: false, count: 1, devices: [device({ label: "جديد" })] },
    { success: true, count: 1, devices: [device({ label: "جديد", current: false })] },
  ]) {
    globalThis.fetch = async () => Response.json(payload);
    await assert.rejects(requestLinkedDevices({ action: "rename", label: "جديد" }), LinkedDevicesError);
  }
});
test("malformed devices and duplicate or multiple-current identities are rejected", async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const devices of [[device({ location: { city: "Nablus" } })], [device({ lastActiveAt: "bad" })], [device({ label: 123 })], [device(), device()], [device(), device({ id: "b" })], [device({ locationUpdatedAt: "never" })]]) {
    globalThis.fetch = async () => Response.json({ devices });
    await assert.rejects(requestLinkedDevices({ action: "list" }), LinkedDevicesError);
  }
});
test("invalid aliases never send requests and use UTF-16 server limit", async (t) => {
  const calls = transport(t, {});
  for (const label of ["a".repeat(81), "😀".repeat(41), "جهاز\u202Eمزيف", "test\nname"]) {
    await assert.rejects(requestLinkedDevices({ action: "rename", label }), (error) => error instanceof LinkedDevicesError && error.status === 400);
  }
  assert.equal(calls.length, 0);
});
test("revoke requires the target to disappear and propagates authentication errors", async (t) => {
  transport(t, { success: true, count: 1, devices: [device()] });
  await assert.rejects(requestLinkedDevices({ action: "revoke", deviceId: "device-a" }), LinkedDevicesError);
  globalThis.fetch = async () => Response.json({ error: "انتهت الجلسة" }, { status: 401 });
  await assert.rejects(requestLinkedDevices({ action: "list" }), (error) => error instanceof LinkedDevicesError && error.status === 401 && error.message === "انتهت الجلسة");
});
