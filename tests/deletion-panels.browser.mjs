// Production deletion panels, real React/Chromium, simulated read-only transport.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ entryPoints: [new URL("./deletion-panels.fixture.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("content-type", "application/javascript"); return response.end(bundle.outputFiles[0].text); }
  if (request.url === "/fixture.css") { response.setHeader("content-type", "text/css"); return response.end(css); }
  response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = []; page.on("pageerror", error => errors.push(error.message));
const deferred = () => { let arrive, release; return { reached: new Promise(resolve => { arrive = resolve; }), gate: new Promise(resolve => { release = resolve; }), arrive, release }; };
let firstRead = deferred(), holdAdmin = null, mode = "error", adminMode = "error", adminName = "حساب المتابعة الأول";
const request = { id: "DEL-001", status: "pending", createdAt: "2026-09-28T00:00:00Z", reviewDueAt: "2026-10-05T00:00:00Z", message: "طلبك قيد المراجعة", completedAt: null };
const eligibility = { eligible: false, activeOrderCount: 1, unsettledCollectionCount: 0, unsettledOrderCount: 1 };
await page.route("**/api/almadina/**", async route => {
  const path = new URL(route.request().url()).pathname.replace("/api/almadina/", "");
  assert.equal(route.request().method(), "GET", "Retry must perform a read, never replay a deletion mutation");
  const reply = async (json, status = 200) => { try { await route.fulfill({ status, json }); } catch (error) { if (!/closed|handled|Interception/i.test(String(error))) throw error; } };
  if (path === "account/deletion-request") {
    if (firstRead) { const wait = firstRead; wait.arrive(); await wait.gate; }
    if (mode === "error") return reply({ error: "خطأ تجريبي" }, 503);
    if (mode === "unauthorized") return reply({ error: "سجل الدخول" }, 401);
    return reply({ request, eligibility, policy: {} });
  }
  if (path === "admin/deletion-requests") {
    const account = { id: "merchant", name: adminName, email: "merchant@example.test", role: "merchant" };
    if (holdAdmin) { const wait = holdAdmin; holdAdmin = null; wait.arrive(); await wait.gate; }
    if (adminMode === "error") return reply({ error: "خطأ تجريبي" }, 503);
    return reply({ requests: [{ request, account, eligibility }] });
  }
  throw new Error(`Unexpected request ${path}`);
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`); await firstRead.reached;
  await page.locator(".loading-skeleton--detail").waitFor();
  assert.equal(await page.getByRole("button", { name: "تقديم طلب حذف الحساب", exact: true }).count(), 0);
  firstRead.release(); firstRead = null;
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "تقديم طلب حذف الحساب", exact: true }).count(), 0, "Failed initial read cannot imply no existing request");
  mode = "unauthorized"; await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await page.getByRole("button", { name: "تقديم طلب حذف الحساب", exact: true }).waitFor();
  mode = "normal"; await page.getByRole("button", { name: "تحديث حالة الطلب", exact: true }).click();
  await page.getByText("طلبك قيد المراجعة", { exact: true }).waitFor();
  mode = "error"; await page.getByRole("button", { name: "تحديث حالة الطلب", exact: true }).click();
  await page.getByRole("alert").waitFor(); assert.equal(await page.getByText("طلبك قيد المراجعة", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "طلبات الإدارة", exact: true }).click();
  await page.getByRole("alert").waitFor(); assert.equal(await page.getByText("لا توجد طلبات حذف حساب.", { exact: true }).count(), 0);
  adminMode = "normal"; await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await page.getByRole("heading", { name: /حساب المتابعة الأول/ }).waitFor();
  adminMode = "error"; await page.getByRole("button", { name: "تحديث الطلبات", exact: true }).click();
  await page.getByRole("alert").waitFor(); assert.equal(await page.getByRole("heading", { name: /حساب المتابعة الأول/ }).count(), 1);
  adminMode = "normal"; const stale = deferred(); holdAdmin = stale;
  await page.getByRole("button", { name: "تحديث الطلبات", exact: true }).click(); await stale.reached;
  await page.locator(".server-refresh").waitFor();
  adminName = "حساب المسؤول الثاني"; await page.getByRole("button", { name: "تبديل المسؤول", exact: true }).click();
  await page.getByRole("heading", { name: /حساب المسؤول الثاني/ }).waitFor(); stale.release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole("heading", { name: /حساب المتابعة الأول/ }).count(), 0);
  assert.deepEqual(errors, []);
  await mkdir("verification/server-experience", { recursive: true });
  await page.screenshot({ path: "verification/server-experience/deletion-admin-mobile.png", fullPage: true });
  console.log("PASS: deletion first-load skeleton, failed initial read suppresses false empty/form, public 401 permits sign-in form, retry is GET only, status and admin queue retained on refresh error, account-switch stale response ignored.");
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
