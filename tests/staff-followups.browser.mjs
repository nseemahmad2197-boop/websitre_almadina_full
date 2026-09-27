// Real React/CSS components with a local transport fixture. Server authorization
// and SQL semantics are covered separately in followups/shared-database tests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ entryPoints: [new URL("./staff-followups.fixture.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(bundle.outputFiles[0].text); }
  if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(css); }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>متابعات المستخدمين — معاينة محلية</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
page.setDefaultTimeout(10_000);
const errors = [], calls = [];
page.on("pageerror", (error) => errors.push(error.message));
const customers = [
  { id: "customer-a", name: "أحمد الخطيب", store: "متجر الياسمين", orderCount: 2, followupCount: 2, openCount: 1 },
  { id: "customer-b", name: "سارة النجار", store: "مكتبة المدينة", orderCount: 1, followupCount: 1, openCount: 1 },
  { id: "customer-zero", name: "ليلى منصور", store: "متجر جديد", orderCount: 0, followupCount: 0, openCount: 0 },
];
const ticket = (id, merchantId, orderId, title, status = "open") => ({ id, merchantId, orderId, creatorId: merchantId, creatorName: customers.find((customer) => customer.id === merchantId)?.name || "المستخدم", title, type: "delivery-delay", description: "يرجى متابعة موعد وصول الطرد إلى المستلم.", status, response: "", createdAt: "2026-09-27T09:00:00.000Z", updatedAt: "2026-09-27T09:00:00.000Z", attachments: [] });
const tickets = [ticket("followup-a", "customer-a", "parcel-a", "تأخر تسليم طلب الياسمين"), ticket("followup-a-done", "customer-a", "parcel-a-other", "تم تأكيد عنوان المستلم", "resolved"), ticket("followup-b", "customer-b", "parcel-b", "طلب متابعة شحنة الكتب")];
let wrongScope = false, failDirectory = false, failFollowups = false;
const delayed = new Map();
function hold(key) {
  let accept, release;
  const arrived = new Promise((resolve) => { accept = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  delayed.set(key, { accept, released });
  return { arrived, release };
}
await page.route("**/api/almadina/**", async (route) => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/almadina/", ""), account = request.headers()["x-almadina-account"];
  const query = url.searchParams.get("q") || "", merchantId = url.searchParams.get("merchantId"), orderId = url.searchParams.get("orderId"), cursor = url.searchParams.get("cursor");
  calls.push({ path, account, query, merchantId, orderId, cursor });
  const fulfill = async (json, status = 200) => { try { await route.fulfill({ status, json }); } catch (error) { if (!/handled|closed|Invalid InterceptionId/i.test(String(error))) throw error; } };
  if (path === "followups/customers") {
    if (!["staff-admin", "staff-courier"].includes(account)) return fulfill({ error: "ممنوع" }, 403);
    if (failDirectory) return fulfill({ error: "تعذّر تحميل أسماء المستخدمين. حاول مجددًا." }, 503);
    if (delayed.has(query)) {
      const delay = delayed.get(query); delayed.delete(query); delay.accept(); await delay.released;
      return fulfill({ customers: [{ ...customers[0], id: "late-customer", name: "بيانات قديمة يجب ألا تظهر" }], nextCursor: null });
    }
    if (query) return fulfill({ customers: customers.filter((customer) => `${customer.name} ${customer.store}`.includes(query)), nextCursor: null });
    return fulfill(cursor ? { customers: [customers[1], customers[2]], nextCursor: null } : { customers: customers.slice(0, 2), nextCursor: "customer-page-2" });
  }
  if (path === "followups" && request.method() === "GET") {
    if (failFollowups) return fulfill({ error: "تعذّر تحميل المتابعات. حاول مجددًا." }, 503);
    const key = `followups:${account}:${merchantId}`;
    if (delayed.has(key)) { const delay = delayed.get(key); delayed.delete(key); delay.accept(); await delay.released; }
    return fulfill({ followups: wrongScope && merchantId === "customer-a" ? [tickets[2]] : tickets.filter((item) => (!merchantId || item.merchantId === merchantId) && (!orderId || item.orderId === orderId)), nextCursor: null });
  }
  if (path.endsWith("/comments") && request.method() === "GET") return fulfill({ comments: [], nextCursor: null });
  throw new Error(`Unexpected fixture API request: ${request.method()} ${url}`);
});

const card = (name) => page.locator(".customer-card").filter({ has: page.getByText(name, { exact: true }) });
const search = async (value) => { await page.getByLabel("البحث باسم المستخدم أو المتجر").fill(value); await page.getByRole("button", { name: "بحث", exact: true }).click(); };
async function noOverflow(label) {
  const bounds = await page.evaluate(() => ({ rtl: getComputedStyle(document.body).direction, width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.equal(bounds.rtl, "rtl", label);
  assert.ok(bounds.document <= bounds.width && bounds.body <= bounds.width, `${label}: ${JSON.stringify(bounds)}`);
}
async function settledFrame() { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await card(customers[0].name).waitFor();
  assert.equal(await page.locator(".customer-card").count(), 2);
  assert.deepEqual(await card(customers[0].name).locator("dd").allTextContents(), ["٢", "٢", "١"]);
  await noOverflow("360px admin directory");
  await mkdir("verification/qr-staff", { recursive: true });
  await page.getByTestId("feature-surface").screenshot({ path: "verification/qr-staff/web-staff-directory-mobile.png" });
  await page.getByRole("button", { name: "عرض المزيد من المستخدمين", exact: true }).click();
  await card(customers[2].name).waitFor();
  assert.equal(await page.locator(".customer-card").count(), 3, "pagination deduplicates existing customers");
  assert.ok(calls.some((call) => call.account === "staff-admin" && call.cursor === "customer-page-2"));
  await card(customers[2].name).click();
  await page.getByText("لا توجد متابعات حتى الآن.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "الطرود (٠)", exact: true }).click();
  await page.getByRole("heading", { name: "لا توجد طرود", exact: true }).waitFor();
  await page.getByRole("button", { name: "العودة إلى أسماء المستخدمين", exact: true }).click();
  await search("مكتبة");
  await card(customers[1].name).waitFor();
  assert.equal(await page.locator(".customer-card").count(), 1);
  await search("بلا نتائج");
  await page.getByRole("heading", { name: "لا توجد نتائج", exact: true }).waitFor();
  await search("");
  await card(customers[0].name).click();
  await page.getByRole("button", { name: /تأخر تسليم طلب الياسمين/ }).waitFor();
  assert.equal(await page.locator(".followup-row").count(), 2);
  assert.ok(calls.some((call) => call.account === "staff-admin" && call.merchantId === "customer-a"));
  await page.setViewportSize({ width: 1280, height: 900 });
  await noOverflow("desktop selected customer");
  await page.getByTestId("feature-surface").screenshot({ path: "verification/qr-staff/web-staff-customer-desktop.png" });
  await page.getByRole("button", { name: /تأخر تسليم طلب الياسمين/ }).click();
  await page.getByRole("dialog", { name: "تفاصيل المتابعة" }).waitFor();
  await page.getByRole("button", { name: "حفظ الرد والحالة", exact: true }).waitFor();
  await page.getByRole("button", { name: "فتح تفاصيل الطرد", exact: true }).click();
  await page.locator(".order-detail-page").waitFor();
  assert.match(await page.locator(".detail-hero").innerText(), /ALX-20260101/);
  assert.ok(calls.some((call) => call.orderId === "parcel-a"));
  assert.equal(await page.getByRole("button", { name: "إنشاء متابعة", exact: true }).count(), 0, "admin parcel detail is read/respond only");
  await page.getByTestId("open-directory").click();
  await card(customers[0].name).click();
  await page.getByRole("button", { name: "الطرود (٢)", exact: true }).click();
  assert.equal(await page.locator(".customer-parcels .order-card").count(), 2);
  assert.equal(await page.locator(".customer-parcels").getByText("ALX-20260104", { exact: true }).count(), 0);
  await page.locator(".customer-parcels .order-card").filter({ hasText: "ALX-20260102" }).click();
  await page.locator(".order-detail-page").waitFor();
  assert.match(await page.locator(".detail-hero").innerText(), /ALX-20260102/);

  await page.getByTestId("account-courier").click();
  await page.getByTestId("open-directory").click();
  await card(customers[0].name).waitFor();
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow("360px courier directory");
  await page.getByRole("button", { name: "عرض المزيد من المستخدمين", exact: true }).click();
  await card(customers[2].name).waitFor();
  assert.ok(calls.some((call) => call.account === "staff-courier" && call.cursor === "customer-page-2"));
  await search("سارة");
  await card(customers[1].name).click();
  await page.getByRole("button", { name: /طلب متابعة شحنة الكتب/ }).waitFor();
  await page.getByRole("button", { name: "الطرود (١)", exact: true }).click();
  await page.locator(".customer-parcels .order-card").click();
  await page.locator(".order-detail-page").waitFor();
  assert.match(await page.locator(".detail-hero").innerText(), /ALX-20260103/, "courier can open an unassigned parcel");
  assert.equal(await page.getByRole("button", { name: /حفظ الحالة|إضافة ملاحظة/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "إنشاء متابعة", exact: true }).count(), 0, "courier/employee parcel detail hides create");
  await noOverflow("360px courier parcel detail");
  await page.getByTestId("open-home").click();
  assert.equal(await page.locator(".employee-order-card").count(), 3);
  await page.getByRole("button", { name: "المسندة إليّ", exact: true }).click();
  assert.equal(await page.locator(".employee-order-card").count(), 1);
  await page.getByRole("button", { name: "جميع طرود المستخدمين", exact: true }).click();
  assert.equal(await page.locator(".employee-order-card").count(), 3);
  await noOverflow("360px employee dashboard");
  await page.getByRole("button", { name: "متابعات المستخدمين", exact: true }).click();

  // Release an older search only after the replacement result is visible.
  const slowSearch = hold("بحث متأخر");
  await search("بحث متأخر"); await slowSearch.arrived;
  await search("سارة"); await card(customers[1].name).waitFor();
  slowSearch.release(); await settledFrame();
  assert.equal(await page.getByText("بيانات قديمة يجب ألا تظهر", { exact: true }).count(), 0);
  assert.equal(await page.locator(".customer-card").count(), 1);

  // A selected customer response cannot arrive into the next merchant account.
  await search(""); await card(customers[0].name).waitFor();
  const slowTickets = hold("followups:staff-courier:customer-a");
  await card(customers[0].name).click(); await slowTickets.arrived;
  const callsBeforeSwitch = calls.length;
  await page.getByTestId("account-merchant").click();
  await page.getByRole("heading", { name: "هذه الصفحة لفريق المتابعة", exact: true }).waitFor();
  slowTickets.release(); await settledFrame();
  assert.equal(await page.locator(".followup-row, .customer-card").count(), 0);
  assert.ok(calls.slice(callsBeforeSwitch).every((call) => call.account !== "customer-a"), "merchant must not request staff directory API");

  await page.getByTestId("account-admin").click(); await card(customers[0].name).waitFor();
  const slowAccount = hold("حساب متأخر");
  await search("حساب متأخر"); await slowAccount.arrived;
  await page.getByTestId("account-courier").click(); await card(customers[0].name).waitFor();
  slowAccount.release(); await settledFrame();
  assert.equal(await page.getByLabel("البحث باسم المستخدم أو المتجر").inputValue(), "");
  assert.equal(await page.getByText("بيانات قديمة يجب ألا تظهر", { exact: true }).count(), 0);

  // Older or malformed transports returning a different customer's ticket fail closed.
  wrongScope = true;
  await card(customers[0].name).click();
  await page.getByRole("alert").filter({ hasText: "تعذّر قراءة المتابعات." }).waitFor();
  assert.equal(await page.locator(".followup-row").count(), 0);
  wrongScope = false;
  assert.ok(calls.every((call) => ["staff-admin", "staff-courier"].includes(call.account)));

  // A failed first directory/list request shows a recoverable error, never a
  // misleading empty result. Retry and navigation each fetch current data.
  failDirectory = true;
  await page.getByRole("button", { name: "العودة إلى أسماء المستخدمين", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "تعذّر تحميل أسماء المستخدمين" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "لا توجد نتائج", exact: true }).count(), 0);
  failDirectory = false;
  await page.getByRole("button", { name: "تحديث المستخدمين", exact: true }).click();
  await card(customers[0].name).waitFor();
  failFollowups = true;
  await card(customers[0].name).click();
  await page.getByRole("alert").filter({ hasText: "تعذّر تحميل المتابعات" }).waitFor();
  assert.equal(await page.locator(".followup-empty").count(), 0);
  failFollowups = false;
  await page.getByRole("button", { name: "تحديث المتابعات", exact: true }).click();
  await page.getByRole("button", { name: /تأخر تسليم طلب الياسمين/ }).waitFor();
  assert.equal(await page.locator(".followup-row").count(), 2);
  await page.getByTestId("account-merchant").click();
  await page.getByTestId("open-parcel").click();
  await page.getByRole("button", { name: "إنشاء متابعة", exact: true }).waitFor();
  await page.getByRole("button", { name: "إنشاء متابعة", exact: true }).click();
  await page.getByRole("dialog", { name: "إنشاء متابعة", exact: true }).waitFor();
  // Simulate an authentication change while the modal owns pointer focus.
  await page.getByTestId("account-admin").evaluate((button) => button.click());
  await page.getByRole("dialog", { name: "إنشاء متابعة", exact: true }).waitFor({ state: "detached" });
  assert.equal(await page.getByRole("dialog", { name: "إنشاء متابعة", exact: true }).count(), 0, "staff switch closes merchant composer");
  assert.equal(await page.getByRole("button", { name: "إنشاء متابعة", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: real staff components under StrictMode; first-entry admin/courier directory and scoped followups, counts, search/pagination, empty customer, parcel/detail navigation, all/assigned employee parcels, merchant denial, stale search/account/ticket responses, cross-customer rejection, failed initial request recovery, staff create hidden, merchant create retained and account-switch composer cleanup; 360px and 1280px RTL without overflow.");
} catch (error) {
  console.error("UI errors:", errors);
  console.error((await page.locator("body").innerText()).slice(0, 5000));
  await page.screenshot({ path: "/tmp/almadina-staff-followups-failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
