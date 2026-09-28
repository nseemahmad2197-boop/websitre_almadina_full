// Full production app; real Chromium reloads; mocked server and elapsed clock.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const baseline = process.argv.includes('--baseline');
const evidence = 'verification/app-lock-reload';
await mkdir(evidence, { recursive: true });
const bundle = await build({ entryPoints: [new URL('./app-lock-reload.fixture.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = (await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')).replace('@import "tailwindcss";', '');
const server = createServer((req, res) => {
  if (req.url.startsWith('/almadina-sw')) { res.setHeader('content-type', 'application/javascript'); return res.end('self.addEventListener("fetch",()=>{});'); }
  res.setHeader('content-type', req.url === '/fixture.js' ? 'application/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : req.url === '/fixture.css' ? css : '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
context.setDefaultTimeout(10000);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], report = [];
page.on('pageerror', error => errors.push(error.message));
await context.addInitScript(() => {
  // Advance elapsed time without sleeping or changing production timers.
  const realNow = Date.now.bind(Date);
  let offset = Number(localStorage.getItem('fixture-clock-offset') || 0);
  Date.now = () => realNow() + offset;
  window.fixtureAdvance = milliseconds => { offset += milliseconds; localStorage.setItem('fixture-clock-offset', String(offset)); };
  let hidden = sessionStorage.getItem('fixture-start-hidden') === 'yes';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  window.fixtureVisibility = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
});
const account = { id: 'owner', role: 'merchant', name: 'نسيم تجريبي', store: 'متجر التجربة', email: 'test@example.test', phone: '0591234567', password: '', joinedAt: '2026-09-27T12:00:00Z', avatarColor: '#087c45' };
const snapshot = { userId: account.id, revision: 1, database: { users: [account], orders: [], recipients: [], collections: [], notices: [], preferences: { owner: { notifications: false, sounds: false } }, nextOrder: 20260002, nextCollection: 618000, parcelCodeBatches: [], parcelCodeClaims: {} } };
const secondSnapshot = { ...snapshot, userId: 'second-owner', database: { ...snapshot.database, users: [{ ...account, id: 'second-owner', store: 'متجر الحساب الثاني' }] } };
let sessionSnapshot = snapshot, sessionMode = 'normal', securityMode = 'normal', calls = [], held = [], heldSecurity = [];
await context.route('**/api/almadina/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname.replace('/api/almadina/', '');
  calls.push({ path, method: request.method() });
  const ok = json => route.fulfill({ status: 200, json });
  if (path === 'session') {
    if (sessionMode === 'held') { held.push(route); return; }
    if (sessionMode === 'signedout') return route.fulfill({ status: 401, json: { error: 'يرجى تسجيل الدخول' } });
    return ok(sessionSnapshot);
  }
  if (path === 'security/status') {
    if (securityMode === 'held') { heldSecurity.push(route); return; }
    return securityMode === 'failed' ? route.fulfill({ status: 503, json: { error: 'تعذّر الاتصال' } }) : ok({ enabled: true, biometricEnabled: false, biometricLoginReady: false });
  }
  if (path === 'security/pin/verify') { assert.deepEqual(request.postDataJSON(), { pin: '1234' }); return ok({ verified: true }); }
  if (path === 'logout') { sessionMode = 'signedout'; return ok({ ok: true }); }
  if (path === 'login') { sessionMode = 'normal'; return ok(sessionSnapshot); }
  if (path === 'database') return ok(sessionSnapshot);
  if (path === 'push/config') return ok({ configured: false, publicKey: '' });
  return ok({});
});
async function locked(target = page) { await target.getByRole('heading', { name: 'التطبيق مقفل', exact: true }).waitFor(); }
async function loaded(target = page, name = account.store) {
  await target.getByRole('heading', { name, exact: true }).waitFor();
  assert.equal(await target.locator('.app-lock-screen').count(), 0);
  assert.equal(await target.locator('.server-bootstrap').count(), 0);
}
async function unlock() { for (const digit of '1234') await page.getByRole('button', { name: `الرقم ${digit}`, exact: true }).click(); await loaded(page, sessionSnapshot.database.users[0].store); }
async function bootstrapCalls() {
  assert.ok(calls.some(call => call.path === 'session' && call.method === 'GET'), 'Reload still validates server session');
  assert.ok(calls.some(call => call.path === 'security/status' && call.method === 'GET'), 'Reload still validates server lock status');
  assert.equal(calls.filter(call => call.path === 'security/pin/verify').length, 0, 'Reload cannot submit PIN implicitly');
}
async function reload() { calls = []; await page.reload(); assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'reload'); }
async function reset() {
  sessionMode = 'normal'; securityMode = 'normal'; sessionSnapshot = snapshot;
  await page.goto(url); await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('fixture-clock-offset'); });
  await page.goto(url + '/fresh'); await locked(); await unlock();
}
async function waitForHeldSession() { await page.waitForFunction(() => Boolean(document.querySelector('.server-bootstrap'))); for (let attempt = 0; attempt < 100 && !held.length; attempt++) await page.waitForTimeout(10); assert.ok(held.length, 'Bootstrap session response is held'); }
async function releaseSession() { sessionMode = 'normal'; const pending = held; held = []; for (const route of pending) { try { await route.fulfill({ status: 200, json: sessionSnapshot }); } catch { /* StrictMode can abort the first request. */ } } }
async function loginWithHeldSecurity() {
  securityMode = 'held';
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill(account.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Example!123');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  for (let attempt = 0; attempt < 100 && !heldSecurity.length; attempt++) await page.waitForTimeout(10);
  assert.equal(heldSecurity.length, 1, 'Fresh login requests authoritative security status');
}
async function releaseSecurity(status = 200) {
  securityMode = 'normal'; const pending = heldSecurity; heldSecurity = [];
  for (const route of pending) await route.fulfill({ status, json: status === 200 ? { enabled: true, biometricEnabled: false, biometricLoginReady: false } : { error: 'تعذّر الاتصال' } });
}
function passed(message) { report.push(message); console.log(`PASS: ${message}`); }
try {
  await page.goto(url); await locked(); await unlock();
  await page.screenshot({ path: `${evidence}/${baseline ? 'baseline' : 'after'}-unlocked.png`, fullPage: true, animations: 'disabled' });
  await reload();
  if (baseline) {
    await locked(); await bootstrapCalls();
    await page.screenshot({ path: `${evidence}/baseline-reload-relocks.png`, fullPage: true, animations: 'disabled' });
    passed('Before fix: verified PIN unlock is lost on an actual ordinary browser reload (regression reproduced).');
  } else {
    await loaded(); await bootstrapCalls();
    await page.screenshot({ path: `${evidence}/after-reload-unlocked.png`, fullPage: true, animations: 'disabled' });
    await reload(); await loaded(); await bootstrapCalls();
    passed('Verified PIN survives two successive actual reloads; each reload validates session and lock status.');

    await page.evaluate(() => { window.fixtureVisibility(true); window.fixtureAdvance(16000); window.fixtureVisibility(false); });
    await locked(); await reload(); await locked();
    passed('Real background lock boundary remains enforced; reloading a locked app remains locked.');

    await unlock();
    const other = await context.newPage(); await other.goto(url); await locked(other); await other.close();
    await page.goto(url + '/fresh-navigation'); await locked();
    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type), 'navigate');
    passed('A new tab and ordinary navigation both require unlock.');

    await unlock();
    const authenticationTab = await context.newPage(); await authenticationTab.goto(url); await locked(authenticationTab);
    await authenticationTab.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click(); await authenticationTab.locator('.auth-page').waitFor();
    await authenticationTab.getByLabel('البريد الإلكتروني', { exact: true }).fill(account.email);
    await authenticationTab.getByLabel('كلمة المرور', { exact: true }).fill('Example!123');
    await authenticationTab.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click(); await loaded(authenticationTab);
    await reload(); await locked(); await authenticationTab.close();
    passed('Logout and same-account login in another tab invalidate the previous tab’s reload continuity.');

    await unlock();
    await page.evaluate(() => { window.fixtureVisibility(true); window.fixtureAdvance(16000); });
    await reload(); await locked();
    passed('Reload after at least 15 seconds hidden requires unlock.');

    await reset(); sessionMode = 'held'; await reload(); await waitForHeldSession();
    await page.evaluate(() => window.fixtureAdvance(16000)); await releaseSession(); await loaded(); await bootstrapCalls();
    passed('A visible bootstrap taking over 15 seconds preserves reload continuity.');

    await reset(); sessionMode = 'held'; await reload(); await waitForHeldSession();
    await page.evaluate(() => { window.fixtureVisibility(true); window.fixtureAdvance(16000); window.fixtureVisibility(false); });
    await releaseSession(); await locked();
    passed('At least 15 seconds hidden during bootstrap invalidates reload continuity.');

    await reset();
    await page.evaluate(() => sessionStorage.setItem('fixture-start-hidden', 'yes'));
    sessionMode = 'held'; await reload(); await waitForHeldSession();
    await page.evaluate(() => { window.fixtureAdvance(16000); window.fixtureVisibility(false); sessionStorage.removeItem('fixture-start-hidden'); });
    await releaseSession(); await locked();
    passed('A reload that starts hidden records the hidden interval before session bootstrap.');

    await reset(); sessionSnapshot = secondSnapshot; await reload(); await locked(); await bootstrapCalls();
    passed('Reload continuity cannot unlock a different authenticated account.');

    await reset(); securityMode = 'failed'; await reload(); await locked();
    await page.getByText('تعذّر التحقق من حالة قفل التطبيق. أعد المحاولة أو سجّل الخروج.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: account.store, exact: true }).count(), 0);
    passed('Unavailable lock status fails closed despite the reload marker.');

    securityMode = 'normal';
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click(); await page.locator('.auth-page').waitFor();
    await reload(); await page.locator('.auth-page').waitFor(); assert.equal(await page.locator('.app-lock-screen').count(), 0);
    assert.equal(calls.filter(call => call.path === 'security/status').length, 0);
    passed('Successful logout followed by reload stays signed out without app lock.');

    await loginWithHeldSecurity();
    await page.evaluate(() => { window.fixtureVisibility(true); window.fixtureAdvance(16000); window.fixtureVisibility(false); });
    await releaseSecurity(); await locked();
    assert.equal(await page.getByRole('heading', { name: account.store, exact: true }).count(), 0);
    await page.screenshot({ path: `${evidence}/login-status-after-background-locked.png`, fullPage: true, animations: 'disabled' });
    passed('Fresh login status arriving after 16 seconds hidden resolves to a locked app.');

    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click(); await page.locator('.auth-page').waitFor();
    await loginWithHeldSecurity();
    await page.evaluate(() => { window.fixtureVisibility(true); window.fixtureAdvance(16000); window.fixtureVisibility(false); });
    await releaseSecurity(503); await locked();
    await page.locator('.app-lock-panel__recovery').getByText('الخادم غير متاح مؤقتًا. أعد المحاولة بعد قليل.', { exact: true }).waitFor();
    const retryResponse = page.waitForResponse(response => response.url().endsWith('/security/status') && response.status() === 200);
    await page.locator('.app-lock-panel__recovery').getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
    await retryResponse; await page.locator('.app-lock-panel__recovery').waitFor({ state: 'detached' }); await locked();
    await unlock();
    passed('Fresh login status failure after background shows actionable lock recovery; retry stays locked and PIN unlock succeeds.');

    await page.goto(url + '/late-status-after-pin'); await locked();
    await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click(); await page.locator('.auth-page').waitFor();
    await loginWithHeldSecurity();
    await page.evaluate(() => { window.fixtureVisibility(true); window.fixtureAdvance(16000); window.fixtureVisibility(false); });
    await locked(); await unlock();
    const lateFailure = page.waitForResponse(response => response.url().endsWith('/security/status') && response.status() === 503);
    await releaseSecurity(503); await lateFailure;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await loaded(); assert.equal(await page.locator('.app-lock-panel__recovery').count(), 0);
    passed('A pending status failure cannot re-lock the app after a newer successful PIN verification.');
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/${baseline ? 'baseline' : 'after'}.log`, report.join('\n') + '\n');
} catch (error) {
  console.error('UI errors:', errors); console.error((await page.locator('body').innerText()).slice(0, 7000));
  await page.screenshot({ path: `${evidence}/${baseline ? 'baseline' : 'after'}-failure.png`, fullPage: true, animations: 'disabled' });
  await writeFile(`${evidence}/${baseline ? 'baseline' : 'after'}-failure.log`, report.join('\n') + '\n' + String(error) + '\n');
  throw error;
} finally {
  for (const route of [...held, ...heldSecurity]) { try { await route.abort(); } catch {} }
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
