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

test("every followup read, upload, chunk, download, and staff action checks current parcel access", async () => {
  const f = await fixture(); const u = await upload(f); await u.finish();
  const ticket = (await f.call("", create({ attachmentIds: [u.uploadId] }))).followup;
  for (const action of [() => f.call(`/${ticket.id}`, undefined, other), () => f.call("?orderId=parcel-1", undefined, other), () => f.call("", create(), other), () => f.call("/uploads", u.payload, other), () => f.call(`/uploads/${u.uploadId}/chunks`, { index: 0, dataBase64: u.bytes.toString("base64") }, other), () => f.call(`/attachments/${u.uploadId}?chunk=0`, undefined, other), () => f.call(`/${ticket.id}/status`, { status: "resolved", response: "تم" }, other)]) await rejectsStatus(action(), 404);
  await rejectsStatus(f.call(`/${ticket.id}/status`, { status: "resolved" }), 403);
  assert.equal((await f.call(`/${ticket.id}/status`, { status: "in_progress", response: "قيد الفحص" }, courier)).followup.status, "in_progress");
  f.context.state.orders[0].courierId = "different-courier";
  await rejectsStatus(f.call(`/${ticket.id}`, undefined, courier), 404);
  await rejectsStatus(f.call(`/attachments/${u.uploadId}?chunk=0`, undefined, courier), 404);
  await rejectsStatus(f.call(`/${ticket.id}/status`, { status: "resolved" }, courier), 404);
  assert.equal((await f.call(`/${ticket.id}/status`, { status: "resolved", response: "تم الإصلاح" }, admin)).followup.status, "resolved");
  assert.equal((await f.call("?orderId=parcel-2", undefined, other)).followups.length, 0);
  assert.equal((await f.call("", undefined, other)).followups.length, 0);
  assert.equal((await f.call("", undefined, admin)).followups.length, 1);
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
