// Real React/Chromium; simulated transport. Backend permission/SQL guarantees
// remain covered by followups.test.mjs and followups-postgres.integration.mjs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ entryPoints: [new URL('./followups.fixture.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = (await readFile(new URL('../app/globals.css', import.meta.url), 'utf8')).replace('@import "tailwindcss";', '');
const server = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/fixture.js' ? 'application/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : req.url === '/fixture.css' ? css : '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ALMADINA_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const attachment = { id: 'proof-image', name: 'صورة-الطرد.png', mimeType: 'image/png', size: png.length, chunkCount: 1 };
const row = (id, title) => ({ id, orderId: 'parcel-1', creatorId: 'owner', creatorName: 'تاجر تجريبي', ticketNumber: id === 'ticket-a' ? 'TK-94012' : 'TK-94013', trackingNumber: 'ALX-TEST-001', type: 'delivery-delay', title, description: 'يرجى متابعة موعد وصول هذا الطرد.', status: 'open', response: '', createdAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z', attachments: id === 'ticket-a' ? [attachment] : [] });
let rows, tombstones, deleteCalls, mode, permission, holdDelete, heldList, nextListHold, staleList;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function waitUntil(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate()) { assert.ok(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 10)); }
}
const expose = (item, account) => ({ ...item, canEdit: account === item.creatorId && item.status !== 'resolved', ...(permission === 'legacy' ? {} : { canDelete: permission === 'forced' || permission !== 'denied' && (account === item.creatorId || account === 'admin') }) });
await page.route('**/api/almadina/**', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/almadina/', ''), account = req.headers()['x-almadina-account'];
  const ok = json => route.fulfill({ status: 200, json });
  const fail = (status, error) => route.fulfill({ status, json: { error } });
  if (path.endsWith('/delete')) {
    const id = path.split('/')[1], body = req.postDataJSON();
    deleteCalls.push({ id, body, account });
    if (holdDelete) await holdDelete.promise;
    if (mode === 'forbidden') return fail(403, 'ليس لديك إذن لحذف هذه المتابعة.');
    const item = rows.find(entry => entry.id === id) ?? tombstones.get(id);
    if (mode === 'conflict') { rows = rows.map(entry => entry.id === id ? { ...entry, title: 'متابعة تم تحديثها من جهاز آخر', updatedAt: '2026-09-28T12:00:00Z' } : entry); return fail(409, 'تم تحديث المتابعة.'); }
    assert.ok(item, 'Delete has exact known follow-up');
    assert.equal(body.orderId, item.orderId);
    assert.equal(body.expectedUpdatedAt, item.updatedAt);
    tombstones.set(id, item); rows = rows.filter(entry => entry.id !== id);
    if (mode === 'lost') { mode = 'normal'; return route.abort('failed'); }
    if (mode === 'wrong-id') return ok({ deleted: true, followupId: 'ticket-b', orderId: item.orderId });
    if (mode === 'wrong-order') return ok({ deleted: true, followupId: id, orderId: 'parcel-other' });
    if (mode === 'missing-receipt') return ok({ deleted: true });
    if (mode === 'false-receipt') return ok({ deleted: false, followupId: id, orderId: item.orderId });
    return ok({ deleted: true, followupId: id, orderId: item.orderId });
  }
  if (path.endsWith('/comments')) return ok({ comments: [], nextCursor: null });
  if (path.startsWith('followups/attachments/')) return ok({ attachment, index: 0, chunkCount: 1, dataBase64: png.toString('base64') });
  if (path.startsWith('followups/')) {
    const item = rows.find(entry => entry.id === path.split('/')[1]);
    return item ? ok({ followup: expose(item, account) }) : fail(404, 'المتابعة غير متاحة.');
  }
  const snapshot = account === 'other' ? [] : (staleList ?? rows).map(item => expose(item, account));
  if (nextListHold) { const hold = nextListHold; nextListHold = null; heldList = hold; await hold.promise; }
  return ok({ followups: snapshot, nextCursor: null });
});
async function reset(options = {}) {
  rows = [row('ticket-a', 'طلب متابعة وصول الطرد إلى المستلم'), row('ticket-b', 'متابعة أخرى محفوظة للطرد')];
  tombstones = new Map(); deleteCalls = []; mode = 'normal'; permission = 'normal'; holdDelete = null; heldList = null; nextListHold = null; staleList = null;
  if (options.mode) mode = options.mode;
  if (options.permission) permission = options.permission;
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('.followup-row').first().waitFor();
}
const details = () => page.getByRole('dialog', { name: 'تفاصيل المتابعة', exact: true });
const confirmation = () => page.getByRole('dialog', { name: 'حذف المتابعة؟', exact: true });
async function openDelete() {
  await page.locator('.followup-row').filter({ hasText: 'طلب متابعة وصول' }).click();
  await details().getByRole('button', { name: 'حذف المتابعة', exact: true }).click();
  await confirmation().waitFor();
}
async function remaining() {
  await page.getByText('تم حذف المتابعة.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.followup-row').count(), 1);
  assert.match(await page.locator('.followup-row').innerText(), /متابعة أخرى محفوظة/);
  assert.equal(rows[0].orderId, 'parcel-1');
}
try {
  await mkdir('verification/followup-delete-ui', { recursive: true });
  await reset(); await openDelete();
  await confirmation().getByText('TK-94012', { exact: true }).waitFor();
  await confirmation().getByText('ALX-TEST-001', { exact: true }).waitFor();
  await confirmation().getByText('طلب متابعة وصول الطرد إلى المستلم', { exact: true }).waitFor();
  for (const [width, height] of [[320, 568], [390, 844], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).scrollIntoViewIfNeeded();
    const bounds = await confirmation().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.width <= width && bounds.height <= height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ animations: 'disabled', path: `verification/followup-delete-ui/confirmation-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await confirmation().getByRole('button', { name: 'إلغاء', exact: true }).click();
  assert.equal(deleteCalls.length, 0); assert.equal(await page.locator('.followup-row').count(), 2);
  await details().waitFor();
  await page.evaluate(() => { window.revokedPreviewURLs = []; const revoke = URL.revokeObjectURL; URL.revokeObjectURL = value => { window.revokedPreviewURLs.push(value); revoke(value); }; });
  await details().getByRole('button', { name: /صورة-الطرد.png/ }).click();
  await details().getByRole('link', { name: 'تنزيل المرفق' }).waitFor();
  await details().getByRole('button', { name: 'حذف المتابعة', exact: true }).click();
  holdDelete = deferred(); nextListHold = deferred();
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'تحديث المتابعات').click());
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'تحديث المتابعات').disabled);
  await waitUntil(() => heldList, 'Stale list request should arrive');
  staleList = [...rows];
  await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).evaluate(button => { button.click(); button.click(); button.click(); });
  await confirmation().getByRole('status').waitFor();
  assert.equal(await confirmation().getByRole('button', { name: 'إلغاء', exact: true }).isDisabled(), true);
  await page.keyboard.press('Escape'); await confirmation().waitFor();
  await waitUntil(() => deleteCalls.length, 'Confirmed delete request should arrive');
  assert.equal(deleteCalls.length, 1);
  holdDelete.resolve(); await remaining();
  assert.deepEqual(deleteCalls[0], { id: 'ticket-a', body: { orderId: 'parcel-1', expectedUpdatedAt: '2026-09-27T12:00:00Z' }, account: 'owner' });
  assert.equal(await page.evaluate(() => window.revokedPreviewURLs.length), 1);
  heldList.resolve(); await page.waitForTimeout(100);
  assert.equal(await page.locator('.followup-row').count(), 1);
  await page.getByRole('button', { name: 'تحديث المتابعات', exact: true }).click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'تحديث المتابعات').disabled);
  assert.equal(await page.locator('.followup-row').count(), 1, 'Later stale list cannot resurrect a confirmed deletion');

  for (const receipt of ['wrong-id', 'wrong-order', 'missing-receipt', 'false-receipt', 'lost']) {
    await reset({ mode: receipt }); await openDelete();
    await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).click();
    await confirmation().getByRole('button', { name: 'إعادة محاولة الحذف', exact: true }).waitFor();
    assert.equal(await page.locator('.followup-row').count(), 2, 'Unconfirmed receipt keeps row visible');
    mode = 'normal';
    await confirmation().getByRole('button', { name: 'إعادة محاولة الحذف', exact: true }).click();
    await remaining(); assert.equal(deleteCalls.length, 2); assert.deepEqual(deleteCalls[0], deleteCalls[1]);
  }

  await reset({ mode: 'forbidden' }); await openDelete();
  await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).click();
  await confirmation().getByRole('alert').filter({ hasText: 'ليس لديك إذن' }).waitFor();
  assert.equal(rows.length, 2); await confirmation().getByRole('button', { name: 'إلغاء', exact: true }).click(); await details().waitFor();

  await reset({ mode: 'conflict' }); await openDelete();
  await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).click();
  await confirmation().getByRole('alert').filter({ hasText: 'من جهاز آخر' }).waitFor();
  assert.equal(await confirmation().getByRole('button', { name: 'إعادة محاولة الحذف', exact: true }).count(), 0);
  mode = 'normal';
  await confirmation().getByRole('button', { name: 'تحديث المتابعة قبل الحذف', exact: true }).click();
  await confirmation().waitFor({ state: 'detached' });
  await details().getByRole('heading', { name: 'متابعة تم تحديثها من جهاز آخر', exact: true }).waitFor();
  assert.equal(deleteCalls.length, 1, 'Refreshing conflict does not delete automatically');
  await details().getByRole('button', { name: 'حذف المتابعة', exact: true }).click();
  await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).click();
  await remaining(); assert.equal(deleteCalls[1].body.expectedUpdatedAt, '2026-09-28T12:00:00Z');

  for (const access of ['legacy', 'denied']) {
    await reset({ permission: access });
    await page.locator('.followup-row').first().click(); await details().waitFor();
    assert.equal(await details().getByRole('button', { name: 'حذف المتابعة', exact: true }).count(), 0);
  }
  await reset({ permission: 'forced' });
  await page.locator('#courier').click(); await page.locator('.followup-row').first().click(); await details().waitFor();
  assert.equal(await details().getByRole('button', { name: 'حذف المتابعة', exact: true }).count(), 0, 'Unrelated employee never gains deletion from canRespond or malformed permission');
  await details().getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.locator('#admin').click(); await openDelete();
  await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).click();
  await remaining(); assert.equal(deleteCalls[0].account, 'admin');

  await reset(); await openDelete(); holdDelete = deferred();
  await confirmation().getByRole('button', { name: 'تأكيد حذف المتابعة', exact: true }).click();
  await waitUntil(() => deleteCalls.length, 'Delete request before switching account should arrive');
  await page.evaluate(() => document.querySelector('#other').click());
  await page.getByText('لا توجد متابعات لهذا الطرد.', { exact: true }).waitFor();
  holdDelete.resolve(); await page.waitForTimeout(100);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByText('تم حذف المتابعة.', { exact: true }).count(), 0, 'Late delete receipt cannot write into new account');
  assert.equal(await page.locator('.followup-row').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: web delete RTL 320/390/1280; scoped confirmation/cancel; one request while busy; strict receipts + immutable retry after committed response loss; permission/legacy gates; 403 preserved; 409 explicit reload/reconfirm; selected row only; stale list suppression; private media URL cleanup; admin and account-switch isolation.');
} catch (error) {
  console.error('UI errors:', errors);
  console.error((await page.locator('body').innerText()).slice(0, 7000));
  await page.screenshot({ animations: 'disabled', path: 'verification/followup-delete-ui/failure.png', fullPage: true });
  throw error;
} finally {
  holdDelete?.resolve(); heldList?.resolve(); nextListHold?.resolve();
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
