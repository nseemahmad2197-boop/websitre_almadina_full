// Full production app + real Chromium, simulated server responses only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ entryPoints: [new URL('./server-experience.fixture.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = (await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')).replace('@import "tailwindcss";', '');
const server = createServer((req, res) => {
  if (req.url.startsWith('/almadina-sw')) { res.setHeader('content-type', 'application/javascript'); return res.end('self.addEventListener("fetch",()=>{});'); }
  res.setHeader('content-type', req.url === '/fixture.js' ? 'application/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : req.url === '/fixture.css' ? css : '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage(); page.setDefaultTimeout(10000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
// Only shrink the transport's configured timeout during this local fixture.
await page.addInitScript(() => { const original = window.setTimeout.bind(window); window.setTimeout = (fn, delay, ...args) => original(fn, delay === 35000 && localStorage.getItem('fixture-short-timeout') === 'yes' ? 1200 : delay, ...args); });
const account = { id: 'owner', role: 'merchant', name: 'نسيم تجريبي', store: 'متجر التجربة', email: 'test@example.test', phone: '0591234567', password: '', joinedAt: '2026-09-27T12:00:00Z', avatarColor: '#087c45' };
const parcel = { id: 'parcel-1', trackingNumber: 'ALX-20260001', merchantId: account.id, merchantName: account.name, merchantStore: account.store, recipientName: 'المستلم التجريبي', recipientPhone: '0591234567', city: 'نابلس', governorate: 'نابلس', address: 'شارع حطين', pickupAddress: '', amount: 150, deliveryFee: 20, content: 'ملابس', weight: '0 - 5 كغم', dimensions: '20 × 20 × 20 سم', notes: '', privateNotes: '', reference: '', type: 'طرد عادي', status: 'ready', courierName: 'بانتظار التعيين', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', deleted: false };
const snapshot = { userId: account.id, revision: 1, database: { users: [account], orders: [parcel], recipients: [], collections: [], notices: [], preferences: { owner: { notifications: false, sounds: false } }, nextOrder: 20260002, nextCollection: 618000, parcelCodeBatches: [], parcelCodeClaims: {} } };
let sessionMode = 'held', databaseMode = 'normal', loginMode = 'held', trackingMode = 'held', securityMode = 'normal', loginSnapshot = snapshot, held = [], calls = [];
async function waitForCall(path) { for (let count = 0; count < 100; count++) { if (calls.some(call => call.path === path)) return; await page.waitForTimeout(20); } throw new Error(`No request ${path}`); }
async function release(path, json = snapshot, status = 200) { const targets = held.filter(entry => entry.path === path); held = held.filter(entry => entry.path !== path); for (const entry of targets) { try { await entry.route.fulfill({ status, json }); } catch {} } }
await page.route('**/api/almadina/**', async route => {
  const req = route.request(), path = new URL(req.url()).pathname.replace('/api/almadina/', ''); calls.push({ path, method: req.method() });
  const ok = json => route.fulfill({ status: 200, json });
  if (path === 'security/status') { if (securityMode === 'held') { held.push({ path, route }); return; } return ok({ enabled: false, biometricEnabled: false, biometricLoginReady: false }); }
  if (path === 'push/config') return ok({ configured: false, publicKey: '' });
  if (path === 'session' || path === 'database' || path === 'login' || path === 'track') {
    const mode = path === 'session' ? sessionMode : path === 'database' ? databaseMode : path === 'login' ? loginMode : trackingMode;
    if (mode === 'held' || mode === 'timeout') { held.push({ path, route }); return; }
    if (mode === 'network') return route.abort('failed');
    if (mode === 'malformed') return route.fulfill({ status: 200, body: '<html>unsafe-proxy-secret</html>', contentType: 'text/html' });
    if (typeof mode === 'number') return route.fulfill({ status: mode, body: '<html>unsafe-proxy-secret</html>', contentType: 'text/html' });
    return ok(path === 'login' ? loginSnapshot : snapshot);
  }
  return ok({});
});
const url = 'http://127.0.0.1:' + server.address().port;
async function navigate(mode = 'held') { if (page.url().startsWith(url)) await page.evaluate(short => localStorage.setItem('fixture-short-timeout', short ? 'yes' : 'no'), mode === 'timeout'); sessionMode = mode; calls = []; held = []; await page.goto(url); }
async function loaded() { await page.getByRole('heading', { name: account.store, exact: true }).waitFor(); assert.equal(await page.locator('.server-bootstrap').count(), 0); }
async function assertNoEmpty() { assert.equal(await page.getByText('لا توجد طرود بعد', { exact: true }).count(), 0); assert.equal(await page.locator('.auth-page').count(), 0); }
try {
  await mkdir('verification/server-experience', { recursive: true });
  await navigate(); await page.locator('.loading-skeleton--dashboard').waitFor(); await assertNoEmpty();
  assert.equal(await page.locator('.topbar .brand').count(), 1);
  assert.equal(await page.locator('.server-bootstrap .spinner').count(), 0);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `verification/server-experience/bootstrap-${width}.png`, animations: 'disabled', fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.loading-shape').first().evaluate(el => getComputedStyle(el, '::after').animationName), 'none');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.screenshot({ path: 'verification/server-experience/bootstrap-dark.png', animations: 'disabled', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  sessionMode = 'normal'; await release('session'); await loaded();
  await page.getByText(parcel.recipientName, { exact: true }).waitFor();
  assert.equal(await page.locator('.loading-skeleton').count(), 0);
  // Cached navigation is immediate and never requests an invented load delay.
  await page.getByRole('button', { name: 'عرض الكل', exact: true }).click();
  await page.getByRole('heading', { name: 'الطرود', exact: true }).waitFor();
  assert.equal(await page.locator('.loading-skeleton').count(), 0);

  databaseMode = 503; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.server-connection [role="alert"]').waitFor(); await page.getByText(parcel.recipientName, { exact: true }).waitFor();
  assert.equal(await page.locator('.auth-page').count(), 0); assert.equal(await page.getByText(/unsafe-proxy-secret/).count(), 0);
  assert.match(await page.locator('.server-connection').innerText(), /المعروض آخر بيانات/);
  await page.screenshot({ path: 'verification/server-experience/cached-refresh-error.png', fullPage: true });
  databaseMode = 'held'; await page.locator('.server-connection').getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await page.locator('.server-connection').getByRole('button', { name: 'جارٍ إعادة المحاولة…', exact: true }).waitFor();
  await page.getByText(parcel.recipientName, { exact: true }).waitFor();
  databaseMode = 'normal'; await release('database'); await page.locator('.server-connection [role="alert"]').waitFor({ state: 'detached' });

  // Offline must be actual navigator evidence, not an inference from HTTP503.
  await context.setOffline(true); await page.locator('.server-connection').getByText(/لا يوجد اتصال بالإنترنت/).waitFor();
  await page.getByText(parcel.recipientName, { exact: true }).waitFor(); await context.setOffline(false);
  await page.locator('.server-connection [role="alert"]').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: `إظهار حذف الطرد ${parcel.trackingNumber}`, exact: true }).evaluate(button => button.click());
  await page.getByRole('button', { name: `حذف الطرد ${parcel.trackingNumber}`, exact: true }).click();
  await page.locator('.confirm-modal').waitFor();
  databaseMode = 401; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.auth-page').waitFor(); assert.equal(await page.getByText(parcel.recipientName, { exact: true }).count(), 0, 'Expired session clears cached private content');
  assert.equal(await page.locator('.confirm-modal').count(), 0, 'Expired session clears previous-account destructive confirmation');
  assert.equal(calls.filter(call => call.method === 'POST' && call.path === 'database').length, 0);
  databaseMode = 'normal';
  for (const mode of [503, 429, 403, 'network', 'malformed', 'timeout']) {
    await navigate(mode); await page.locator('.server-bootstrap [role="alert"]').waitFor();
    await assertNoEmpty(); assert.equal(await page.getByText(/unsafe-proxy-secret/).count(), 0);
    assert.equal(await page.locator('.loading-skeleton').count(), 0, 'Failed initial load must stop skeleton');
    if (mode === 503) await page.screenshot({ path: 'verification/server-experience/bootstrap-server-error.png', fullPage: true });
    if (mode === 429) assert.match(await page.locator('[role="alert"]').innerText(), /انتظر/);
    if (mode === 'timeout') assert.match(await page.locator('[role="alert"]').innerText(), /تأخر/);
    sessionMode = 'normal'; await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click(); await loaded();
    if (mode === 'timeout') { await release('session', { ...snapshot, userId: 'stale-account' }); await loaded(); }
  }

  await navigate(401); await page.locator('.auth-page').waitFor();
  assert.equal(await page.locator('.server-bootstrap').count(), 0);
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(account.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Example!123');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.getByRole('button', { name: 'جارٍ تسجيل الدخول…', exact: true }).waitFor();
  await waitForCall('login'); assert.equal(calls.filter(call => call.path === 'login').length, 1);
  await release('login', { error: 'الخادم غير متاح' }, 503);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).waitFor();
  assert.equal(await page.getByLabel('البريد الإلكتروني', { exact: true }).inputValue(), account.email);
  assert.equal(await page.getByLabel('كلمة المرور', { exact: true }).inputValue(), 'Example!123');

  await page.getByPlaceholder('ALX-20200001').fill(parcel.trackingNumber);
  await page.getByRole('button', { name: 'تتبّع الطرد', exact: true }).click();
  const tracking = page.getByRole('dialog', { name: 'تتبّع الطرد', exact: true });
  await tracking.locator('.loading-skeleton--detail').waitFor();
  await tracking.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await release('track', { order: parcel }); assert.equal(await page.getByRole('dialog').count(), 0, 'Closed tracking cannot reopen from late response');

  // A late lock refresh belongs to the session that started it. Neither its
  // enabled flag nor its failure may overwrite the next account's lock state.
  for (const lateStatus of [200, 503]) {
    await navigate(401); await page.locator('.auth-page').waitFor();
    securityMode = 'held'; loginMode = 'normal'; loginSnapshot = snapshot;
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(account.email);
    await page.getByLabel('كلمة المرور', { exact: true }).fill('Example!123');
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click(); await loaded(); await waitForCall('security/status');
    databaseMode = 401; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.locator('.auth-page').waitFor();
    databaseMode = 'normal'; securityMode = 'normal';
    const freshLock = page.waitForResponse(response => response.url().endsWith('/security/status') && response.status() === 200);
    loginSnapshot = { ...snapshot, userId: 'second-owner', database: { ...snapshot.database, users: [{ ...account, id: 'second-owner', store: 'متجر الحساب الثاني' }], orders: [] } };
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('second@example.test');
    await page.getByLabel('كلمة المرور', { exact: true }).fill('Example!123');
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
    await page.getByRole('heading', { name: 'متجر الحساب الثاني', exact: true }).waitFor();
    await freshLock; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await release('security/status', lateStatus === 200 ? { enabled: true, biometricEnabled: true, biometricLoginReady: true } : { error: 'الخادم غير متاح' }, lateStatus);
    await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click();
    await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
    await page.getByRole('button', { name: /الأمان والخصوصية/ }).click();
    assert.equal(await page.getByRole('switch', { name: 'قفل التطبيق', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByRole('heading', { name: 'التطبيق مقفل', exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: production app bootstrap skeleton/layout light-dark 320/390/1280 reduced motion; no empty or login flash; successful immediate hydration and cached navigation; retained parcels on refresh503/offline; manual recovery; bootstrap503/429/403/network/malformed/timeout vs401; polling401 clears cached private content and pending destructive confirmation without writing; no rawHTML; timeout stale response ignored; login single request + preserved fields; tracking skeleton/cancel; late old-account lock success/failure cannot affect next account.');
} catch (error) {
  console.error('UI errors:', errors); console.error((await page.locator('body').innerText()).slice(0,7000));
  await page.screenshot({ path: 'verification/server-experience/failure.png', fullPage: true }); throw error;
} finally { for (const entry of held) { try { await entry.route.abort(); } catch {} } await browser.close(); await new Promise(resolve => server.close(resolve)); }
