import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const temporary = await mkdtemp(join(tmpdir(), 'almadina-device-tests-'));
const root = process.cwd();
const entry = join(temporary, 'entry.ts');
await writeFile(entry, ['server-database', 'trusted-client', 'session-device', 'session-device-store', 'postgres-d1-adapter'].map(name => `export * from ${JSON.stringify(join(root, 'app/lib', `${name}.ts`))};`).join('\n'));
await build({ entryPoints: [entry], outfile: join(temporary, 'api.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external' });
await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
const { handleAlmadinaApi, describeSessionDevice, setTrustedClientLocation, sessionDetailsStatement, PostgresD1Database } = await import(pathToFileURL(join(temporary, 'api.mjs')));
after(() => rm(temporary, { recursive: true, force: true }));
class Statement {
  constructor(database, sql, values = []) { Object.assign(this, { database, sql, values }); }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.engine.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.engine.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() { return { success: true, meta: { changes: Number(this.database.engine.prepare(this.sql).run(...this.values).changes) } }; }
}
class SqliteD1 {
  constructor() { this.engine = new DatabaseSync(':memory:'); this.engine.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) { this.engine.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.engine.exec('COMMIT'); return results; } catch (e) { this.engine.exec('ROLLBACK'); throw e; } }
}
const hash = password => { const salt = Buffer.alloc(16, 7); return `pbkdf2:10000:${salt.toString('hex')}:${pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex')}`; };
const native = { 'X-Almadina-Platform': 'android', 'X-Almadina-Device-Model': encodeURIComponent('Samsung SM-F966B'), 'X-Almadina-OS-Version': '16', 'X-Almadina-App-Version': '2.9.19' };

test('native hints identify Android/iPhone/iPad without mislabeling them as browsers', () => {
  for (const platform of ['android', 'ios', 'ipados']) {
    const descriptor = describeSessionDevice(new Request('https://example.test', { headers: { ...native, 'X-Almadina-Platform': platform } }));
    assert.equal(descriptor.platform, platform); assert.equal(descriptor.browser, 'تطبيق المدينة إكسبرس'); assert.equal(descriptor.model, 'Samsung SM-F966B');
  }
  const hostile = describeSessionDevice(new Request('https://example.test', { headers: { ...native, 'X-Almadina-Device-Model': encodeURIComponent('abc\u202eevil\n') } }));
  assert.equal(hostile.model, 'abcevil');
  assert.equal(describeSessionDevice(new Request('https://example.test', { headers: { ...native, 'X-Almadina-Device-Model': '%not-encoded' } })).model, '');
  assert.equal(describeSessionDevice(new Request('https://example.test')).platform, 'unknown');
});

