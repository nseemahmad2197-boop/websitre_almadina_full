import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright")
  : require("playwright");
const bundle = await build({ entryPoints: [new URL("./swipe-delete.fixture.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const client = await page.context().newCDPSession(page);
  async function drag(selector, dx, dy = 0, touch = false) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box);
    const x = box.x + box.width * 0.65, y = box.y + box.height * 0.5;
    if (touch) {
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let n = 1; n <= 10; n++) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * n / 10, y: y + dy * n / 10 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
    }
    await page.waitForTimeout(220);
  }
  const parcelRow = page.locator(".swipe-row").filter({ has: page.locator("#parcel") });
  await drag("#parcel", -120, 0, true);
  assert.match(await parcelRow.getAttribute("class"), /is-open/);
  assert.equal(await page.locator("#opened").textContent(), "0");
  assert.equal(await page.getByRole("dialog").count(), 0, "Full swipe only reveals; it never deletes.");
  await parcelRow.locator(".swipe-row__delete").click();
  await page.locator("#cancel").click();
  assert.equal(await page.locator("#parcel").count(), 1);
  await drag("#parcel", 0, -120, true);
  assert.ok(await page.evaluate(() => window.scrollY) > 20, "Vertical touch scroll stays native.");
  await page.evaluate(() => window.scrollTo(0, 0));
  await drag("#parcel", -120);
  await page.locator("h1").click();
  assert.doesNotMatch(await parcelRow.getAttribute("class"), /is-open/);
  await drag("#parcel", -120);
  const invoiceRow = page.locator(".swipe-row").filter({ has: page.locator("#invoice") });
  await drag("#invoice", -120);
  assert.doesNotMatch(await parcelRow.getAttribute("class"), /is-open/);
  assert.match(await invoiceRow.getAttribute("class"), /is-open/);
  await page.keyboard.press("Escape");
  // A keyboard/screen-reader action exposes the same delete button.
  const keyboardAction = invoiceRow.locator(".swipe-row__keyboard");
  await keyboardAction.focus(); await page.keyboard.press("Enter");
  await invoiceRow.locator(".swipe-row__delete").click(); await page.locator("#confirm").click();
  assert.equal(await page.locator("#invoice").count(), 0);
  let db = JSON.parse(await page.locator("#state").textContent());
  assert.equal(db.collections.length, 1); assert.equal(db.collections[0].netAmount, 85);
  assert.deepEqual(db.preferences.owner.hiddenCollectionIds, ["i1"]);
  await page.locator("#courier").click();
  assert.equal(await page.locator(".swipe-row").count(), 0, "Courier has no deletion action.");
  await page.locator("#owner").click();
  await drag("#parcel", -120);
  await parcelRow.locator(".swipe-row__delete").click(); await page.locator("#confirm").click();
  assert.equal(await page.locator("#parcel").count(), 0);
  db = JSON.parse(await page.locator("#state").textContent());
  assert.equal(db.orders[0].deleted, true); assert.ok(Date.parse(db.orders[0].deletedAt));
  assert.equal(await page.locator("#opened").textContent(), "0");
  assert.deepEqual(errors, []);
  console.log("PASS: RTL touch and mouse swipes, vertical scroll, confirmation/cancel, keyboard action, role restrictions, invoice ledger, parcel trash.");
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
