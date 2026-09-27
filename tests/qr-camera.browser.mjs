// Real browser video/canvas + ZXing decoder; camera permission and video source are simulated.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({ entryPoints: [new URL("./qr-camera.fixture.tsx", import.meta.url).pathname], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle.outputFiles[0].text); }
  else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
  else { response.setHeader("Permissions-Policy", "camera=(self)"); response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser, page;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const reset = () => page.goto(`http://127.0.0.1:${server.address().port}`);
  const open = (name = "فتح التتبع") => page.getByRole("button", { name, exact: true }).click();
  const close = () => page.getByRole("button", { name: "إغلاق الماسح", exact: true }).click();
  const livePreview = () => page.waitForFunction(() => {
    const video = document.querySelector("video");
    return video && video.srcObject && video.videoWidth > 0 && !video.paused && video.readyState >= 2;
  });
  const stopped = () => page.waitForFunction(() => window.cameraTest.streams.every((stream) => stream.getTracks().every((track) => track.readyState === "ended")));

  // A permission response can arrive after the user has already closed the scanner.
  await reset(); await page.evaluate(() => { window.cameraTest.pending = true; }); await open();
  await page.waitForFunction(() => window.cameraTest.requests === 1); await close();
  await page.evaluate(() => window.cameraTest.release());
  await stopped();
  assert.equal(await page.evaluate(() => window.cameraTest.detachedAttachments), 0, "A late stream must be stopped before it reaches a detached preview");
  assert.equal(await page.locator("#detected").textContent(), "[]");

  // Unsupported permission queries preserve the browser's native getUserMedia flow.
  await reset(); await page.evaluate(() => { window.cameraTest.denied = true; }); await open();
  await page.getByText(/تم رفض إذن الكاميرا/).waitFor();
  assert.equal(await page.evaluate(() => window.cameraTest.requests), 1);
  await page.evaluate(() => { window.cameraTest.denied = false; });
  await page.getByRole("button", { name: "إعادة تشغيل الكاميرا", exact: true }).click(); await livePreview();
  assert.equal(await page.evaluate(() => window.cameraTest.requests), 2);
  assert.deepEqual(await page.evaluate(() => window.cameraTest.constraints.at(-1)), { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  await close(); await stopped();

  // A known denial never re-prompts, and a changed browser setting recovers on focus.
  await reset(); await page.evaluate(() => { window.cameraTest.permission = "denied"; }); await open();
  await page.getByText(/إذن الكاميرا مرفوض/).waitFor();
  assert.equal(await page.evaluate(() => window.cameraTest.requests), 0);
  await page.evaluate(() => { window.cameraTest.permission = "granted"; window.dispatchEvent(new Event("focus")); });
  await livePreview(); await close(); await stopped();

  // All callers decode real QR pixels through an actual HTMLVideoElement and ZXing.
  for (const [name, cameraOnly] of [["فتح التتبع", false], ["فتح شحن الموظف", false], ["فتح ربط كود الطرد", true]]) for (const moduleSize of [4, 8, 16]) {
    await reset(); await open(name); await livePreview();
    assert.equal(await page.locator(".scanner-manual").count(), cameraOnly ? 0 : 1);
    await page.evaluate((size) => window.cameraTest.draw("ALX-20260001", size), moduleSize);
    await page.waitForFunction(() => document.querySelector("#detected").textContent === '["ALX-20260001"]');
    await stopped(); await page.waitForTimeout(600);
    assert.equal(await page.locator("#detected").textContent(), '["ALX-20260001"]');
    await close();
  }

  // Unexpected decoder failures must expose retry rather than leave a dead preview.
  await reset(); await page.evaluate(() => { window.cameraTest.decodeFailure = true; }); await open();
  await page.getByRole("button", { name: "إعادة تشغيل الكاميرا", exact: true }).waitFor(); await stopped();
  await page.evaluate(() => { window.cameraTest.decodeFailure = false; });
  await page.getByRole("button", { name: "إعادة تشغيل الكاميرا", exact: true }).click(); await livePreview();
  await close(); await stopped();

  // Camera revocation/disconnection also gives a recovery path.
  await reset(); await open(); await livePreview();
  await page.evaluate(() => {
    const track = window.cameraTest.streams.at(-1).getVideoTracks()[0];
    track.stop(); track.dispatchEvent(new Event("ended"));
  });
  await page.getByText(/توقفت الكاميرا/).waitFor();
  await page.getByRole("button", { name: "إعادة تشغيل الكاميرا", exact: true }).click(); await livePreview();
  await close(); await stopped();

  // Manually entered lookup uses the same once-only completion and camera cleanup.
  await reset(); await open(); await livePreview();
  await page.getByPlaceholder("ALX-20200001").fill("ALX-20260002");
  await page.getByRole("button", { name: "بحث", exact: true }).click(); await stopped();
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  assert.equal(await page.locator("#detected").textContent(), '["ALX-20260002"]');
  assert.deepEqual(errors, []);
  if (process.env.ALMADINA_QR_SCREENSHOT) {
    await reset(); await open("فتح شحن الموظف"); await livePreview();
    await page.evaluate(() => window.cameraTest.draw("ALX-20260001", 8));
    await page.screenshot({ path: process.env.ALMADINA_QR_SCREENSHOT }); await close();
  }
  console.log("PASS: late permission cancellation, denied/retry, settings-grant recovery, unsupported permission query, live preview, real QR video decode in lookup/employee/assignment, one result, decoder-failure/camera-ended recovery, manual cleanup.");
} catch (error) {
  if (page) {
    console.error(await page.locator("body").innerText());
    console.error(await page.evaluate(() => ({ requests: window.cameraTest.requests, tracks: window.cameraTest.streams.map((stream) => stream.getTracks().map((track) => track.readyState)) })));
    await page.screenshot({ path: process.env.ALMADINA_BROWSER_FAILURE_SCREENSHOT || "/tmp/almadina-qr-camera-failure.png" });
  }
  throw error;
} finally {
  await browser?.close(); await new Promise((resolve) => server.close(resolve));
}
