// Real component reload tests. Production bootstrap/account ownership is covered
// by the navigation and full-application browser suites; this fixture isolates details.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ entryPoints: [new URL("./navigation-details.fixture.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const css = (await readFile(new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(bundle.outputFiles[0].text); }
  if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(css); }
  response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined, args: ["--no-sandbox", "--disable-gpu", "--disable-software-rasterizer"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10_000);
const errors = [], calls = [];
page.on("pageerror", (error) => errors.push(error.message));
const customers = ["merchant-a", "merchant-b", "merchant-zero"].map((id) => ({ id, name: id, store: `متجر ${id}`, orderCount: id === "merchant-zero" ? 0 : 1, followupCount: id === "merchant-zero" ? 0 : 1, openCount: id === "merchant-zero" ? 0 : 1 }));
const followup = (merchantId) => ({ id: `followup-${merchantId}`, merchantId, orderId: `parcel-${merchantId}`, creatorId: merchantId, creatorName: merchantId, title: `متابعة ${merchantId}`, type: "delivery-delay", description: `تفاصيل ${merchantId}`, status: "open", response: "", canDelete: true, createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z", attachments: [] });
let detailMode = "ok", customerMode = "ok", releaseDetail = null, detailArrived = null;
await page.route("**/api/almadina/**", async (route) => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/api/almadina/", ""), account = request.headers()["x-almadina-account"];
  calls.push({ path, account, query: url.searchParams.get("q") });
  const fulfill = async (json, status = 200) => { try { await route.fulfill({ status, json }); } catch (error) { if (!/handled|closed|Invalid InterceptionId/i.test(String(error))) throw error; } };
  if (path === "followups/customers") return fulfill({ customers: customerMode === "foreign" ? [customers[1]] : customers.filter((entry) => !url.searchParams.get("q") || entry.id.includes(url.searchParams.get("q"))), nextCursor: null });
  if (path === "followups") { const id = url.searchParams.get("merchantId") ?? (account.startsWith("merchant") ? account : "merchant-a"); return fulfill({ followups: id === "merchant-zero" ? [] : [followup(id)], nextCursor: null }); }
  if (path.endsWith("/comments")) return fulfill({ comments: [], nextCursor: null });
  if (path.startsWith("followups/") && request.method() === "GET") {
    if (detailMode === "hold") { await new Promise((resolve) => { releaseDetail = resolve; detailArrived?.(); }); }
    if (detailMode === "unavailable") return fulfill({ error: "المتابعة غير متاحة" }, 404);
    if (detailMode === "server") return fulfill({ error: "تعذّر الاتصال بالخادم" }, 503);
    return fulfill({ followup: followup(detailMode === "foreign" ? "merchant-b" : path.slice("followups/followup-".length)) });
  }
  throw new Error(`Unexpected request: ${request.method()} ${path}`);
});
const dialog = () => page.getByRole("dialog", { name: "تفاصيل المتابعة", exact: true });
const details = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("navigation-detail-fixture")).details);
async function seed(accountId, view, patch) {
  await page.evaluate(({ accountId, view, patch }) => sessionStorage.setItem("navigation-detail-fixture", JSON.stringify({ accountId, view, details: { followupId: null, followupOrderId: null, customerId: null, invoiceId: null, customerTab: "followups", adminTab: "orders", ...patch } })), { accountId, view, patch });
  await page.reload();
}
const savedFollowup = { followupId: "followup-merchant-a", followupOrderId: "parcel-merchant-a" };
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".followup-row").click();
  await dialog().getByRole("heading", { name: "متابعة merchant-a", exact: true }).waitFor();
  assert.equal((await details()).followupId, "followup-merchant-a");
  await page.reload();
  await dialog().getByText("تفاصيل merchant-a", { exact: true }).waitFor();
  assert.ok(calls.some((call) => call.path === "followups/followup-merchant-a" && call.account === "merchant-a"));
  await dialog().getByRole("button", { name: "رجوع إلى المتابعات", exact: true }).click();
  await page.reload(); await page.locator(".followup-row").waitFor();
  assert.equal(await dialog().count(), 0); assert.equal((await details()).followupId, null);

  detailMode = "server";
  await seed("merchant-a", "followups", savedFollowup);
  await dialog().getByRole("alert").waitFor();
  assert.equal(await dialog().getByRole("button", { name: "حذف المتابعة", exact: true }).count(), 0);
  detailMode = "ok"; await dialog().getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await dialog().getByText("تفاصيل merchant-a", { exact: true }).waitFor();
  await page.getByTestId("invalidate-followup").evaluate((button) => button.click());
  await dialog().waitFor({ state: "detached" });
  assert.equal((await details()).followupId, null, "central invalidation hides and clears an already loaded detail");
  for (const mode of ["foreign", "unavailable"]) {
    detailMode = mode; await seed("merchant-a", "followups", savedFollowup);
    await page.getByText("لم تعد هذه المتابعة متاحة. يمكنك اختيار متابعة أخرى من القائمة.", { exact: true }).waitFor();
    assert.equal(await dialog().count(), 0); assert.equal((await details()).followupId, null);
  }
  detailMode = "hold";
  const arrived = new Promise((resolve) => { detailArrived = resolve; });
  await seed("merchant-a", "followups", savedFollowup); await arrived;
  // Simulate an external account/session change while the blocking read modal is open.
  await page.getByTestId("account-merchant-b").evaluate((button) => button.click());
  detailMode = "ok"; releaseDetail();
  await page.locator(".followup-row").filter({ hasText: "متابعة merchant-b" }).waitFor();
  assert.equal(await dialog().count(), 0); assert.equal((await details()).followupId, null);
  assert.equal(await page.getByText("تفاصيل merchant-a", { exact: true }).count(), 0);

  await seed("merchant-a", "collections", {});
  await page.locator(".collection-card").filter({ hasText: "#invoice-a" }).click();
  await page.reload(); await page.getByRole("dialog", { name: "تفاصيل فاتورة التحصيل", exact: true }).waitFor();
  assert.equal((await details()).invoiceId, "invoice-a");
  assert.equal(await page.getByRole("dialog", { name: "كود التحقق", exact: true }).count(), 0);
  for (const invoiceId of ["invoice-b", "invoice-hidden", "deleted-invoice"]) {
    await seed("merchant-a", "collections", { invoiceId });
    await page.locator(".collection-card").waitFor();
    assert.equal(await page.getByRole("dialog").count(), 0); assert.equal((await details()).invoiceId, null);
  }

  await seed("admin", "admin", {});
  await page.locator(".admin-tabs").getByRole("tab", { name: "المستخدمون", exact: true }).click();
  await page.reload(); await page.locator(".admin-user-list").waitFor();
  assert.equal((await details()).adminTab, "users");
  assert.equal(await page.getByRole("dialog").count(), 0);

  await seed("admin", "customer-followups", {});
  await page.locator(".customer-card").filter({ has: page.getByText("merchant-a", { exact: true }) }).click();
  await page.getByRole("button", { name: "الطرود (١)", exact: true }).click();
  await page.reload(); await page.locator(".customer-parcels .order-card").waitFor();
  assert.equal((await details()).customerId, "merchant-a"); assert.equal((await details()).customerTab, "parcels");
  await page.getByRole("button", { name: "المتابعات", exact: true }).click();
  await page.locator(".followup-row").click(); await page.reload();
  await dialog().getByText("تفاصيل merchant-a", { exact: true }).waitFor();
  assert.equal((await details()).customerId, "merchant-a");
  await dialog().getByRole("button", { name: "رجوع إلى المتابعات", exact: true }).click();
  await page.getByRole("button", { name: "العودة إلى أسماء المستخدمين", exact: true }).click();
  assert.equal((await details()).customerId, null); assert.equal((await details()).followupId, null);

  await seed("courier", "customer-followups", { customerId: "merchant-zero", customerTab: "parcels" });
  await page.getByRole("heading", { name: "merchant-zero", exact: true }).waitFor();
  assert.ok(calls.some((call) => call.path === "followups/customers" && call.query === "merchant-zero" && call.account === "courier"));
  await page.getByRole("heading", { name: "لا توجد طرود", exact: true }).waitFor();
  customerMode = "foreign";
  await seed("courier", "customer-followups", { customerId: "merchant-zero" });
  await page.getByText("لم يعد هذا المستخدم متاحًا في القائمة.", { exact: true }).waitFor();
  assert.equal((await details()).customerId, null);
  assert.equal(await page.locator(".customer-workspace__heading").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: followup/invoice/customer/admin detail reload; fresh scoped restore; transient retry; missing/foreign/hidden fallbacks; account-bound late response cancellation; ephemeral code/editor excluded.");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
