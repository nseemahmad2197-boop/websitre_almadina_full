// Full production app + real browser reloads. Only API responses are mocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const baseline = process.argv.includes('--baseline');
const evidence = 'verification/navigation-reload';
const navigationKey = 'almadina-navigation-v1';
await mkdir(evidence, { recursive: true });
const plugins = [];
if (baseline) {
  // Actual shipped source, never a behavior-changing transform of current code.
  const archive = process.env.ALMADINA_NAVIGATION_BASELINE_ZIP || '/workspace/scratch/f0907a8accb8/deliverables/Almadina-Website-Lock-Refresh-Fix-2026-09-28.zip';
  const members = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n');
  const member = members.find(name => name.endsWith('/app/almadina-app.tsx'));
  assert.ok(member, 'Previous source archive contains the production app');
  const source = execFileSync('unzip', ['-p', archive, member], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  await writeFile(`${evidence}/baseline-source.txt`, `${archive}\n${member}\nSHA256 ${createHash('sha256').update(source).digest('hex')}\n`);
  plugins.push({ name: 'actual-previous-production-app', setup(builder) {
    builder.onLoad({ filter: /\/app\/almadina-app\.tsx$/ }, args => ({ contents: source, loader: 'tsx', resolveDir: dirname(args.path) }));
  } });
}
const bundle = await build({ entryPoints: [new URL('./app-lock-reload.fixture.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins });
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
context.setDefaultTimeout(10000);
const page = await context.newPage();
const errors = [], report = [], calls = [];
context.on('page', target => target.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
const account = { id: 'owner', role: 'merchant', name: 'نسيم تجريبي', store: 'متجر التجربة', email: 'test@example.test', phone: '0591234567', password: '', joinedAt: '2026-09-27T12:00:00Z', avatarColor: '#087c45' };
const parcel = { id: 'parcel-1', trackingNumber: 'ALX-20260001', merchantId: account.id, merchantName: account.name, merchantStore: account.store, recipientName: 'المستلم التجريبي', recipientPhone: '0591234567', city: 'نابلس', governorate: 'نابلس', address: 'شارع حطين', pickupAddress: '', amount: 150, deliveryFee: 20, content: 'ملابس', weight: '0 - 5 كغم', dimensions: '20 × 20 × 20 سم', notes: '', privateNotes: '', reference: '', type: 'طرد عادي', status: 'ready', courierName: 'بانتظار التعيين', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', deleted: false };
const foreignParcel = { ...parcel, id: 'foreign-parcel', merchantId: 'foreign-owner', trackingNumber: 'ALX-FOREIGN', recipientName: 'مستلم حساب آخر' };
const snapshot = { userId: account.id, revision: 1, database: { users: [account], orders: [parcel, foreignParcel], recipients: [], collections: [], notices: [], preferences: { owner: { notifications: false, sounds: false } }, nextOrder: 20260002, nextCollection: 618000, parcelCodeBatches: [], parcelCodeClaims: {} } };
const secondAccount = { ...account, id: 'second-owner', store: 'متجر الحساب الثاني' };
const secondSnapshot = { ...snapshot, userId: secondAccount.id, database: { ...snapshot.database, users: [secondAccount], orders: [] } };
let activeSnapshot = snapshot, sessionMode = 'normal', securityEnabled = false;
await context.route('**/api/almadina/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname.replace('/api/almadina/', ''); calls.push({ path, method: request.method() });
  const ok = json => route.fulfill({ status: 200, json });
  if (path === 'session') return sessionMode === 'normal' ? ok(activeSnapshot) : route.fulfill({ status: sessionMode === 'signedout' ? 401 : 503, json: { error: 'تعذّر الاتصال' } });
  if (path === 'database') return ok(activeSnapshot);
  if (path === 'login') { sessionMode = 'normal'; return ok(activeSnapshot); }
  if (path === 'logout') { sessionMode = 'signedout'; return ok({ ok: true }); }
  if (path === 'security/status') return ok({ enabled: securityEnabled, biometricEnabled: false, biometricLoginReady: false });
  if (path === 'security/pin/verify') { assert.deepEqual(request.postDataJSON(), { pin: '1234' }); return ok({ verified: true }); }
  if (path === 'followups') return ok({ followups: [], nextCursor: null });
  if (path === 'push/config') return ok({ configured: false, publicKey: '' });
  return ok({});
});
async function heading(name, target = page) { await target.getByRole('heading', { name, exact: true }).waitFor(); }
async function openMenu(label) { await page.getByRole('button', { name: 'فتح القائمة', exact: true }).click(); await page.getByRole('dialog', { name: 'القائمة الجانبية' }).getByRole('button', { name: label, exact: true }).click(); }
async function reload() { const start = calls.length; await page.reload(); assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload'); await page.locator('.server-bootstrap').waitFor({ state: 'detached' }); assert.ok(calls.slice(start).some(call => call.path === 'session')); }
async function unlock() { await heading('التطبيق مقفل'); for (const digit of '1234') await page.getByRole('button', { name: `الرقم ${digit}`, exact: true }).click(); }
async function seedLocation(record) { await page.evaluate(({ key, value }) => sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)), { key: navigationKey, value: record }); }
async function savedLocation(view, selectedOrderId = null) { await page.waitForFunction(({ key, view, selectedOrderId }) => { const saved = JSON.parse(sessionStorage.getItem(key) || 'null'); return saved?.view === view && saved.selectedOrderId === selectedOrderId; }, { key: navigationKey, view, selectedOrderId }); }
function savedRecord(view, selectedOrderId = null, userId = account.id) { return { version: 1, userId, view, selectedOrderId, details: {} }; }
async function screenshot(name) { await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true, animations: 'disabled' }); }
function passed(message) { report.push(message); console.log(`PASS: ${message}`); }
try {
  await page.goto(url); await heading(account.store);
  await openMenu('الإعدادات'); await heading('الإعدادات'); await screenshot(`${baseline ? 'baseline' : 'after'}-settings-before-reload`);
  await reload();
  if (baseline) {
    await heading(account.store); assert.equal(await page.getByRole('heading', { name: 'الإعدادات', exact: true }).count(), 0);
    await screenshot('baseline-settings-reload-returns-home');
    passed('Actual previous source: opening Settings then performing a real browser reload returns to Home.');
  } else {
    await heading('الإعدادات'); await savedLocation('settings');
    await page.getByRole('button', { name: /الأمان والخصوصية/ }).click(); await heading('الأمان والخصوصية'); await reload(); await heading('الأمان والخصوصية'); await savedLocation('security');
    await screenshot('after-security-reload');
    passed('Settings and Security each survive actual browser reloads.');

    await openMenu('الطرود'); await heading('الطرود'); await reload(); await heading('الطرود'); await savedLocation('shipments');
    await page.locator('.order-card').filter({ hasText: parcel.trackingNumber }).click(); await heading('تفاصيل الطرد'); await savedLocation('order-detail', parcel.id);
    await reload(); await heading('تفاصيل الطرد'); await savedLocation('order-detail', parcel.id); await screenshot('after-parcel-detail-reload');
    passed('Shipments and the selected parcel details survive actual browser reloads.');

    securityEnabled = true; await reload(); await heading('التطبيق مقفل');
    assert.equal(await page.locator('.order-detail-page').count(), 0);
    await unlock(); await heading('تفاصيل الطرد'); await savedLocation('order-detail', parcel.id);
    securityEnabled = false; await reload(); await heading('تفاصيل الطرد');
    passed('A locked bootstrap reveals the same parcel details after successful PIN verification.');

    for (const [record, expected] of [['{malformed', account.store], [savedRecord('admin'), account.store], [savedRecord('order-detail', 'missing-parcel'), 'الطرود'], [savedRecord('order-detail', foreignParcel.id), 'الطرود']]) {
      await seedLocation(record); await reload(); await heading(expected); assert.equal(await page.locator('.order-detail-page').count(), 0);
    }
    passed('Malformed state, a forbidden role view, and missing or foreign parcel references fall back safely.');

    await seedLocation(savedRecord('settings')); await page.goto(url + '/?notificationOrder=parcel-1&retained=1'); await heading('تفاصيل الطرد');
    assert.equal(new URL(page.url()).searchParams.has('notificationOrder'), false); assert.equal(new URL(page.url()).searchParams.get('retained'), '1');
    await savedLocation('order-detail', parcel.id); await reload(); await heading('تفاصيل الطرد');
    passed('Notification parcel links override saved location, remove only their query parameter, and persist after reload.');

    await openMenu('الإعدادات'); await heading('الإعدادات'); await savedLocation('settings');
    sessionMode = 'failed'; await page.reload(); await page.locator('.server-bootstrap [role="alert"]').waitFor();
    assert.equal(await page.locator('.auth-page').count(), 0); await savedLocation('settings');
    sessionMode = 'normal'; await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click(); await heading('الإعدادات');
    passed('A temporary session failure preserves saved location and retry restores Settings.');

    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
    await page.locator('.confirm-modal').getByRole('button', { name: 'تسجيل الخروج', exact: true }).click(); await page.locator('.auth-page').waitFor();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), navigationKey), null);
    await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(account.email); await page.getByLabel('كلمة المرور', { exact: true }).fill('Example!123');
    await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click(); await heading(account.store); await savedLocation('home');
    passed('Successful logout clears saved location and fresh login starts at Home.');

    await openMenu('الإعدادات'); await heading('الإعدادات'); await savedLocation('settings'); activeSnapshot = secondSnapshot;
    await reload(); await heading(secondAccount.store); await savedLocation('home');
    await openMenu('الإعدادات'); await heading('الإعدادات'); await savedLocation('settings');
    const other = await context.newPage(); await other.goto(url); await heading(secondAccount.store, other); await other.close();
    await heading('الإعدادات');
    passed('A different account rejects the previous account’s location; separate tabs keep their navigation isolated.');
  }
  assert.deepEqual(errors, []); await writeFile(`${evidence}/${baseline ? 'baseline' : 'after'}.log`, report.join('\n') + '\n');
} catch (error) {
  console.error('UI errors:', errors); console.error((await page.locator('body').innerText()).slice(0, 6000));
  await screenshot(`${baseline ? 'baseline' : 'after'}-failure`); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
