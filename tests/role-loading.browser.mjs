// Authenticated production-role reloads; APIs are local deterministic fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const evidence = 'verification/role-loading';
const key = 'almadina-navigation-v1';
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
const joinedAt = '2026-09-27T12:00:00Z';
const user = (role, name, store) => ({ id: role, role, name, store, email: `${role}@example.test`, phone: '0591234567', password: '', joinedAt, avatarColor: '#087c45', membership: 'standard' });
const users = [user('merchant', 'التاجر التجريبي', 'متجر التجربة'), user('courier', 'المندوب التجريبي', 'نابلس'), user('admin', 'المسؤول التجريبي', 'الإدارة')];
const parcel = { id: 'parcel-1', trackingNumber: 'ALX-20260001', merchantId: 'merchant', merchantName: users[0].name, merchantStore: users[0].store, courierId: 'courier', recipientName: 'مستلم الطرد التجريبي', recipientPhone: '0591234567', city: 'نابلس', governorate: 'نابلس', address: 'شارع حطين', pickupAddress: '', amount: 150, deliveryFee: 20, content: 'ملابس', weight: '0 - 5 كغم', dimensions: '20 × 20 × 20 سم', notes: '', privateNotes: '', reference: '', type: 'طرد عادي', status: 'ready', courierName: users[1].name, createdAt: joinedAt, updatedAt: joinedAt, deleted: false };
const invoice = { id: 'invoice-1', merchantId: 'merchant', merchantName: users[0].name, invoiceNumber: 'INV-618000', orderIds: [parcel.id], grossAmount: 150, deliveryFees: 20, returnFees: 0, netAmount: 130, deliveredCount: 1, returnedCount: 0, status: 'pending', verificationCode: '', authorizedRecipient: '', createdAt: joinedAt, updatedAt: joinedAt, scheduledAt: joinedAt };
const followup = { id: 'followup-1', orderId: parcel.id, merchantId: 'merchant', creatorId: 'merchant', creatorName: users[0].name, title: 'متابعة توصيل الطرد', type: 'delivery-delay', description: 'يرجى التأكد من موعد التوصيل.', status: 'open', response: '', createdAt: joinedAt, updatedAt: joinedAt, attachments: [] };
const database = { users, orders: [parcel], recipients: [], collections: [invoice], notices: [], preferences: Object.fromEntries(users.map(user => [user.id, { notifications: false, sounds: false }])), nextOrder: 20260002, nextCollection: 618001, parcelCodeBatches: [], parcelCodeClaims: {} };
let activeRole = 'admin', sessionMode = 'normal', databaseMode = 'normal', held = [];
const snapshot = () => ({ userId: activeRole, revision: 1, database });
const scopedFollowup = () => ({ ...followup, canDelete: activeRole === 'admin' || activeRole === 'merchant', canEdit: activeRole === 'merchant' });
await page.route('**/api/almadina/**', async route => {
  const req = route.request(), path = new URL(req.url()).pathname.replace('/api/almadina/', ''); calls.push({ path, method: req.method(), role: activeRole });
  const ok = json => route.fulfill({ status: 200, json });
  if (path === 'security/status') return ok({ enabled: false, biometricEnabled: false, biometricLoginReady: false });
  if (path === 'push/config') return ok({ configured: false, publicKey: '' });
  if (path === 'session' || path === 'database') {
    if ((path === 'session' ? sessionMode : databaseMode) === 'held') { held.push({ route, path }); return; }
    return ok(snapshot());
  }
  if (path === 'followups') return ok({ followups: [scopedFollowup()], nextCursor: null });
  if (path === `followups/${followup.id}`) return ok({ followup: scopedFollowup() });
  if (path === `followups/${followup.id}/comments`) return ok({ comments: [], nextCursor: null });
  return ok({});
});
const readyHeading = name => page.getByRole('heading', { name, exact: true }).waitFor();
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function screenshot(name) { await page.screenshot({ path: `${evidence}/${name}.png`, animations: 'disabled', fullPage: true }); }
async function waitHeld(path) { for (let i = 0; i < 650; i++) { if (held.some(item => item.path === path)) return; await page.waitForTimeout(20); } throw new Error(`No held ${path}`); }
async function release(path) { const entries = held.filter(item => item.path === path); held = held.filter(item => item.path !== path); for (const item of entries) { try { await item.route.fulfill({ status: 200, json: snapshot() }); } catch {} } await frames(); }
async function noOverflow(label) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow: ${label}`); }
async function seed(view, details = {}) { await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key, value: { version: 1, userId: activeRole, role: activeRole, view, selectedOrderId: null, details } }); }
async function go(view, ready, details = {}) { await seed(view, details); sessionMode = 'normal'; await page.reload(); await ready(); }
function pass(message) { report.push(message); console.log(`PASS: ${message}`); }
async function captureReload(label, kind, ready, checkLoading = async () => {}) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 }); await ready(); await screenshot(`${label}-loaded-${width}`);
    sessionMode = 'held'; await page.reload(); await waitHeld('session');
    const skeleton = page.locator(`.server-bootstrap .loading-skeleton--${kind}`); await skeleton.waitFor();
    assert.equal(await page.getByText(parcel.trackingNumber, { exact: true }).count(), 0, 'Bootstrap never shows cached private data');
    await noOverflow(`${label} loading ${width}`); await checkLoading(skeleton);
    if (kind.endsWith('followup-detail') && width === 1280) assert.ok((await skeleton.boundingBox()).width <= 640, 'Detail placeholders retain modal-width geometry on desktop');
    if (width === 390) shapes[label] = await skeleton.evaluate(el => { const base = el.getBoundingClientRect(); return Array.from(el.querySelectorAll('.loading-shape')).map(shape => { const rect = shape.getBoundingClientRect(); return [Math.round(rect.x - base.x), Math.round(rect.y - base.y), Math.round(rect.width), Math.round(rect.height)]; }); });
    await screenshot(`${label}-loading-${width}`);
    await page.setViewportSize({ width: 320, height: 844 }); await noOverflow(`${label} loading 320`);
    await page.setViewportSize({ width, height: 844 }); sessionMode = 'normal'; await release('session'); await ready();
    assert.equal(await page.locator('.server-bootstrap').count(), 0);
  }
}
try {
  await mkdir(evidence, { recursive: true }); await page.goto(url); await readyHeading('لوحة الإدارة');
  const tabs = [
    ['orders', 'الطرود', 'admin', '.admin-order-card'],
    ['users', 'المستخدمون', 'admin-users', '.admin-user-card--merchant'],
    ['collections', 'التحصيلات', 'admin-collections', '.admin-collection-card'],
    ['couriers', 'المندوبون', 'admin-couriers', '.admin-user-card--courier'],
  ];
  for (const [tab, title, kind, cards] of tabs) {
    await page.locator('.admin-tabs').getByRole('tab', { name: title, exact: true }).click();
    const ready = async () => {
      await readyHeading('لوحة الإدارة'); await page.locator(cards).first().waitFor();
      assert.equal(await page.locator('.admin-tabs [aria-selected="true"]').innerText(), title);
      const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), key);
      assert.equal(saved.details.adminTab, tab); assert.equal(saved.role, 'admin');
    };
    await captureReload(`admin-${tab}`, kind, ready, async skeleton => {
      assert.equal(await skeleton.locator('.admin-stats .admin-stat').count(), 4);
      assert.equal(await skeleton.locator('.admin-stats .admin-stat:visible').count(), page.viewportSize().width === 390 ? 3 : 4, 'Mobile skeleton follows the actual hidden courier-stat rule');
      assert.equal(await skeleton.locator('.admin-tabs').count(), 1);
      assert.equal(await skeleton.locator('.admin-toolbar').count(), 1);
      assert.ok(await skeleton.locator(cards).count() > 0);
      if (tab === 'users') assert.ok(await skeleton.locator('.membership-switch').count() > 0);
      if (tab === 'couriers') assert.equal(await skeleton.locator('.membership-switch').count(), 0);
      if (tab === 'orders') {
        assert.ok(await skeleton.locator('.admin-status-buttons').count() > 0);
        assert.equal(await skeleton.locator('.loading-filters > .loading-shape').count(), 9, 'All nine admin filter options have placeholders');
      }
      if (tab === 'collections') assert.equal(await skeleton.locator('.admin-collection-accounts').count(), 1);
    });
  }
  for (const [one, two] of [['orders', 'users'], ['users', 'couriers'], ['collections', 'orders']]) assert.notDeepEqual(shapes[`admin-${one}`], shapes[`admin-${two}`], `Admin ${one}/${two} need distinct row controls`);
  pass('Authenticated admin tab clicks persist through real reloads: parcels, merchants, collections and couriers each use their own loading rows and controls.');

  const staffParcelsReady = async () => { await readyHeading('الطرود'); await page.locator('.order-card').first().getByText(users[0].name, { exact: true }).waitFor(); };
  await go('shipments', staffParcelsReady); await captureReload('admin-parcels', 'staff-parcels', staffParcelsReady);
  activeRole = 'courier'; const employeeReady = async () => { await readyHeading(`مرحبًا، ${users[1].name}`); await page.locator('.employee-scan-card').waitFor(); assert.equal(await page.locator('.employee-stats > article').count(), 3); };
  await go('home', employeeReady); await captureReload('courier-home', 'employee', employeeReady, async skeleton => {
    assert.equal(await skeleton.locator('.employee-scan-card').count(), 1);
    assert.equal(await skeleton.locator('.employee-stats > article').count(), 3);
    assert.equal(await skeleton.locator('.staff-quick-actions').count(), 1);
    const quick = await skeleton.locator('.staff-quick-actions > .loading-shape').all();
    assert.equal(quick.length, 2);
    assert.equal((await quick[0].boundingBox()).y, (await quick[1].boundingBox()).y, 'Employee quick actions stay side by side');
    assert.equal(await skeleton.locator('.employee-orders .loading-filters > .loading-shape').count(), 2, 'Employee scope has exactly two filter placeholders');
    assert.ok(await skeleton.locator('.employee-collection-card').count() > 0);
    assert.ok(await skeleton.locator('.employee-order-card').count() > 0);
  });
  await page.evaluate(key => { const record = JSON.parse(sessionStorage.getItem(key)); record.role = 'employee'; sessionStorage.setItem(key, JSON.stringify(record)); }, key);
  sessionMode = 'held'; await page.reload(); await waitHeld('session'); await page.locator('.loading-skeleton--employee').waitFor();
  sessionMode = 'normal'; await release('session'); await employeeReady();
  await page.getByRole('button', { name: 'طرود المستخدمين', exact: true }).click(); await staffParcelsReady();
  await captureReload('courier-parcels', 'staff-parcels', staffParcelsReady);
  pass('Authenticated courier home and staff parcel list survive reloads with scanner/operations and merchant-attributed parcel placeholders.');

  const followupDetails = { followupId: followup.id, followupOrderId: parcel.id };
  const staffFollowupReady = async () => { await page.getByRole('dialog', { name: 'تفاصيل المتابعة', exact: true }).waitFor(); await page.getByLabel('الرد على صاحب المتابعة', { exact: true }).waitFor(); };
  await go('followups', staffFollowupReady, followupDetails); await captureReload('courier-followup', 'staff-followup-detail', staffFollowupReady, async skeleton => assert.equal(await skeleton.locator('.loading-staff-response').count(), 1));
  activeRole = 'admin'; await go('followups', staffFollowupReady, followupDetails); await captureReload('admin-followup', 'staff-followup-detail', staffFollowupReady, async skeleton => assert.equal(await skeleton.locator('.loading-staff-response').count(), 1));
  pass('Both authenticated staff roles restore followup details and their response editor after staff-specific loading.');

  activeRole = 'merchant'; const merchantReady = () => readyHeading(users[0].store);
  await go('home', merchantReady); await captureReload('merchant-home', 'dashboard', merchantReady);
  const merchantParcelsReady = async () => { await readyHeading('الطرود'); await page.locator('.order-card').first().waitFor(); };
  await go('shipments', merchantParcelsReady); await captureReload('merchant-parcels', 'parcels', merchantParcelsReady);
  const merchantFollowupReady = async () => { await page.getByRole('dialog', { name: 'تفاصيل المتابعة', exact: true }).waitFor(); assert.equal(await page.getByLabel('الرد على صاحب المتابعة', { exact: true }).count(), 0); };
  await go('followups', merchantFollowupReady, followupDetails); await captureReload('merchant-followup', 'followup-detail', merchantFollowupReady, async skeleton => assert.equal(await skeleton.locator('.loading-staff-response').count(), 0));
  assert.notDeepEqual(shapes['merchant-home'], shapes['courier-home']);
  assert.notDeepEqual(shapes['merchant-followup'], shapes['courier-followup']);
  pass('Merchant balance, own parcels and read-only staff reply layouts remain distinct from authenticated staff layouts; loading fits320/390/1280.');

  await go('home', merchantReady); databaseMode = 'held'; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitHeld('database');
  assert.equal(await page.locator('.server-connection .server-refresh').count(), 0, 'Background reads stay silent after role-specific skeleton changes');
  databaseMode = 'normal'; await release('database');
  assert.equal(calls.some(call => call.method !== 'GET'), false, 'Role/reload tests do not mutate server data');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/browser.log`, report.join('\n') + '\n');
  await writeFile(`${evidence}/rendered-shapes.json`, JSON.stringify(shapes, null, 2) + '\n');
} catch (error) {
  console.error('UI errors:', errors); console.error((await page.locator('body').innerText()).slice(0, 6000));
  await screenshot('failure'); throw error;
} finally {
  for (const item of held) { try { await item.route.abort(); } catch {} }
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
