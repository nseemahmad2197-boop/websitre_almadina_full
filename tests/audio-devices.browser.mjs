// Actual production React/CSS/client-validation in Chromium with explicitly
// simulated accounts, transport, IP-derived regions and microphone input.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const evidence = "verification/audio-devices";
const bundle = await build({ entryPoints: [new URL("./audio-devices.fixture.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(bundle.outputFiles[0].text); }
  if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(css); }
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Permissions-Policy", "microphone=(self)");
  response.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة محلية للأجهزة والصوت</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = [], calls = [], downloads = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("download", (download) => downloads.push(download));
let now = "2026-09-27T19:30:00.000Z";
const device = (id, name, current, details = {}) => ({ id, name, type: "mobile", browser: "تطبيق المدينة إكسبرس", current, createdAt: now, lastActiveAt: now, label: "", ...details });
let devices = [
  device("iphone", "آيفون", false, { platform: "ios", label: "آيفون نسيم", model: "iPhone", osVersion: "26.0", appVersion: "1.0.22", location: "نابلس، فلسطين", locationSource: "ip", locationUpdatedAt: now }),
  device("android", "أندرويد", false, { platform: "android", label: "هاتف العمل", model: "Samsung SM-S928B", osVersion: "16", appVersion: "2.9.19", location: null, locationSource: "unknown", locationUpdatedAt: null }),
  device("browser", "Mac", true, { type: "desktop", browser: "Safari", platform: "macos", location: "رام الله، فلسطين", locationSource: "ip", locationUpdatedAt: now }),
];
const legacy = device("legacy", "جهاز مسجل سابقًا", false, { type: "unknown", browser: "غير معروف", label: undefined });
const otherDevices = [device("other-browser", "جهاز الحساب الآخر", true, { browser: "Firefox", type: "desktop" })];
let mode = "normal", holdGet = null, holdRename = null;
function deferred() { let release, arrived; return { gate: new Promise((resolve) => { release = resolve; }), reached: new Promise((resolve) => { arrived = resolve; }), release, arrived }; }
const wav = Buffer.alloc(44 + 16000);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
const audio = { id: "audio-1", name: "ملاحظة صوتية.wav", mimeType: "audio/wav", size: wav.length, chunkCount: 1 };
const ticket = { id: "followup-audio", orderId: "parcel-1", merchantId: "owner", creatorId: "owner", creatorName: "مستخدم المعاينة", ticketNumber: "TK-34001", trackingNumber: "ALX-TEST-001", title: "متابعة الطرد بالصوت", type: "delivery-delay", description: "تسجيل تجريبي داخل الموقع.", status: "open", response: "", createdAt: now, updatedAt: now, canEdit: true, attachments: [audio] };

await page.route("**/api/almadina/**", async (route) => {
  const request = route.request(), path = new URL(request.url()).pathname.replace("/api/almadina/", ""), account = request.headers()["x-almadina-account"], body = request.postDataJSON();
  calls.push({ path, method: request.method(), account, body });
  const reply = async (json, status = 200) => { try { await route.fulfill({ status, json }); } catch (error) { if (!/closed|handled|Interception/i.test(String(error))) throw error; } };
  if (path === "security/devices") {
    if (account === "other") return reply({ devices: otherDevices, count: 1 });
    const snapshot = mode === "legacy" ? [legacy, devices.find((item) => item.current)] : structuredClone(devices);
    if (holdGet) { const wait = holdGet; holdGet = null; wait.arrived(); await wait.gate; }
    if (mode === "load-error") return reply({ error: "خطأ تحميل تجريبي" }, 503);
    return reply({ devices: snapshot, count: snapshot.length });
  }
  if (path === "security/devices/current") {
    assert.deepEqual(Object.keys(body), ["label"]);
    assert.equal(account, "owner");
    if (holdRename) { const wait = holdRename; holdRename = null; wait.arrived(); await wait.gate; }
    if (mode === "old-server") return reply({ success: true, devices: devices.map((item) => ({ ...item, label: undefined })), count: devices.length });
    devices = devices.map((item) => item.current ? { ...item, label: body.label } : item);
    return reply({ success: true, devices, count: devices.length });
  }
  if (path === "security/devices/revoke") {
    if (mode === "revoke-error") return reply({ error: "تعذّر تسجيل الخروج مؤقتًا" }, 503);
    devices = devices.filter((item) => item.id !== body.deviceId);
    return reply({ success: true, devices, count: devices.length });
  }
  if (path === "followups") return reply({ followups: [ticket], nextCursor: null });
  if (path === "followups/followup-audio") return reply({ followup: ticket });
  if (path.endsWith("/comments")) return reply({ comments: [{ id: "comment-audio", followupId: ticket.id, authorId: "owner", authorName: "مستخدم المعاينة", authorRole: "merchant", text: "رسالة صوتية تجريبية", createdAt: now, attachments: [audio] }], nextCursor: null });
  if (path === "followups/attachments/audio-1") return reply({ attachment: audio, index: 0, chunkCount: 1, dataBase64: wav.toString("base64") });
  throw new Error(`Unexpected fixture request ${path}`);
});

const card = (name) => page.locator(".linked-device-card").filter({ has: page.getByText(name, { exact: true }) });
async function refresh() { await page.getByRole("button", { name: "تحديث", exact: true }).click(); }
async function noOverflow(label) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label); }
async function rename(label) { await page.getByRole("button", { name: "تسمية هذا الجهاز", exact: true }).click(); await page.getByLabel("اسم الجهاز (اختياري)", { exact: true }).fill(label); await page.getByRole("button", { name: "حفظ اسم الجهاز", exact: true }).click(); }
async function playAudio(locator) {
  await locator.waitFor();
  await locator.evaluate(async (element) => { await element.play(); });
  await page.waitForFunction(() => [...document.querySelectorAll("audio")].some((element) => !element.paused && element.currentTime > 0));
  assert.equal(await locator.evaluate((element) => element.controls), true);
  await locator.evaluate((element) => element.pause());
}

try {
  await mkdir(evidence, { recursive: true });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await card("آيفون نسيم").waitFor();
  assert.match(await card("آيفون نسيم").innerText(), /آيفون · iOS[\s\S]*نابلس، فلسطين/);
  assert.match(await card("هاتف العمل").innerText(), /أندرويد · Android[\s\S]*Samsung SM-S928B[\s\S]*غير متاحة/);
  assert.equal(await card("آيفون نسيم").getByRole("button", { name: "تسمية هذا الجهاز" }).count(), 0);
  assert.equal(await card("Mac").getByRole("button", { name: "تسجيل الخروج", exact: true }).count(), 0);
  assert.match(await page.locator(".security-note").innerText(), /ليس إثباتًا لهوية مالكه[\s\S]*VPN[\s\S]*GPS/);
  for (const width of [320, 390, 840, 1280]) { await page.setViewportSize({ width, height: 950 }); await noOverflow(`device view ${width}`); }
  await page.getByTestId("feature-surface").screenshot({ path: `${evidence}/web-devices-desktop.png`, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("feature-surface").screenshot({ path: `${evidence}/web-devices-mobile.png`, animations: "disabled" });
  await page.getByTestId("theme").click();
  await page.getByTestId("feature-surface").screenshot({ path: `${evidence}/web-devices-dark-mobile.png`, animations: "disabled" });
  await page.getByTestId("theme").click();

  await rename("متصفح نسيم"); await page.getByRole("dialog").waitFor({ state: "hidden" }); await card("متصفح نسيم").waitFor();
  await refresh(); await card("متصفح نسيم").waitFor();
  assert.ok(calls.some((call) => call.path === "security/devices/current" && call.body.label === "متصفح نسيم" && call.account === "owner"));
  await rename(""); await page.getByRole("dialog").waitFor({ state: "hidden" }); await card("Mac").waitFor();
  mode = "old-server"; await rename("اسم غير مؤكد");
  await page.getByTestId("transport-error").filter({ hasText: "لم يؤكد الخادم" }).waitFor();
  assert.equal(await card("اسم غير مؤكد").count(), 0); assert.equal(await page.getByRole("dialog").count(), 1);
  await page.getByRole("button", { name: "إغلاق", exact: true }).click(); mode = "normal";

  // Reject malformed metadata before rendering; preserve legacy records safely.
  mode = "legacy"; await refresh(); await card("جهاز مسجل سابقًا").waitFor();
  assert.match(await card("جهاز مسجل سابقًا").innerText(), /غير متاحة/);
  mode = "load-error"; await refresh(); await page.getByRole("heading", { name: "تعذّر تحميل الأجهزة" }).waitFor();
  mode = "normal"; await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click(); await card("آيفون نسيم").waitFor();

  mode = "revoke-error";
  await card("هاتف العمل").getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await page.getByRole("button", { name: "تسجيل خروج الجهاز", exact: true }).click();
  await page.getByTestId("transport-error").filter({ hasText: "تعذّر تسجيل الخروج" }).waitFor();
  assert.equal(await card("هاتف العمل").count(), 1);
  mode = "normal"; await page.getByRole("button", { name: "تسجيل خروج الجهاز", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" }); assert.equal(await card("هاتف العمل").count(), 0);

  const slow = deferred(); holdGet = slow; await refresh(); await slow.reached;
  await page.getByTestId("account-other").click(); await card("جهاز الحساب الآخر").waitFor();
  slow.release(); await page.waitForTimeout(100);
  assert.equal(await card("آيفون نسيم").count(), 0, "old account GET cannot replace next account devices");
  await page.getByTestId("account-owner").click(); await card("Mac").waitFor();
  const saving = deferred(); holdRename = saving; await rename("طلب الحساب السابق"); await saving.reached;
  // A session change can arrive while the modal blocks pointer navigation.
  await page.getByTestId("account-other").evaluate((button) => button.click()); await card("جهاز الحساب الآخر").waitFor(); saving.release(); await page.waitForTimeout(100);
  assert.equal(await card("طلب الحساب السابق").count(), 0, "old account mutation cannot replace next account devices");
  assert.equal(await page.getByRole("dialog").count(), 0);

  await page.getByTestId("account-owner").click(); await page.getByTestId("show-audio").click();
  await page.getByRole("button", { name: /متابعة الطرد بالصوت/ }).click();
  const dialog = page.getByRole("dialog", { name: "تفاصيل المتابعة", exact: true }); await dialog.waitFor();
  await dialog.getByRole("button", { name: /ملاحظة صوتية.wav/ }).first().click();
  await playAudio(dialog.locator("audio").first());
  await dialog.getByRole("button", { name: /ملاحظة صوتية.wav/ }).last().click();
  await playAudio(dialog.locator(".followup-comment audio"));
  await dialog.screenshot({ path: `${evidence}/web-audio-conversation-mobile.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.getByRole("button", { name: "إنشاء متابعة", exact: true }).click();
  await page.getByRole("button", { name: "بدء التسجيل", exact: true }).click();
  await page.getByRole("button", { name: "إيقاف التسجيل", exact: true }).waitFor(); await page.waitForTimeout(650);
  await page.getByRole("button", { name: "إيقاف التسجيل", exact: true }).click();
  await page.locator(".followup-draft-file audio").waitFor();
  await playAudio(page.locator(".followup-draft-file audio"));
  await page.getByRole("dialog").screenshot({ path: `${evidence}/web-audio-draft-mobile.png`, animations: "disabled" });
  assert.equal(browser.contexts()[0].pages().length, 1, "audio playback and recording open no external page");
  assert.equal(downloads.length, 0, "audio playback does not start a download");
  assert.deepEqual(errors, []);
  const result = { result: "pass", browser: browser.version(), fixtures: true, checks: ["iOS/Android/model/version labels", "trusted area only and unknown fallback", "legacy sessions", "optional current-only rename/clear", "old-backend receipt rejected", "revoke failure/retry", "account switch during load/rename", "320-1280px RTL/light/dark", "private ticket/comment WAV playback advances in-page", "synthetic microphone recording and draft playback", "no external page/download"] };
  await writeFile(`${evidence}/web-browser-results.json`, JSON.stringify(result, null, 2) + "\n");
  console.log("PASS: " + result.checks.join("; ") + ". Actual Chromium with simulated transport and microphone; no production account/device test.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
