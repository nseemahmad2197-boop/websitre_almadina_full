import test from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION_STORAGE_KEY, EMPTY_NAVIGATION_DETAILS, clearNavigation, defaultNavigation, notificationNavigation, readNavigation, saveNavigation, validateNavigation } from '../app/lib/navigation-state.ts';

const merchant = { id: 'owner', role: 'merchant' }, courier = { id: 'staff', role: 'courier' }, admin = { id: 'admin', role: 'admin' };
const database = {
  users: [merchant, courier, admin],
  orders: [{ id: 'parcel', merchantId: 'owner', deleted: false }, { id: 'foreign', merchantId: 'other', deleted: false }, { id: 'deleted', merchantId: 'owner', deleted: true }],
  collections: [{ id: 'invoice', merchantId: 'owner', status: 'pending' }, { id: 'hidden', merchantId: 'owner', status: 'paid' }, { id: 'foreign-invoice', merchantId: 'other', status: 'paid' }],
  preferences: { owner: { hiddenCollectionIds: ['hidden'] } },
};
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
function browser(t, sessionStorage = storage()) { const before = globalThis.window; globalThis.window = { sessionStorage }; t.after(() => { if (before === undefined) delete globalThis.window; else globalThis.window = before; }); return sessionStorage; }

test('navigation survives storage roundtrip only for the authenticated account; clear resets it', t => {
  const store = browser(t);
  const state = { ...defaultNavigation('merchant'), view: 'security' };
  saveNavigation(merchant.id, state);
  assert.deepEqual(readNavigation(merchant, database), state);
  assert.deepEqual(readNavigation({ ...merchant, id: 'other' }, database), defaultNavigation('merchant'));
  assert.deepEqual(readNavigation(admin, database), defaultNavigation('admin'));
  clearNavigation(); assert.equal(store.getItem(NAVIGATION_STORAGE_KEY), null);
  assert.deepEqual(readNavigation(merchant, database), defaultNavigation('merchant'));
});

test('restored views use the current role, including role downgrade and unknown routes', () => {
  assert.equal(validateNavigation({ view: 'customer-followups' }, courier, database).view, 'customer-followups');
  assert.equal(validateNavigation({ view: 'deletion-requests' }, admin, database).view, 'deletion-requests');
  for (const view of ['admin', 'customer-followups', 'deletion-requests', 'parcel-codes', 'constructor', '/settings']) assert.equal(validateNavigation({ view }, merchant, database).view, 'home');
  for (const view of ['collections', 'returns', 'import', 'new-order', 'trash']) assert.equal(validateNavigation({ view }, courier, database).view, 'home');
  assert.equal(validateNavigation({ view: 'linked-devices' }, courier, database).view, 'linked-devices');
});

test('parcel detail requires current live access; a stale target falls back to the parcel list', () => {
  assert.equal(validateNavigation({ view: 'order-detail', selectedOrderId: 'parcel' }, merchant, database).selectedOrderId, 'parcel');
  for (const selectedOrderId of ['missing', 'foreign', 'deleted', null, ' parcel ']) {
    const result = validateNavigation({ view: 'order-detail', selectedOrderId }, merchant, database);
    assert.equal(result.view, 'shipments'); assert.equal(result.selectedOrderId, null);
  }
  assert.equal(validateNavigation({ view: 'order-detail', selectedOrderId: 'foreign' }, courier, database).selectedOrderId, 'foreign');
  assert.equal(validateNavigation({ view: 'order-detail', selectedOrderId: 'deleted' }, admin, database).view, 'shipments');
});

test('nested followup hints are limited to the current parcel or customer scope', () => {
  const details = { followupId: 'ticket', followupOrderId: 'parcel', customerId: 'owner', customerTab: 'followups' };
  assert.equal(validateNavigation({ view: 'order-detail', selectedOrderId: 'parcel', details }, merchant, database).details.followupId, 'ticket');
  assert.equal(validateNavigation({ view: 'order-detail', selectedOrderId: 'foreign', details }, courier, database).details.followupId, null);
  assert.equal(validateNavigation({ view: 'customer-followups', details }, courier, database).details.followupId, 'ticket');
  assert.equal(validateNavigation({ view: 'customer-followups', details: { ...details, customerId: 'other' } }, courier, database).details.followupId, null);
  assert.equal(validateNavigation({ view: 'customer-followups', details: { ...details, customerTab: 'parcels' } }, courier, database).details.followupId, null);
  assert.deepEqual(validateNavigation({ view: 'settings', details }, merchant, database).details, EMPTY_NAVIGATION_DETAILS);
});

test('invoice restore excludes another merchant and hidden invoices; enum values are bounded', () => {
  assert.equal(validateNavigation({ view: 'collections', details: { invoiceId: 'invoice' } }, merchant, database).details.invoiceId, 'invoice');
  for (const invoiceId of ['hidden', 'foreign-invoice', 'missing']) assert.equal(validateNavigation({ view: 'collections', details: { invoiceId } }, merchant, database).details.invoiceId, null);
  assert.equal(validateNavigation({ view: 'admin', details: { adminTab: 'collections' } }, admin, database).details.adminTab, 'collections');
  assert.equal(validateNavigation({ view: 'admin', details: { adminTab: 'password' } }, admin, database).details.adminTab, 'orders');
});

test('notification targets override saved locations and still require parcel access', () => {
  assert.equal(notificationNavigation('?openNotifications=1', merchant, database).view, 'notifications');
  assert.equal(notificationNavigation('?notificationOrder=parcel&openNotifications=1', merchant, database).selectedOrderId, 'parcel');
  assert.equal(notificationNavigation('?notificationOrder=foreign', merchant, database).view, 'shipments');
  assert.equal(notificationNavigation('?unrelated=value', merchant, database), null);
});

test('malformed/old storage and storage failures fall back safely without persisting sensitive extra fields', t => {
  const store = browser(t);
  for (const raw of ['{', 'null', '[]', JSON.stringify({ version: 2, userId: 'owner', view: 'settings' })]) {
    store.setItem(NAVIGATION_STORAGE_KEY, raw); assert.deepEqual(readNavigation(merchant, database), defaultNavigation('merchant'));
  }
  const normalized = validateNavigation({ view: 'settings', password: 'secret', details: { pin: '1234', invoiceId: 'invoice' } }, merchant, database);
  saveNavigation('owner', normalized); assert.ok(!store.getItem(NAVIGATION_STORAGE_KEY).includes('secret')); assert.ok(!store.getItem(NAVIGATION_STORAGE_KEY).includes('1234'));
  globalThis.window = { get sessionStorage() { throw Error('blocked'); } };
  assert.deepEqual(readNavigation(merchant, database), defaultNavigation('merchant'));
  assert.doesNotThrow(() => saveNavigation('owner', normalized)); assert.doesNotThrow(clearNavigation);
});