async function suite(t, database) {
  const base = 'https://app.example.test/api/almadina/';
  async function call(path, { cookie, headers = {}, body, location } = {}) {
    const request = new Request(base + path, { headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: 'https://app.example.test' }) }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    if (location) setTrustedClientLocation(request, location);
    const response = await handleAlmadinaApi(request, database);
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  assert.equal((await call('security/devices')).status, 401);
  const now = new Date().toISOString();
  const user = { id: 'merchant-a', role: 'merchant', name: 'نسيم', email: 'a@example.test', phone: '0590000011', store: 'المدينة', joinedAt: now, password: hash('Old@Pass123'), avatarColor: 'green' };
  const other = { ...user, id: 'merchant-b', email: 'b@example.test', phone: '0590000012' };
  const state = { users: [user, other], orders: [], recipients: [], collections: [], notices: [], preferences: {}, nextOrder: 1, nextCollection: 1, parcelCodeClaims: {}, parcelCodeBatches: [] };
  await database.prepare('UPDATE almadina_state SET payload = ? WHERE id = ?').bind(JSON.stringify(state), 'main').run();
  const login = await call('login', { headers: native, body: { email: user.email, password: 'Old@Pass123' }, location: { city: 'Nablus', region: 'West Bank', country: 'PS' } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  let cookie = login.headers.get('set-cookie').split(';')[0];
  const second = await call('login', { headers: { 'X-Almadina-Platform': 'ios', 'X-Almadina-Device-Model': 'iPhone13,2' }, body: { email: user.email, password: 'Old@Pass123' } });
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  let initial;
  await t.test('login metadata and first trusted region survive requests without headers and changed regions', async () => {
    initial = await call('security/devices', { cookie, location: { city: 'Paris', country: 'FR' } });
    assert.equal(initial.status, 200); assert.equal(initial.body.count, 2);
    const current = initial.body.devices.find(d => d.current);
    assert.equal(current.platform, 'android'); assert.equal(current.model, 'Samsung SM-F966B'); assert.equal(current.osVersion, '16');
    assert.match(current.location, /Nablus/); assert.doesNotMatch(current.location, /Paris/); assert.equal(current.locationSource, 'ip');
    assert.equal(initial.body.devices.find(d => !d.current).platform, 'ios');
    assert.equal(initial.body.devices.find(d => !d.current).location, null);
    assert.doesNotMatch(JSON.stringify(initial.body), /203\.0\.113|token_hash|user_id/);
  });
  await t.test('labels change only the current account/session, reject forged targets and preserve on refresh', async () => {
    const renamed = await call('security/devices/current', { cookie, body: { label: '  هاتف نسيم  ' }, headers: { 'X-Almadina-Account': user.id } });
    assert.equal(renamed.status, 200); assert.equal(renamed.body.devices.find(d => d.current).label, 'هاتف نسيم');
    assert.equal(renamed.body.devices.find(d => !d.current).label, '');
    for (const body of [{ label: 'bad', deviceId: initial.body.devices.find(d => !d.current).id }, { label: 'x'.repeat(81) }, { label: 'a\u202eb' }, { label: 7 }, []]) assert.equal((await call('security/devices/current', { cookie, body })).status, 400);
    for (const path of ['security/devices', 'security/devices/current', 'security/devices/revoke']) {
      assert.equal((await call(path, { cookie, headers: { 'X-Almadina-Account': other.id }, ...(path === 'security/devices' ? {} : { body: { label: 'wrong' } }) })).status, 409);
    }
    assert.equal((await call('security/devices', { cookie })).body.devices.find(d => d.current).label, 'هاتف نسيم');
    assert.equal((await call('security/devices/current', { body: { label: 'unauthenticated' } })).status, 401);
  });
  await t.test('password rotation preserves label/region while invalidating old token; revoke cascades details', async () => {
    const changed = await call('account/password', { cookie, headers: native, body: { currentPassword: 'Old@Pass123', newPassword: 'New@Pass123', confirmPassword: 'New@Pass123', signOutAllDevices: false } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const oldCookie = cookie; cookie = changed.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('security/devices', { cookie: oldCookie })).status, 401);
    const fresh = await call('security/devices', { cookie });
    assert.equal(fresh.body.devices.find(d => d.current).label, 'هاتف نسيم');
    assert.match(fresh.body.devices.find(d => d.current).location, /Nablus/);
    const revoked = await call('security/devices/revoke', { cookie, body: { deviceId: fresh.body.devices.find(d => !d.current).id } });
    assert.equal(revoked.status, 200); assert.equal(revoked.body.count, 1);
    assert.equal((await call('security/devices', { cookie: secondCookie })).status, 401);
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_details').first()).n), 1);
  });
  await t.test('revocation race cannot recreate metadata; logout clears device details with parent', async () => {
    const rows = await database.prepare('SELECT token_hash, user_id FROM almadina_sessions').all();
    const row = rows.results[0];
    const staleWrite = sessionDetailsStatement(database, row.token_hash, row.user_id, new Request(base, { headers: native }));
    assert.equal((await call('logout', { cookie, body: {} })).status, 200);
    await staleWrite.run();
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_details').first()).n), 0);
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_devices').first()).n), 0);
  });
  await t.test('account-wide password revocation removes every device metadata row', async () => {
    const signed = await call('login', { headers: native, body: { email: user.email, password: 'New@Pass123' } });
    const signedCookie = signed.headers.get('set-cookie').split(';')[0];
    const signed2 = await call('login', { headers: native, body: { email: user.email, password: 'New@Pass123' } });
    assert.equal(signed2.status, 200);
    assert.equal((await call('account/password', { cookie: signedCookie, body: { currentPassword: 'New@Pass123', newPassword: 'Final@Pass123', confirmPassword: 'Final@Pass123', signOutAllDevices: true } })).status, 200);
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_details').first()).n), 0);
  });
  await t.test('expired sessions and deleted accounts cascade their saved labels and locations', async () => {
    const signed = await call('login', { headers: native, body: { email: other.email, password: 'Old@Pass123' } });
    const signedCookie = signed.headers.get('set-cookie').split(';')[0];
    await call('security/devices/current', { cookie: signedCookie, body: { label: 'الجهاز المنتهي' } });
    await database.prepare('UPDATE almadina_sessions SET expires_at = ? WHERE user_id = ?').bind(1, other.id).run();
    assert.equal((await call('security/devices', { cookie: signedCookie })).status, 401);
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_details').first()).n), 0);
    const again = await call('login', { headers: native, body: { email: other.email, password: 'Old@Pass123' } });
    const againCookie = again.headers.get('set-cookie').split(';')[0];
    await call('security/devices/current', { cookie: againCookie, body: { label: 'الجهاز المحذوف' } });
    const removed = await call('account/delete', { cookie: againCookie, body: { password: 'Old@Pass123', confirmation: 'حذف حسابي' } });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_details').first()).n), 0);
    assert.equal(Number((await database.prepare('SELECT COUNT(*) AS n FROM almadina_session_devices').first()).n), 0);
  });
}
test('SQLite session metadata uses real SQL, ownership, monotonic data and foreign-key cleanup', async t => {
  const database = new SqliteD1();
  try { await suite(t, database); } finally { database.engine.close(); }
});
test('PostgreSQL session metadata uses production adapter and foreign-key cleanup', { skip: !process.env.ALMADINA_TEST_PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ALMADINA_TEST_PGLITE_MODULE));
  const engine = new PGlite();
  const query = async (sql, values = []) => { const r = await engine.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  const pool = { query, connect: async () => ({ query, release() {} }), end: async () => {} };
  try { await suite(t, new PostgresD1Database(pool)); } finally { await engine.close(); }
});
