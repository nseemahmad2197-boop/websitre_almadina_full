import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_LOCK_AUTH_GENERATION_KEY, APP_LOCK_RELOAD_KEY, appLockAuthGeneration, backgroundLockDue, canRestoreReloadHandoff, consumeReloadHandoff, invalidateReloadAuthentication, parseReloadHandoff, reloadNavigationType, saveReloadHandoff } from '../app/lib/app-lock-reload.ts';

const generation = 'test-auth-generation-original';
const now = 100000;
const entry = extra => ({ version: 1, state: 'unlocked', userId: 'owner', authGeneration: generation, departedAt: now - 100, ...extra });
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function browser(t, { session = storage(), local = storage({ [APP_LOCK_AUTH_GENERATION_KEY]: generation }), navigation = 'reload' } = {}) {
  const original = globalThis.window;
  const value = { sessionStorage: session, localStorage: local, performance: { getEntriesByType: () => [{ type: navigation }] } };
  globalThis.window = value;
  t.after(() => { if (original === undefined) delete globalThis.window; else globalThis.window = original; });
  return value;
}

test('navigation evidence requires real reload; legacy Safari only when modern timing is absent', () => {
  for (const type of ['reload', 'navigate', 'back_forward']) assert.equal(reloadNavigationType({ getEntriesByType: () => [{ type }], navigation: { type: 1 } }), type);
  assert.equal(reloadNavigationType({ getEntriesByType: () => [], navigation: { type: 1 } }), 'reload');
  assert.equal(reloadNavigationType({ navigation: { type: 2 } }), 'unknown');
  assert.equal(reloadNavigationType({}), 'unknown');
  assert.equal(reloadNavigationType({ getEntriesByType: () => { throw Error(); }, navigation: { type: 1 } }), 'unknown');
});

test('short same-tab handoff is valid at entry; exact 15s/future/malformed/foreign generation are rejected', () => {
  assert.deepEqual(parseReloadHandoff(JSON.stringify(entry()), 'reload', now, generation), entry());
  assert.ok(parseReloadHandoff(JSON.stringify(entry({ departedAt: now - 14999 })), 'reload', now, generation));
  for (const raw of [null, '', '{', 'null', '[]', JSON.stringify(entry({ state: 'locked' })), JSON.stringify(entry({ version: 2 })), JSON.stringify(entry({ userId: '' })), JSON.stringify(entry({ departedAt: now + 1 })), JSON.stringify(entry({ departedAt: now - 15000 })), JSON.stringify(entry({ departedAt: '99999' })), JSON.stringify(entry({ authGeneration: 'new-session-generation' }))]) assert.equal(parseReloadHandoff(raw, 'reload', now, generation), null);
  for (const navigation of ['navigate', 'back_forward', 'unknown']) assert.equal(parseReloadHandoff(JSON.stringify(entry()), navigation, now, generation), null);
});

test('handoff consumed once; active slow bootstrap remains valid but account or hidden expiry does not', t => {
  const session = storage({ [APP_LOCK_RELOAD_KEY]: JSON.stringify(entry()) }); browser(t, { session });
  const candidate = consumeReloadHandoff(now);
  assert.ok(candidate); assert.equal(session.getItem(APP_LOCK_RELOAD_KEY), null); assert.equal(consumeReloadHandoff(now), null);
  assert.equal(canRestoreReloadHandoff(candidate, 'owner', null, now + 60000), true);
  assert.equal(canRestoreReloadHandoff(candidate, 'other-account', null, now), false);
  assert.equal(canRestoreReloadHandoff(candidate, 'owner', now, now + 14999), true);
  assert.equal(canRestoreReloadHandoff(candidate, 'owner', now, now + 15000), false);
  assert.equal(canRestoreReloadHandoff(candidate, 'owner', now + 1, now), false);
});

test('pagehide uses the earliest hidden time and cannot adopt a newer tab authentication generation', t => {
  const { sessionStorage: session, localStorage: local } = browser(t);
  saveReloadHandoff('owner', generation, now, now);
  assert.equal(JSON.parse(session.getItem(APP_LOCK_RELOAD_KEY)).departedAt, now);
  saveReloadHandoff('owner', generation, now - 15000, now);
  assert.equal(session.getItem(APP_LOCK_RELOAD_KEY), null);
  local.setItem(APP_LOCK_AUTH_GENERATION_KEY, 'different-auth-generation');
  saveReloadHandoff('owner', generation, now, now);
  assert.equal(session.getItem(APP_LOCK_RELOAD_KEY), null);
  assert.equal(canRestoreReloadHandoff(entry(), 'owner', null, now), false);
});

test('failed authentication generation rotation removes old generation and invalidates old candidates', t => {
  const local = storage({ [APP_LOCK_AUTH_GENERATION_KEY]: generation });
  local.setItem = () => { throw new Error('QuotaExceeded'); };
  const session = storage({ [APP_LOCK_RELOAD_KEY]: JSON.stringify(entry()) }); browser(t, { local, session });
  invalidateReloadAuthentication();
  assert.equal(appLockAuthGeneration(), null); assert.equal(session.getItem(APP_LOCK_RELOAD_KEY), null);
  assert.equal(canRestoreReloadHandoff(entry(), 'owner', null, now), false);
});

test('unavailable storage or failed single-use removal fails closed without crashing', t => {
  const local = storage({ [APP_LOCK_AUTH_GENERATION_KEY]: generation });
  const session = storage({ [APP_LOCK_RELOAD_KEY]: JSON.stringify(entry()) });
  session.removeItem = () => { throw new Error('denied'); };
  browser(t, { local, session });
  assert.equal(consumeReloadHandoff(now), null);
  local.getItem = () => { throw new Error('denied'); };
  assert.equal(appLockAuthGeneration(), null);
  assert.doesNotThrow(() => saveReloadHandoff('owner', generation, now, now));
  assert.doesNotThrow(invalidateReloadAuthentication);
});

test('background threshold is exact and no hidden timestamp means no inactivity lock', () => {
  assert.equal(backgroundLockDue(null, now), false);
  assert.equal(backgroundLockDue(now - 14999, now), false);
  assert.equal(backgroundLockDue(now - 15000, now), true);
  assert.equal(backgroundLockDue(now + 1, now), true);
  assert.equal(backgroundLockDue(NaN, now), true);
});
