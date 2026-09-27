// Actual ApplicationShell, navigation controls and long NotificationsPage under
// StrictMode. Assertions measure scrolling/visible geometry, not CSS declarations.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const baseline = process.argv.includes("--baseline");
const outputDirectory = new URL("../verification/sidebar/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const bundle = await build({
  entryPoints: [new URL("./drawer-scroll.fixture.tsx", import.meta.url).pathname], bundle: true, write: false,
  format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  plugins: baseline ? [{ name: "original-drawer", setup(builder) {
    builder.onLoad({ filter: /\/app\/components\/application-shell\.tsx$/ }, async (args) => ({
      contents: await readFile(process.env.ALMADINA_BASELINE_SHELL || "/tmp/almadina-sidebar-baseline-shell.tsx", "utf8"),
      loader: "tsx", resolveDir: new URL("../app/components/", import.meta.url).pathname,
    }));
  } }] : [],
});
const css = (await readFile(baseline ? process.env.ALMADINA_BASELINE_CSS || "/tmp/almadina-sidebar-baseline.css" : new URL("../app/globals.css", import.meta.url), "utf8")).replace('@import "tailwindcss";', "");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); return response.end(bundle.outputFiles[0].text); }
  if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); return response.end(css); }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>اختبار تمرير القائمة الجانبية</title><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const errors = [], results = [];
let activePage;

async function settle(page) { await page.waitForTimeout(350); }
async function background(page) {
  return page.evaluate(() => ({
    top: document.querySelector(".page-content")?.getBoundingClientRect().top,
    left: document.querySelector(".page-content")?.getBoundingClientRect().left,
    width: document.querySelector(".page-content")?.getBoundingClientRect().width,
    topbarTop: document.querySelector(".topbar")?.getBoundingClientRect().top,
    scrollY, scrollX,
  }));
}
async function drawerPosition(page) {
  return page.locator(".navigation-drawer").evaluate((element) => ({ top: element.scrollTop, max: element.scrollHeight - element.clientHeight }));
}
async function sameBackground(page, expected, label) {
  const actual = await background(page);
  for (const key of ["top", "left", "width", ...(expected.topbarTop >= 0 ? ["topbarTop"] : [])]) assert.ok(Math.abs(actual[key] - expected[key]) <= 1, `${label}: background ${key} moved: ${JSON.stringify({ expected, actual })}`);
}
async function wheel(page, x, y, distance) {
  await page.mouse.move(x, y); await page.mouse.wheel(0, distance); await settle(page);
}
async function touch(client, page, x, y, dy) {
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 12; step++) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + dy * step / 12 }] });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle(page);
}
async function open(page) {
  await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await page.locator(".navigation-drawer").waitFor(); await settle(page);
}
async function closed(page, scroll, styles, label) {
  await page.locator(".navigation-drawer").waitFor({ state: "detached" }); await settle(page);
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - scroll) <= 1, `${label}: page offset restored`);
  assert.deepEqual(await page.evaluate(() => ({ body: document.body.style.cssText, html: document.documentElement.style.cssText })), styles, `${label}: prior inline styles restored`);
  assert.equal(await page.locator("[inert]").count(), 0, `${label}: background unlocked`);
}

