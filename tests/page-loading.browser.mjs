// Real production application: only the API responses are simulated.
// Reproduces the reported recipient-page reload and recurring refresh message.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const evidence = 'verification/page-loading';
const navigationKey = 'almadina-navigation-v1';
const bundle = await build({ entryPoints: [new URL('./server-experience.fixture.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = (await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')).replace('@import "tailwindcss";', '');
const server = createServer((req, res) => {
  if (req.url.startsWith('/almadina-sw')) { res.setHeader('content-type', 'application/javascript'); return res.end('self.addEventListener("fetch",()=>{});'); }
  res.setHeader('content-type', req.url === '/fixture.js' ? 'application/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : req.url === '/fixture.css' ? css : '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
context.setDefaultTimeout(12000);
const page = await context.newPage();
const errors = [], report = [], calls = [], shapes = {};
page.on('pageerror', error => errors.push(error.message));
const account = { id: 'owner', role: 'merchant', name: 'نسيم تجريبي', store: 'متجر التجربة', email: 'test@example.test', phone: '0591234567', password: '', joinedAt: '2026-09-27T12:00:00Z', avatarColor: '#087c45' };
const parcel = { id: 'parcel-1', trackingNumber: 'ALX-20260001', merchantId: account.id, merchantName: account.name, merchantStore: account.store, recipientName: 'مستلم طرد تجريبي', recipientPhone: '0591234567', city: 'نابلس', governorate: 'نابلس', address: 'شارع حطين', pickupAddress: '', amount: 150, deliveryFee: 20, content: 'ملابس', weight: '0 - 5 كغم', dimensions: '20 × 20 × 20 سم', notes: '', privateNotes: '', reference: '', type: 'طرد عادي', status: 'ready', courierName: 'بانتظار التعيين', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', deleted: false };
const recipient = { id: 'recipient-1', merchantId: account.id, name: 'مستلم محفوظ تجريبي', phone: '0591234567', governorate: 'نابلس', city: 'البلدة القديمة', address: 'شارع حطين' };
const snapshot = { userId: account.id, revision: 1, database: { users: [account], orders: [parcel], recipients: [recipient], collections: [], notices: [], preferences: { owner: { notifications: false, sounds: false } }, nextOrder: 20260002, nextCollection: 618000, parcelCodeBatches: [], parcelCodeClaims: {} } };
let sessionMode = 'normal', databaseMode = 'normal', held = [];
await page.route('**/api/almadina/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname.replace('/api/almadina/', '');
  calls.push({ path, method: request.method() });
  const ok = json => route.fulfill({ status: 200, json });
  if (path === 'security/status') return ok({ enabled: false, biometricEnabled: false, biometricLoginReady: false });
  if (path === 'push/config') return ok({ configured: false, publicKey: '' });
  if (path === 'followups') return ok({ followups: [], nextCursor: null });
  if (path === 'session' || path === 'database') {
    const mode = path === 'session' ? sessionMode : databaseMode;
    if (mode === 'held') { held.push({ route, path }); return; }
    if (typeof mode === 'number') return route.fulfill({ status: mode, json: { error: 'الخادم غير متاح مؤقتًا' } });
    return ok(snapshot);
  }
  return ok({});
});
function passed(message) { report.push(message); console.log(`PASS: ${message}`); }
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function screenshot(name) { await page.screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled', fullPage: true }); }
async function release(path) {
  const targets = held.filter(entry => entry.path === path); held = held.filter(entry => entry.path !== path);
  for (const entry of targets) { try { await entry.route.fulfill({ status: 200, json: snapshot }); } catch {} }
  await frames();
}
async function waitForHeld(path) {
  for (let attempt = 0; attempt < 650; attempt++) { if (held.some(entry => entry.path === path)) return; await page.waitForTimeout(20); }
  throw new Error(`No held request for ${path}`);
}
function record(view, details = {}, selectedOrderId = null) { return { version: 1, userId: account.id, view, details, selectedOrderId }; }
async function seed(value) { await page.evaluate(({ key, value }) => sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)), { key: navigationKey, value }); }
async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${(await page.viewportSize()).width}px`); }
async function holdReload(value, kind) {
  if (value !== undefined) await seed(value);
  sessionMode = 'held'; await page.reload(); await waitForHeld('session');
  assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload');
  await page.locator(`.server-bootstrap .loading-skeleton--${kind}`).waitFor();
  assert.equal(await page.locator('.auth-page').count(), 0, 'No login flash while session resolves');
  assert.equal(await page.getByText(recipient.name, { exact: true }).count(), 0, 'Skeleton hint does not expose cached private data');
  assert.equal(await page.getByText(parcel.trackingNumber, { exact: true }).count(), 0);
  return page.locator('.server-bootstrap .loading-skeleton');
}
try {
  await mkdir(evidence, { recursive: true });
  await page.goto(url); await page.getByRole('heading', { name: account.store, exact: true }).waitFor();
  await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click();
  await page.getByRole('dialog', { name: 'القائمة الجانبية' }).getByRole('button', { name: 'المستلمون المفضلون', exact: true }).click();
  await page.getByRole('heading', { name: 'المستلمون المفضلون', exact: true }).waitFor();
  await page.locator('.recipient-card').getByText(recipient.name, { exact: true }).waitFor();
  await screenshot('recipients-loaded');
  // Observe even brief live-status mounts, not just the final DOM state.
  await page.evaluate(() => {
    window.__refreshMounts = [];
    window.__refreshObserver = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element && (node.matches('.server-refresh') || node.querySelector('.server-refresh'))) window.__refreshMounts.push(node.textContent);
    })));
    window.__refreshObserver.observe(document.body, { childList: true, subtree: true });
  });
  const stablePosition = await page.locator('.recipient-card').first().boundingBox();
  databaseMode = 'held'; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitForHeld('database');
  await frames();
  assert.equal(await page.locator('.server-refresh').count(), 0, 'Focus refresh is silent');
  assert.equal((await page.locator('.recipient-card').first().boundingBox()).y, stablePosition.y, 'No content shift during focus refresh');
  await release('database');
  // Wait for the application's real recurring timer; do not call its callback manually.
  await waitForHeld('database'); await frames();
  assert.equal(await page.locator('.server-refresh').count(), 0, 'Recurring poll is silent');
  assert.equal((await page.locator('.recipient-card').first().boundingBox()).y, stablePosition.y, 'No content shift during recurring poll');
  databaseMode = 'normal'; await release('database');
  assert.deepEqual(await page.evaluate(() => window.__refreshMounts), [], 'No transient updating announcement on background reads');
  await screenshot('recipients-after-background-refresh');
  await page.evaluate(() => window.__refreshObserver.disconnect());
  passed('Real focus and recurring background reads retain recipient content, never mount the updating message, and cause no content shift.');

  databaseMode = 503; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.server-connection [role="alert"]').waitFor();
  await page.getByText(recipient.name, { exact: true }).waitFor();
  databaseMode = 'held'; await page.locator('.server-connection').getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await waitForHeld('database');
  await page.locator('.server-connection').getByRole('button', { name: 'جارٍ إعادة المحاولة…', exact: true }).waitFor();
  await page.getByText(recipient.name, { exact: true }).waitFor();
  await screenshot('explicit-retry-with-retained-content');
  databaseMode = 'normal'; await release('database');
  await page.locator('.server-connection [role="alert"]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.server-refresh').count(), 0);
  passed('A failed read keeps the current content; explicit retry has visible pending feedback that clears after success.');

  // This is the navigation path shown in the user's recording: actual menu
  // navigation followed by browser reload, with the session response held.
  await holdReload(undefined, 'recipients');
  assert.equal(await page.locator('.loading-skeleton--dashboard').count(), 0, 'Recipient reload must not show dashboard cards');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 }); await noOverflow(); await screenshot(`recipients-loading-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.loading-shape').first().evaluate(el => getComputedStyle(el, '::after').animationName), 'none');
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await screenshot('recipients-loading-dark');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  sessionMode = 'normal'; await release('session');
  await page.getByRole('heading', { name: 'المستلمون المفضلون', exact: true }).waitFor();
  await page.getByText(recipient.name, { exact: true }).waitFor();
  assert.equal(await page.locator('.loading-skeleton').count(), 0);
  passed('Recipient reload uses recipient-shaped placeholders, restores the recipient page, fits 320/390/1280px, and respects reduced motion and dark mode.');

  // Cover page families with visibly different content, not renamed copies of
  // one generic row list. Compare rendered geometry rather than source text.
  const views = [
    ['home', 'dashboard'], ['shipments', 'parcels'], ['returns', 'returns'], ['collections', 'collections'],
    ['recipients', 'recipients'], ['settings', 'settings'], ['profile', 'profile'], ['new-order', 'form'],
    ['security', 'security'], ['change-password', 'password'], ['preferences', 'preferences'], ['notifications', 'notifications'],
    ['linked-devices', 'devices'], ['help', 'help'], ['privacy', 'privacy'], ['import', 'import'], ['followups', 'followups'],
    ['order-detail', 'order', {}, parcel.id],
  ];
  for (const [view, kind, details = {}, selected = null] of views) {
    const skeleton = await holdReload(record(view, details, selected), kind);
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await noOverflow(); }
    await page.setViewportSize({ width: 390, height: 844 });
    shapes[kind] = await skeleton.evaluate(el => {
      const root = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.loading-shape')).map(shape => {
        const box = shape.getBoundingClientRect();
        return [Math.round(box.x - root.x), Math.round(box.y - root.y), Math.round(box.width), Math.round(box.height)];
      });
    });
    if (['settings', 'profile', 'parcels', 'form', 'order', 'collections'].includes(kind)) await screenshot(`${kind}-loading`);
    // End this session before the next scenario. These checks concern loading
    // geometry; actual authenticated destination restoration is also covered
    // comprehensively by navigation-reload.browser.mjs.
    sessionMode = 'normal'; await release('session'); await page.locator('.server-bootstrap').waitFor({ state: 'detached' });
  }
  for (const [one, two] of [['recipients', 'dashboard'], ['recipients', 'parcels'], ['settings', 'profile'], ['form', 'parcels'], ['collections', 'order'], ['help', 'devices']]) {
    assert.notDeepEqual(shapes[one], shapes[two], `${one} and ${two} need different visible placeholder geometry`);
  }
  passed('Eighteen destination view skeletons match their saved page family, fit phone/desktop widths, and key families have genuinely different rendered shapes.');

  for (const [value, kind] of [
    [{ ...record('home'), role: 'courier' }, 'employee'],
    [{ ...record('admin', { adminTab: 'users' }), role: 'admin' }, 'admin-users'],
    [{ ...record('admin', { adminTab: 'collections' }), role: 'admin' }, 'admin-collections'],
  ]) {
    const skeleton = await holdReload(value, kind);
    await noOverflow();
    shapes[kind] = await skeleton.evaluate(el => {
      const root = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('.loading-shape')).map(shape => {
        const box = shape.getBoundingClientRect();
        return [Math.round(box.x - root.x), Math.round(box.y - root.y), Math.round(box.width), Math.round(box.height)];
      });
    });
    await screenshot(`${kind}-loading`);
    sessionMode = 'normal'; await release('session');
    // The server still returns a merchant: local presentation hints must not
    // grant employee/admin access when the authenticated response arrives.
    await page.getByRole('heading', { name: account.store, exact: true }).waitFor();
    assert.equal(await page.locator('.server-bootstrap').count(), 0);
  }
  assert.notDeepEqual(shapes.employee, shapes.dashboard, 'Employee home shows its scanner layout rather than merchant balance cards');
  assert.notDeepEqual(shapes['admin-users'], shapes['admin-collections'], 'Admin people and invoice tabs use different row geometry');
  passed('Employee home, admin users and admin collections have distinct loading geometry; role hints never override the authenticated server role.');

  for (const invalid of ['{malformed', record('unknown-view'), { ...record('recipients'), version: 99 }]) {
    await holdReload(invalid, 'dashboard');
    sessionMode = 'normal'; await release('session');
    await page.getByRole('heading', { name: account.store, exact: true }).waitFor();
  }
  passed('Malformed, unknown and unsupported-version navigation hints fall back to the dashboard without exposing saved content.');
  assert.equal(calls.some(call => call.method !== 'GET'), false, 'Read-only loading and retry scenarios never mutate server data');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/browser.log`, report.join('\n') + '\n');
  await writeFile(`${evidence}/rendered-shapes.json`, JSON.stringify(shapes, null, 2) + '\n');
} catch (error) {
  console.error('UI errors:', errors); console.error((await page.locator('body').innerText()).slice(0, 5000));
  await screenshot('failure'); throw error;
} finally {
  for (const entry of held) { try { await entry.route.abort(); } catch {} }
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
