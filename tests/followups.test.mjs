import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "almadina-followups-"));
await build({ entryPoints: ["app/lib/server-followups.ts", "app/lib/server-database.ts"], outdir: temporary, bundle: true, platform: "node", format: "esm", outExtension: { ".js": ".mjs" }, packages: "external" });
// Keep external dependencies resolvable while the output itself stays temporary.
const { symlink } = await import("node:fs/promises");
await symlink(join(process.cwd(), "node_modules"), join(temporary, "node_modules"), "dir");
const { handleFollowupRequest, followupSchema, followupAccountPurge, validFollowupMediaSignature } = await import(pathToFileURL(join(temporary, "server-followups.mjs")));
const { handleAlmadinaApi } = await import(pathToFileURL(join(temporary, "server-database.mjs")));
after(() => rm(temporary, { recursive: true, force: true }));
class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first(column) { const row = this.database.connection.prepare(this.sql).get(...this.values) ?? null; return row && column ? row[column] : row; }
  async all() { return { results: this.database.connection.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() { const result = this.database.connection.prepare(this.sql).run(...this.values); return { results: [], success: true, meta: { changes: Number(result.changes) } }; }
}
class SqliteD1 {
  constructor() { this.connection = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.connection.exec("BEGIN");
    try { const results = []; for (const statement of statements) { const result = this.connection.prepare(statement.sql).run(...statement.values); results.push({ success: true, results: [], meta: { changes: Number(result.changes) } }); } this.connection.exec("COMMIT"); return results; }
    catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }
}
const merchant = { id: "merchant-1", name: "التاجر", role: "merchant", email: "merchant@example.test", phone: "0591111111", store: "المتجر", password: "disabled:test", joinedAt: new Date().toISOString() };
const other = { ...merchant, id: "merchant-2", email: "other@example.test" };
const courier = { ...merchant, id: "courier-1", name: "المندوب", role: "courier", email: "courier@example.test" };
const admin = { ...merchant, id: "admin-1", role: "admin", email: "admin@example.test" };
const state = () => ({ users: [merchant, other, courier, admin], orders: [{ id: "parcel-1", merchantId: merchant.id, courierId: courier.id, courierName: courier.name, trackingNumber: "ALX-20200001", createdAt: new Date().toISOString(), status: "new", price: 123, codAmount: 123 }, { id: "parcel-2", merchantId: other.id, courierName: "", trackingNumber: "ALX-20200002", createdAt: new Date().toISOString(), status: "new" }], recipients: [], collections: [], notices: [], preferences: {}, nextOrder: 20200003, nextCollection: 1, parcelCodeClaims: {}, parcelCodeBatches: [] });
const request = (path = "", body, method = body === undefined ? "GET" : "POST") => new Request(`https://almadina.example/api/almadina/followups${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
async function fixture() { const database = new SqliteD1(); await database.batch(followupSchema(database)); const context = { database, account: merchant, state: state(), rateLimit: async () => {} }; return { database, context, call: (path, body, account = merchant) => handleFollowupRequest(request(path, body), { ...context, account }) }; }
const create = (extra = {}) => ({ requestId: crypto.randomUUID(), orderId: "parcel-1", type: "damaged", title: "طرد تالف", description: "وصل التغليف تالفاً", attachmentIds: [], ...extra });
function png(size = 16) { const result = Buffer.alloc(size); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(result); return result; }
async function upload(f, bytes = png(), extra = {}) {
  const payload = { requestId: crypto.randomUUID(), orderId: "parcel-1", name: "photo.png", mimeType: "image/png", size: bytes.length, chunkCount: Math.ceil(bytes.length / 262144), ...extra };
  const result = await f.call("/uploads", payload);
  return { ...result, bytes, payload, async finish() { for (let index = 0; index < payload.chunkCount; index++) await f.call(`/uploads/${result.uploadId}/chunks`, { index, dataBase64: bytes.subarray(index * 262144, (index + 1) * 262144).toString("base64") }); } };
}
const rejectsStatus = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test("independent persistent tickets survive old snapshots and idempotent retries without altering parcel finances", async () => {
  const f = await fixture(); const original = structuredClone(f.context.state.orders); const body = create();
  const first = (await f.call("", body)).followup;
  assert.equal(first.status, "open"); assert.equal(first.response, ""); assert.equal(first.creatorName, merchant.name);
  assert.deepEqual((await f.call("", body)).followup, first);
  await rejectsStatus(f.call("", { ...body, title: "different" }), 409);
  f.context.state = { ...state(), orders: structuredClone(original) }; // Old native/web snapshot contains no follow-ups.
  assert.equal((await handleFollowupRequest(request("?orderId=parcel-1"), f.context)).followups[0].id, first.id);
  assert.deepEqual(f.context.state.orders, original);
  assert.equal(f.database.connection.prepare("SELECT COUNT(*) AS count FROM almadina_followups").get().count, 1);
});

test("merchant isolation and staff-wide followup access apply to reads, uploads, downloads, and responses", async () => {
  const f = await fixture(); const u = await upload(f); await u.finish();
  const ticket = (await f.call("", create({ attachmentIds: [u.uploadId] }))).followup;
  for (const action of [() => f.call(`/${ticket.id}`, undefined, other), () => f.call("?orderId=parcel-1", undefined, other), () => f.call("", create(), other), () => f.call("/uploads", u.payload, other), () => f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: u.bytes.toString("base64") }, other), () => f.call(`/attachments/${u.uploadId}?chunk=0`, undefined, other), () => f.call(`/${ticket.id}/status`, { status: "resolved", response: "تم" }, other)]) await rejectsStatus(action(), 404);
  await rejectsStatus(f.call(`/${ticket.id}/status`, { status: "resolved" }), 403);
  assert.equal((await f.call(`/${ticket.id}/status`, { status: "in_progress", response: "قيد الفحص" }, courier)).followup.status, "in_progress");
  f.context.state.orders[0].courierId = "different-courier";
  assert.equal((await f.call(`/${ticket.id}`, undefined, courier)).followup.id, ticket.id);
  assert.equal((await f.call(`/attachments/${u.uploadId}?chunk=0`, undefined, courier)).attachment.id, u.uploadId);
  assert.equal((await f.call(`/${ticket.id}/status`, { status: "resolved" }, courier)).followup.status, "resolved");
  assert.equal((await f.call(`/${ticket.id}/status`, { status: "resolved", response: "تم الإصلاح" }, admin)).followup.status, "resolved");
  assert.equal((await f.call("?orderId=parcel-2", undefined, other)).followups.length, 0);
  assert.equal((await f.call("", undefined, other)).followups.length, 0);
  assert.equal((await f.call("", undefined, admin)).followups.length, 1);
  const staffTicket = (await f.call("", create({ orderId: "parcel-2" }), courier)).followup;
  assert.equal(staffTicket.merchantId, other.id);
  assert.equal((await f.call(`/${staffTicket.id}/status`, { status: "in_progress" }, courier)).followup.status, "in_progress");
  assert.deepEqual(new Set((await f.call("", undefined, courier)).followups.map((item) => item.id)), new Set([ticket.id, staffTicket.id]));
  assert.equal((await f.call("", undefined, merchant)).followups.length, 1);
  f.context.state.orders[0].deleted = true;
  for (const account of [merchant, courier, admin]) {
    for (const action of [() => f.call(`/${ticket.id}`, undefined, account), () => f.call("?orderId=parcel-1", undefined, account), () => f.call("", create(), account), () => f.call("/uploads", u.payload, account), () => f.call(`/attachments/${u.uploadId}?chunk=0`, undefined, account), () => f.call(`/${ticket.id}/status`, { status: "open" }, account)]) await rejectsStatus(action(), 404);
    assert.equal((await f.call("", undefined, account)).followups.some((item) => item.id === ticket.id), false);
  }
});

test("merchant filters intersect current parcel access and return ownership for legacy followups", async () => {
  const f = await fixture();
  const owned = (await f.call("", create())).followup;
  const foreign = (await f.call("", create({ orderId: "parcel-2" }), other)).followup;
  const oldPayload = { ...owned }; delete oldPayload.merchantId;
  f.database.connection.prepare("UPDATE almadina_followups SET payload = ?, merchant_id = ? WHERE id = ?").run(JSON.stringify(oldPayload), "stale-owner", owned.id);
  for (const account of [admin, courier]) {
    const results = await f.call(`?merchantId=${merchant.id}`, undefined, account);
    assert.deepEqual(results.followups.map((item) => item.id), [owned.id]);
    assert.equal(results.followups[0].merchantId, merchant.id);
    assert.equal((await f.call(`/${owned.id}`, undefined, account)).followup.merchantId, merchant.id);
    assert.deepEqual((await f.call(`?merchantId=${other.id}&orderId=parcel-1`, undefined, account)).followups, []);
    assert.deepEqual((await f.call(`?merchantId=${other.id}&orderId=parcel-2`, undefined, account)).followups.map((item) => item.id), [foreign.id]);
  }
  assert.equal((await f.call("", create({ requestId: f.database.connection.prepare("SELECT request_id FROM almadina_followups WHERE id = ?").get(owned.id).request_id }))).followup.merchantId, merchant.id);
  assert.deepEqual((await f.call(`?merchantId=${other.id}`, undefined, merchant)).followups, []);
  assert.deepEqual((await f.call(`?merchantId=${merchant.id}&orderId=parcel-2`, undefined, other)).followups, []);
  await rejectsStatus(f.call(`?merchantId=${other.id}&orderId=parcel-2`, undefined, merchant), 404);
  await rejectsStatus(f.call("?merchantId="), 400);
  await rejectsStatus(f.call("?merchantId=%27%20OR%201%3D1", undefined, admin), 400);
});

test("staff customer directory includes zero-count merchants and only active parcel followups without account secrets", async () => {
  const f = await fixture();
  const zero = { ...merchant, id: "merchant-zero", name: "عميل بلا طرود", store: "متجر جديد" };
  f.context.state.users.push(zero);
  const opened = (await f.call("", create())).followup;
  const progressing = (await f.call("", create())).followup;
  const resolved = (await f.call("", create())).followup;
  await f.call(`/${progressing.id}/status`, { status: "in_progress" }, courier);
  await f.call(`/${resolved.id}/status`, { status: "resolved" }, admin);
  await f.call("", create({ orderId: "parcel-2" }), courier);
  const deletedOrder = { ...f.context.state.orders[0], id: "deleted-parcel" };
  f.context.state.orders.push(deletedOrder);
  await f.call("", create({ orderId: deletedOrder.id }));
  deletedOrder.deleted = true;
  // Count against current parcel ownership, not potentially stale ticket metadata.
  f.database.connection.prepare("UPDATE almadina_followups SET merchant_id = ? WHERE id = ?").run("stale-owner", opened.id);
  for (const account of [admin, courier]) {
    const page = await f.call("/customers", undefined, account);
    assert.equal(page.nextCursor, null);
    assert.equal(page.customers.length, 3);
    assert.deepEqual(page.customers.find((customer) => customer.id === merchant.id), { id: merchant.id, name: merchant.name, store: merchant.store, orderCount: 1, followupCount: 3, openCount: 2 });
    assert.deepEqual(page.customers.find((customer) => customer.id === other.id), { id: other.id, name: other.name, store: other.store, orderCount: 1, followupCount: 1, openCount: 1 });
    assert.deepEqual(page.customers.find((customer) => customer.id === zero.id), { id: zero.id, name: zero.name, store: zero.store, orderCount: 0, followupCount: 0, openCount: 0 });
    for (const customer of page.customers) assert.deepEqual(Object.keys(customer).sort(), ["id", "name", "store", "orderCount", "followupCount", "openCount"].sort());
    for (const secret of [merchant.email, merchant.phone, merchant.password, courier.email, admin.email, opened.description]) assert.equal(JSON.stringify(page).includes(secret), false);
  }
  await rejectsStatus(f.call("/customers", undefined, merchant), 403);
  await rejectsStatus(f.call("/customers?q=merchant-2", undefined, other), 403);
});

test("customer directory search and keyset pagination are bounded and stable for duplicate and Arabic names", async () => {
  const f = await fixture();
  const customers = Array.from({ length: 107 }, (_, index) => ({ ...merchant, id: `customer-${String(index).padStart(3, "0")}`, name: index < 54 ? "أحمد" : "محمود", store: index === 106 ? "Unique Shop" : "المتجر" }));
  f.context.state.users = [courier, admin, ...customers.toReversed()];
  const first = await f.call("/customers", undefined, courier);
  assert.equal(first.customers.length, 50); assert.ok(first.nextCursor);
  assert.deepEqual(first, await f.call("/customers", undefined, admin));
  const second = await f.call(`/customers?cursor=${encodeURIComponent(first.nextCursor)}`, undefined, courier);
  const third = await f.call(`/customers?cursor=${encodeURIComponent(second.nextCursor)}`, undefined, courier);
  assert.equal(second.customers.length, 50); assert.ok(second.nextCursor);
  assert.equal(third.customers.length, 7); assert.equal(third.nextCursor, null);
  const all = [...first.customers, ...second.customers, ...third.customers];
  assert.equal(new Set(all.map((customer) => customer.id)).size, 107);
  assert.deepEqual(all.map((customer) => customer.id), customers.map((customer) => customer.id));
  assert.deepEqual((await f.call("/customers?q=unique%20SHOP", undefined, admin)).customers.map((item) => item.id), [customers[106].id]);
  assert.deepEqual((await f.call("/customers?q=customer-003", undefined, admin)).customers.map((item) => item.id), [customers[3].id]);
  const arabic = await f.call(`/customers?q=${encodeURIComponent("أحمد")}`, undefined, courier);
  assert.equal(arabic.customers.length, 50);
  assert.equal((await f.call(`/customers?q=${encodeURIComponent("أحمد")}&cursor=${encodeURIComponent(arabic.nextCursor)}`, undefined, courier)).customers.length, 4);
  assert.deepEqual(await f.call("/customers?q=no-match", undefined, courier), { customers: [], nextCursor: null });
  // A cursor remains usable if its boundary customer is removed; it is not an offset.
  f.context.state.users = f.context.state.users.filter((item) => item.id !== first.customers[49].id);
  assert.deepEqual((await f.call(`/customers?cursor=${encodeURIComponent(first.nextCursor)}`, undefined, courier)).customers, second.customers);
  for (const suffix of ["cursor=garbage", `cursor=${"x".repeat(4097)}`, `cursor=${btoa(JSON.stringify([1, "customer-1"]))}`, `q=${"x".repeat(201)}`, "q=%00"]) await rejectsStatus(f.call(`/customers?${suffix}`, undefined, courier), 400);
});

test("private multi-chunk media round-trips byte exactly; incomplete uploads never create tickets", async () => {
  const f = await fixture(); const u = await upload(f, png(262144 + 123));
  const body = create({ attachmentIds: [u.uploadId] });
  await rejectsStatus(f.call("", body), 409);
  await f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: u.bytes.subarray(0, 262144).toString("base64") });
  await rejectsStatus(f.call("", body), 409);
  await u.finish(); const ticket = (await f.call("", body)).followup;
  const chunks = await Promise.all([0, 1].map((index) => f.call(`/attachments/${u.uploadId}?chunk=${index}`)));
  assert.deepEqual(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64"))), u.bytes);
  assert.deepEqual(chunks[0].attachment, ticket.attachments[0]); assert.equal(chunks[0].chunkCount, 2);
  assert.equal("url" in ticket.attachments[0], false);
  assert.deepEqual(await f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: u.bytes.subarray(0, 262144).toString("base64") }), { ok: true });
  const altered = Buffer.from(u.bytes.subarray(0, 262144)); altered[255] = 1;
  await rejectsStatus(f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: altered.toString("base64") }), 409);
  await rejectsStatus(f.call("", create({ attachmentIds: [u.uploadId] })), 409);
  assert.deepEqual((await f.call("", body)).followup, ticket);
});

test("chunk retries are immutable; invalid base64, signatures, indexes, MIME and sizes are rejected", async () => {
  const f = await fixture(); const u = await upload(f);
  await rejectsStatus(f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: Buffer.from("<svg>alert(1)</svg>").toString("base64") }), 400);
  await rejectsStatus(f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: Buffer.alloc(16).toString("base64") }), 415);
  await rejectsStatus(f.call(`/uploads/${u.uploadId}/chunks`, { index: 1, dataBase64: "AA==" }), 400);
  await rejectsStatus(f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: "!".repeat(24) }), 400);
  await u.finish(); const changed = png(); changed[15] = 1;
  await rejectsStatus(f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: changed.toString("base64") }), 409);
  assert.deepEqual(await f.call("/uploads", u.payload), { uploadId: u.uploadId, chunkSize: 262144 });
  await rejectsStatus(f.call("/uploads", { ...u.payload, name: "different.png" }), 409);
  await rejectsStatus(f.call("/uploads", { ...u.payload, mimeType: "image/svg+xml" }), 415);
  await rejectsStatus(f.call("/uploads", { ...u.payload, size: 10485761 }), 413);
  await rejectsStatus(f.call("/uploads", { ...u.payload, size: 0 }), 413);
  await rejectsStatus(f.call("/uploads", { ...u.payload, chunkCount: 2 }), 400);
});

test("limits validate fields, attachment ownership/count/total and bounded reservation quotas", async () => {
  const f = await fixture();
  for (const extra of [{ title: " " }, { title: "a".repeat(121) }, { description: "" }, { description: "a".repeat(4001) }, { type: "unknown" }, { requestId: "bad" }, { attachmentIds: ["duplicate", "duplicate"] }, { attachmentIds: Array.from({ length: 6 }, (_, i) => `id-${i}`) }]) await rejectsStatus(f.call("", create(extra)), 400);
  const big = [];
  for (let index = 0; index < 5; index++) big.push(await upload(f, png(10 * 1024 * 1024)));
  await rejectsStatus(f.call("", create({ attachmentIds: big.slice(0, 3).map((item) => item.uploadId) })), 413);
  await rejectsStatus(upload(f), 429);
  const otherParcel = await upload(await fixture(), png(), { orderId: "parcel-2" }).catch((error) => error);
  assert.equal(otherParcel.status, 404);
});

test("orphan expiry purges only pending uploads and preserves finalized media", async () => {
  const f = await fixture(); const saved = await upload(f); await saved.finish();
  const ticket = (await f.call("", create({ attachmentIds: [saved.uploadId] }))).followup;
  const pending = await upload(f); await pending.finish();
  f.database.connection.prepare("UPDATE almadina_followup_uploads SET expires_at = 1").run();
  await rejectsStatus(f.call("", create({ attachmentIds: [pending.uploadId] })), 410);
  await upload(f); // cleanup runs on new reservation
  assert.equal(f.database.connection.prepare("SELECT COUNT(*) AS count FROM almadina_followup_chunks WHERE upload_id = ?").get(pending.uploadId).count, 0);
  assert.equal((await f.call(`/attachments/${saved.uploadId}?chunk=0`)).attachment.id, ticket.attachments[0].id);
});

test("merchant and creator deletion purge all linked tickets and private chunks", async () => {
  const f = await fixture(); const u = await upload(f); await u.finish();
  await f.call("", create({ attachmentIds: [u.uploadId] })); await upload(f);
  await f.database.batch(followupAccountPurge(f.database, merchant));
  for (const table of ["almadina_followups", "almadina_followup_uploads", "almadina_followup_chunks", "almadina_followup_owners"]) assert.equal(f.database.connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
});

test("cursor paging has no duplicates and rejects malformed cursors", async () => {
  const f = await fixture();
  for (let i = 0; i < 57; i++) await f.call("", create());
  const page1 = await f.call("");
  assert.equal(page1.followups.length, 50); assert.ok(page1.nextCursor);
  const page2 = await f.call(`?cursor=${encodeURIComponent(page1.nextCursor)}`);
  assert.equal(page2.followups.length, 7); assert.equal(page2.nextCursor, null);
  assert.equal(new Set([...page1.followups, ...page2.followups].map((ticket) => ticket.id)).size, 57);
  await rejectsStatus(f.call("?orderId=parcel-1&cursor=garbage"), 400);
});

test("notification failure never masks a committed submission", async () => {
  const f = await fixture(); f.context.notify = async () => { throw new Error("notice save conflict"); };
  const result = await handleFollowupRequest(request("", create()), f.context);
  assert.equal((await f.call(`/${result.followup.id}`)).followup.id, result.followup.id);
});

test("allowed native/browser containers match magic and executable content is rejected", () => {
  const iso = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypM4A ")]);
  assert.equal(validFollowupMediaSignature("audio/mp4", iso), true);
  assert.equal(validFollowupMediaSignature("video/mp4", Buffer.from([0,0,0,24,...Buffer.from("ftypisom")])), true);
  assert.equal(validFollowupMediaSignature("image/heic", Buffer.from([0,0,0,24,...Buffer.from("ftypheic")])), true);
  assert.equal(validFollowupMediaSignature("audio/webm", Buffer.from([0x1a,0x45,0xdf,0xa3,...Buffer.from("webm")])), true);
  assert.equal(validFollowupMediaSignature("image/png", Buffer.from("<html><script>1</script>")), false);
});

async function apiFixture() {
  const database = new SqliteD1();
  const initialization = await handleAlmadinaApi(new Request("https://almadina.example/api/almadina/followups"), database);
  assert.equal(initialization.status, 401);
  await database.prepare("UPDATE almadina_state SET payload = ? WHERE id = ?").bind(JSON.stringify(state()), "main").run();
  const token = "followup-auth-test-token";
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  await database.prepare("INSERT INTO almadina_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(digest, merchant.id, Math.floor(Date.now()/1000)+3600, new Date().toISOString()).run();
  const call = (path, body, headers = {}, method = "POST") => handleAlmadinaApi(new Request(`https://almadina.example/api/almadina/followups${path}`, { method, headers: { Cookie: `almadina_session=${token}`, "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), database);
  return { database, call };
}
test("customer directory API authenticates staff and preserves account switching and cache protections", async () => {
  const f = await apiFixture();
  const unsigned = await handleAlmadinaApi(request("/customers"), f.database);
  assert.equal(unsigned.status, 401);
  assert.equal((await f.call("/customers", undefined, {}, "GET")).status, 403);
  for (const account of [courier, admin]) {
    await f.database.prepare("UPDATE almadina_sessions SET user_id = ?").bind(account.id).run();
    const response = await f.call("/customers", undefined, { "X-Almadina-Account": account.id }, "GET");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    const page = await response.json();
    assert.deepEqual(page.customers.map((customer) => customer.id), [merchant.id, other.id]);
    assert.ok(page.customers.every((customer) => customer.orderCount === 1 && customer.followupCount === 0));
    assert.equal((await f.call("/customers", undefined, { "X-Almadina-Account": merchant.id }, "GET")).status, 409);
  }
});
test("real API rejects unauthenticated, cross-origin, oversized bodies and account switching; preserves security headers", async () => {
  const f = await apiFixture();
  assert.equal((await f.call("", create(), { Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.call("", create(), { "Sec-Fetch-Site": "cross-site" })).status, 403);
  const switched = await f.call("", create(), { "X-Almadina-Account": other.id });
  assert.equal(switched.status, 409); assert.equal((await switched.json()).code, "accountchanged");
  assert.equal((await f.call("", create({ description: "a".repeat(2 * 1024 * 1024) }))).status, 413);
  const saved = await f.call("", create(), { "X-Almadina-Account": merchant.id });
  assert.equal(saved.status, 200); assert.equal(saved.headers.get("Cache-Control"), "no-store"); assert.equal(saved.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(f.database.connection.prepare("SELECT COUNT(*) AS count FROM almadina_followups").get().count, 1);
});

test("real API rate limit prevents excessive submissions while reads remain available", async () => {
  const f = await apiFixture();
  for (let index = 0; index < 20; index++) assert.equal((await f.call("", create())).status, 200);
  const limited = await f.call("", create()); assert.equal(limited.status, 429); assert.ok(limited.headers.get("Retry-After"));
  assert.equal((await f.call("?orderId=parcel-1", undefined, {}, "GET")).status, 200);
});