try {
  for (const scenario of baseline ? [{ name: "baseline-mobile", width: 390, height: 650, mobile: true }] : [
    { name: "mobile", width: 390, height: 650, mobile: true },
    { name: "landscape", width: 844, height: 390, mobile: true },
    { name: "desktop", width: 1280, height: 800, mobile: false },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, hasTouch: true, isMobile: scenario.mobile, reducedMotion: "reduce" });
    const page = activePage = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const client = await context.newCDPSession(page);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator(".notification-card").first().waitFor();
    await settle(page);
    // Establish a real user scroll before opening the drawer, not window.scrollTo.
    await wheel(page, scenario.width / 2, scenario.height * 0.7, 540);
    const before = await background(page);
    assert.ok(before.scrollY > 100, `${scenario.name}: underlying page is actually scrollable`);
    const styles = await page.evaluate(() => ({ body: document.body.style.cssText, html: document.documentElement.style.cssText }));
    await open(page);
    const box = await page.locator(".navigation-drawer").boundingBox();
    const x = box.x + box.width * 0.6, middle = scenario.height * 0.55;
    if (baseline) {
      const start = await background(page);
      await wheel(page, x, middle, 550);
      const end = await background(page), drawer = await drawerPosition(page);
      assert.ok(end.scrollY > start.scrollY + 100, "baseline: wheel over drawer incorrectly moves the page");
      assert.equal(drawer.top, 0, "baseline: drawer does not scroll");
      const logout = await page.locator(".drawer-logout").boundingBox();
      assert.ok(logout.y + logout.height > scenario.height, "baseline: logout is clipped below viewport");
      await page.screenshot({ path: new URL("before-mobile.png", outputDirectory).pathname });
      results.push({ scenario: scenario.name, backgroundBefore: start.scrollY, backgroundAfter: end.scrollY, drawer, logoutBottom: logout.y + logout.height, viewportHeight: scenario.height });
      await context.close(); continue;
    }
    await sameBackground(page, before, `${scenario.name}: open`);
    assert.equal(await page.locator(".navigation-drawer").evaluate((element) => element.contains(document.activeElement)), true, "opening puts focus inside the drawer");
    const dimensions = await drawerPosition(page);
    await touch(client, page, x, scenario.height * 0.72, -scenario.height * 0.42);
    const afterTouch = await drawerPosition(page);
    if (dimensions.max > 0) assert.ok(afterTouch.top > 10, `${scenario.name}: real touch scrolls drawer`);
    await sameBackground(page, before, `${scenario.name}: touch inside`);
    await wheel(page, x, middle, 2500);
    const bottom = await drawerPosition(page);
    assert.ok(bottom.max - bottom.top <= 1, `${scenario.name}: wheel reaches drawer bottom`);
    const logout = await page.locator(".drawer-logout").boundingBox();
    assert.ok(logout.y >= 0 && logout.y + logout.height <= scenario.height, `${scenario.name}: logout is reachable`);
    await sameBackground(page, before, `${scenario.name}: wheel inside`);
    await page.screenshot({ path: new URL(`after-${scenario.name}.png`, outputDirectory).pathname });
    // At both boundaries, gestures must remain contained instead of chaining to page.
    await wheel(page, x, middle, 1200);
    await touch(client, page, x, scenario.height * 0.75, -scenario.height * 0.4);
    await sameBackground(page, before, `${scenario.name}: bottom edge`);
    await wheel(page, x, middle, -2500);
    assert.ok((await drawerPosition(page)).top <= 1, `${scenario.name}: drawer returns to top`);
    await wheel(page, x, middle, -1200);
    await touch(client, page, x, scenario.height * 0.25, scenario.height * 0.4);
    await sameBackground(page, before, `${scenario.name}: top edge`);
    const outsideX = Math.max(5, box.x / 2);
    await wheel(page, outsideX, middle, 1000);
    await touch(client, page, outsideX, scenario.height * 0.72, -scenario.height * 0.4);
    await sameBackground(page, before, `${scenario.name}: backdrop`);
    // Keyboard focus wraps both ways and cannot escape into page actions.
    const buttons = page.locator(".navigation-drawer button");
    await buttons.last().focus(); await page.keyboard.press("Tab");
    assert.equal(await buttons.first().evaluate((element) => element === document.activeElement), true, "forward focus wraps");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await buttons.last().evaluate((element) => element === document.activeElement), true, "backward focus wraps");
    await sameBackground(page, before, `${scenario.name}: keyboard`);
    await page.keyboard.press("Escape");
    await closed(page, before.scrollY, styles, `${scenario.name}: Escape`);
    assert.equal(await page.getByRole("button", { name: "فتح القائمة", exact: true }).evaluate((element) => element === document.activeElement), true, "focus restored to menu trigger");
    // Reopening must not accumulate style locks or gesture handlers.
    for (let repeat = 0; repeat < 2; repeat++) {
      await open(page); await sameBackground(page, before, `${scenario.name}: reopen ${repeat}`);
      if (repeat === 0) await page.getByRole("button", { name: "إغلاق القائمة", exact: true }).click();
      else await page.mouse.click(outsideX, middle);
      await closed(page, before.scrollY, styles, `${scenario.name}: repeat ${repeat}`);
    }
    await wheel(page, scenario.width / 2, middle, 180);
    assert.ok(await page.evaluate(() => scrollY) > before.scrollY + 80, `${scenario.name}: background scroll resumes`);
    // Match real navigation: release the lock before the app scrolls the new view.
    await open(page);
    await page.locator(".drawer-links").getByRole("button", { name: "الإشعارات", exact: true }).click();
    await page.waitForFunction(() => scrollY === 0);
    await closed(page, 0, styles, `${scenario.name}: link navigation goes to top`);
    await wheel(page, scenario.width / 2, middle, 540);
    const navigationScroll = await page.evaluate(() => scrollY);
    // Unmounting the shell while open exercises cleanup independently of onClose.
    await open(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("drawer-fixture", { detail: { mounted: false } })));
    await closed(page, navigationScroll, styles, `${scenario.name}: unmount`);
    await wheel(page, scenario.width / 2, middle, 180);
    assert.ok(await page.evaluate(() => scrollY) > navigationScroll + 80, `${scenario.name}: scrolling works after unmount`);
    results.push({ scenario: scenario.name, viewport: [scenario.width, scenario.height], backgroundOffset: before.scrollY, drawerScrollRange: dimensions.max, touchScroll: afterTouch.top, logoutVisible: true, checks: "touch/wheel; drawer edges/backdrop; keyboard trap/Escape; close/reopen; navigation; unmount cleanup" });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL(baseline ? "baseline-results.json" : "browser-results.json", outputDirectory), JSON.stringify({ browser: await browser.version(), baseline, results, errors }, null, 2) + "\n");
  console.log(`${baseline ? "REPRODUCED" : "PASS"}: ${JSON.stringify(results)}`);
} catch (error) {
  console.error("UI errors:", errors);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: new URL("failure.png", outputDirectory).pathname });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
