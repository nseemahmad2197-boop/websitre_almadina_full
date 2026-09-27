// Optional PostgreSQL-engine integration check, isolated from production data.
// Install @electric-sql/pglite@0.5.8 in a temporary directory, then set
// ALMADINA_TEST_PGLITE_MODULE to its absolute dist/index.js path before running:
// node --test tests/followups-postgres.integration.mjs
// This exercises the production SQL adapter against PostgreSQL compiled to WASM.
// It does not test the Render network or the node-postgres wire protocol.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const modulePath = process.env.ALMADINA_TEST_PGLITE_MODULE;

test("PostgreSQL customer directory and selected followups agree from the first authenticated request", { skip: !modulePath }, async (t) => {
  const { PGlite } = await import(pathToFileURL(modulePath).href);
  const engine = new PGlite(); // In-memory database; no external connection is accepted.
  const temporary = await mkdtemp(join(tmpdir(), "almadina-followups-postgres-"));
  try {
    await build({
      entryPoints: ["app/lib/server-followups.ts", "app/lib/server-database.ts", "app/lib/postgres-d1-adapter.ts"],
      outdir: temporary, bundle: true, platform: "node", format: "esm",
      outExtension: { ".js": ".mjs" }, packages: "external",
    });
    await symlink(join(process.cwd(), "node_modules"), join(temporary, "node_modules"), "dir");
    const { handleFollowupRequest, followupAccountPurge } = await import(pathToFileURL(join(temporary, "server-followups.mjs")));
    const { handleAlmadinaApi } = await import(pathToFileURL(join(temporary, "server-database.mjs")));
    const { PostgresD1Database } = await import(pathToFileURL(join(temporary, "postgres-d1-adapter.mjs")));
    // PGlite is one PostgreSQL session. Lease that session for complete batches
    // so Promise.all exercises competing request snapshots without interleaving
    // unrelated BEGIN/COMMIT statements on the same engine connection.
    let sessionTail = Promise.resolve();
    const acquire = async () => {
      const previous = sessionTail;
      let release;
      sessionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      return release;
    };
    const query = async (sql, values = []) => {
      const result = await engine.query(sql, values);
      const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, ["followup_count", "open_count"].includes(key) ? String(value) : value])));
      return { rows, rowCount: result.affectedRows ?? rows.length };
    };
    const pool = {
      async query(sql, values = []) { const release = await acquire(); try { return await query(sql, values); } finally { release(); } },
      async connect() { const release = await acquire(); return { query, release }; },
      async end() {},
    };
    const database = new PostgresD1Database(pool);
    t.diagnostic((await engine.query("SELECT version() AS version")).rows[0].version);

    const timestamp = "2026-09-27T18:00:00.000Z";
    const merchant = { id: "customer-first", name: "نسيم", store: "المدينة", role: "merchant", email: "first@example.test", phone: "0591111111", password: "disabled:test", joinedAt: timestamp, avatarColor: "green" };
    const other = { ...merchant, id: "customer-other", name: "عميل آخر", email: "other@example.test" };
    const empty = { ...merchant, id: "customer-empty", name: "عميل بلا متابعة", email: "empty@example.test" };
    const admin = { ...merchant, id: "staff-admin", role: "admin", email: "admin@example.test" };
    const courier = { ...merchant, id: "staff-courier", role: "courier", email: "courier@example.test" };
    const state = {
      users: [merchant, other, empty, admin, courier],
      orders: [
        { id: "parcel-first", trackingNumber: "ALX-20200001", merchantId: merchant.id, courierId: "another-courier", courierName: "مندوب آخر", status: "ready", createdAt: timestamp },
        { id: "parcel-second", trackingNumber: "ALX-20200002", merchantId: merchant.id, courierName: "", status: "ready", createdAt: timestamp },
        { id: "parcel-other", trackingNumber: "ALX-20200003", merchantId: other.id, courierName: "", status: "ready", createdAt: timestamp },
      ],
      recipients: [], collections: [], notices: [], preferences: {}, nextOrder: 20200003,
      nextCollection: 1, parcelCodeClaims: {}, parcelCodeBatches: [],
    };
    const base = "https://almadina.example/api/almadina/followups";
    assert.equal((await handleAlmadinaApi(new Request(base), database)).status, 401);
    const saveState = () => database.prepare("UPDATE almadina_state SET payload = ? WHERE id = ?").bind(JSON.stringify(state), "main").run();
    await saveState();
    const tokenFor = new Map();
    for (const account of [merchant, other, admin, courier]) {
      const token = crypto.randomUUID();
      const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
      await database.prepare("INSERT INTO almadina_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(digest, account.id, Math.floor(Date.now() / 1000) + 3600, timestamp).run();
      tokenFor.set(account.id, token);
    }
    const read = async (path, account, expectedAccount = account.id) => {
      const response = await handleAlmadinaApi(new Request(`${base}${path}`, {
        headers: { Cookie: `almadina_session=${tokenFor.get(account.id)}`, "X-Almadina-Account": expectedAccount },
      }), database);
      return { response, payload: await response.json() };
    };
    const create = async (orderId, account = merchant) => {
      const result = await handleFollowupRequest(new Request(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), orderId, type: "delivery-delay", title: "يرجى متابعة الطرد", description: "المتابعة الخاصة بالمستخدم", attachmentIds: [] }),
      }), { database, account, state, rateLimit: async () => {} });
      return result.followup;
    };
    const first = await create("parcel-first");
    const second = await create("parcel-second");
    const foreign = await create("parcel-other", other);

    await t.test("first directory entry and immediate customer selection return both tickets for each staff role", async () => {
      for (const account of [admin, courier]) {
        const directory = await read("/customers", account);
        assert.equal(directory.response.status, 200);
        assert.equal(directory.response.headers.get("Cache-Control"), "no-store");
        const customer = directory.payload.customers.find((item) => item.id === merchant.id);
        assert.deepEqual(customer, { id: merchant.id, name: merchant.name, store: merchant.store, orderCount: 2, followupCount: 2, openCount: 2 });
        const selected = await read(`?merchantId=${customer.id}`, account);
        assert.equal(selected.response.status, 200);
        assert.deepEqual(new Set(selected.payload.followups.map((item) => item.id)), new Set([first.id, second.id]));
        assert.ok(selected.payload.followups.every((item) => item.merchantId === customer.id));
        assert.equal(selected.payload.nextCursor, null);
        assert.equal(directory.payload.customers.find((item) => item.id === empty.id).followupCount, 0);
      }
    });

    await t.test("legacy ownership payloads, merchant isolation and account switching remain enforced", async () => {
      const legacy = { ...first }; delete legacy.merchantId;
      await database.prepare("UPDATE almadina_followups SET payload = ?, merchant_id = ? WHERE id = ?")
        .bind(JSON.stringify(legacy), "stale-owner", first.id).run();
      const selected = await read(`?merchantId=${merchant.id}`, courier);
      assert.ok(selected.payload.followups.every((item) => item.merchantId === merchant.id));
      assert.deepEqual((await read(`?merchantId=${other.id}`, merchant)).payload.followups, []);
      assert.deepEqual((await read(`?merchantId=${merchant.id}&orderId=parcel-other`, admin)).payload.followups, []);
      assert.deepEqual((await read(`?merchantId=${other.id}`, other)).payload.followups.map((item) => item.id), [foreign.id]);
      assert.equal((await read("/customers", merchant)).response.status, 403);
      assert.equal((await read(`?merchantId=${merchant.id}`, courier, admin.id)).response.status, 409);
    });

    await t.test("filtered PostgreSQL cursor pages preserve all tickets exactly once", async () => {
      for (let index = 0; index < 55; index += 1) await create("parcel-first");
      const page1 = (await read(`?merchantId=${merchant.id}`, courier)).payload;
      assert.equal(page1.followups.length, 50);
      assert.ok(page1.nextCursor);
      const page2 = (await read(`?merchantId=${merchant.id}&cursor=${encodeURIComponent(page1.nextCursor)}`, courier)).payload;
      assert.equal(page2.followups.length, 7);
      assert.equal(page2.nextCursor, null);
      assert.equal(new Set([...page1.followups, ...page2.followups].map((item) => item.id)).size, 57);
      assert.ok([...page1.followups, ...page2.followups].every((item) => item.merchantId === merchant.id));
      const directory = (await read("/customers", courier)).payload;
      assert.equal(directory.customers.find((item) => item.id === merchant.id).followupCount, 57);
    });

    await t.test("PostgreSQL structured edits, immutable retries, private conversation pages and optimistic conflicts", async () => {
      const call = (path, body, account = merchant, rateLimit = async () => {}) => handleFollowupRequest(new Request(`${base}${path}`, {
        ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      }), { database, state, account, rateLimit });
      const originalOrders = structuredClone(state.orders);
      const body = { requestId: crypto.randomUUID(), orderId: "parcel-first", type: "price-change", title: "تعديل السعر", description: "السعر المطلوب", detailsVersion: 1, requestedPrice: "120.00", attachmentIds: [] };
      const original = (await call("", body)).followup;
      assert.equal(original.requestedPrice, "120"); assert.match(original.ticketNumber, /^TK-\d{8,}$/);
      const edit = (extra) => ({ requestId: crypto.randomUUID(), expectedUpdatedAt: original.updatedAt, title: original.title, description: original.description, requestedPrice: "150", attachmentIds: [], ...extra });
      const changes = [edit({ title: "تعديل أول" }), edit({ title: "تعديل آخر" })];
      const outcomes = await Promise.allSettled(changes.map((change) => call(`/${original.id}/edit`, change)));
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(outcomes.find((item) => item.status === "rejected").reason.status, 409);
      const winnerIndex = outcomes.findIndex((item) => item.status === "fulfilled");
      assert.deepEqual(await call(`/${original.id}/edit`, changes[winnerIndex]), outcomes[winnerIndex].value);
      assert.deepEqual((await call("", body)).followup, original);
      await assert.rejects(call(`/${original.id}/edit`, changes[winnerIndex], courier), (error) => error.status === 403);
      const media = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
      const upload = await call("/uploads", { requestId: crypto.randomUUID(), orderId: "parcel-first", name: "evidence.png", mimeType: "image/png", size: media.length, chunkCount: 1 });
      const commentBody = { requestId: crypto.randomUUID(), text: "صورة خاصة", attachmentIds: [upload.uploadId] };
      await assert.rejects(call(`/${original.id}/comments`, commentBody), (error) => error.status === 409);
      await call(`/uploads/${upload.uploadId}/chunks`, { index: 0, dataBase64: media.toString("base64") });
      const mediaComment = (await call(`/${original.id}/comments`, commentBody)).comment;
      assert.deepEqual((await call(`/${original.id}/comments`, commentBody)).comment, mediaComment);
      const current = (await call(`/${original.id}`)).followup;
      await assert.rejects(call(`/${original.id}/edit`, edit({ expectedUpdatedAt: current.updatedAt, attachmentIds: [upload.uploadId] })), (error) => error.status === 409);
      assert.equal((await call(`/attachments/${upload.uploadId}`, undefined, courier)).dataBase64, media.toString("base64"));
      await assert.rejects(call(`/attachments/${upload.uploadId}`, undefined, other), (error) => error.status === 404);
      for (let index = 0; index < 56; index++) await call(`/${original.id}/comments`, { requestId: crypto.randomUUID(), text: `رسالة ${index}`, attachmentIds: [] }, courier);
      const page1 = await call(`/${original.id}/comments`);
      const page2 = await call(`/${original.id}/comments?cursor=${encodeURIComponent(page1.nextCursor)}`);
      assert.equal(page1.comments.length, 50); assert.equal(page2.comments.length, 7); assert.equal(page2.nextCursor, null);
      assert.equal(new Set([...page1.comments, ...page2.comments].map((comment) => comment.id)).size, 57);
      assert.ok(page2.comments.some((comment) => comment.id === mediaComment.id));
      const repeated = { requestId: crypto.randomUUID(), text: "متزامن", attachmentIds: [] };
      const copies = await Promise.all([call(`/${original.id}/comments`, repeated), call(`/${original.id}/comments`, repeated)]);
      assert.deepEqual(copies[0], copies[1]);
      assert.deepEqual(state.orders, originalOrders);
    });

    await t.test("PostgreSQL finalization cannot restore parent or author data after account purge", async () => {
      for (const purgeParent of [true, false]) {
        const suffix = purgeParent ? "parent" : "author";
        const isolatedMerchant = { ...merchant, id: `purge-merchant-${suffix}` };
        const isolatedCourier = { ...courier, id: `purge-courier-${suffix}` };
        const order = { ...state.orders[0], id: `purge-parcel-${suffix}`, merchantId: isolatedMerchant.id };
        const isolatedState = { ...state, users: [...state.users, isolatedMerchant, isolatedCourier], orders: [...state.orders, order] };
        const call = (path, body, account, rateLimit = async () => {}) => handleFollowupRequest(new Request(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { database, state: isolatedState, account, rateLimit });
        const ticket = (await call("", { requestId: crypto.randomUUID(), orderId: order.id, type: "delivery-delay", title: "متابعة", description: "تفاصيل", attachmentIds: [] }, isolatedMerchant)).followup;
        await assert.rejects(call(`/${ticket.id}/comments`, { requestId: crypto.randomUUID(), text: "must not persist", attachmentIds: [] }, isolatedCourier, async (namespace) => {
          if (namespace === "followup-comment") await database.batch(followupAccountPurge(database, purgeParent ? isolatedMerchant : isolatedCourier));
        }), (error) => error.status === 409);
        assert.equal(Number((await database.prepare("SELECT COUNT(*) AS count FROM almadina_followup_comments WHERE followup_id = ?").bind(ticket.id).first()).count), 0);
        assert.equal(Number((await database.prepare("SELECT COUNT(*) AS count FROM almadina_followup_mutations WHERE actor_id = ?").bind(isolatedCourier.id).first()).count), 0);
        assert.equal(Number((await database.prepare("SELECT COUNT(*) AS count FROM almadina_followups WHERE id = ?").bind(ticket.id).first()).count), purgeParent ? 0 : 1);
      }
    });

    await t.test("PostgreSQL soft delete keeps private records, filters counts and denies content and receipt replays", async () => {
      const call = (path, body, account = merchant, rateLimit = async () => {}) => handleFollowupRequest(new Request(`${base}${path}`, {
        ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      }), { database, state, account, rateLimit });
      const originalOrders = structuredClone(state.orders);
      const body = { requestId: crypto.randomUUID(), orderId: "parcel-first", type: "delivery-delay", title: "متابعة للحذف", description: "بيانات خاصة محفوظة", attachmentIds: [] };
      const ticket = (await call("", body)).followup;
      const media = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
      const upload = await call("/uploads", { requestId: crypto.randomUUID(), orderId: ticket.orderId, name: "private.png", mimeType: "image/png", size: media.length, chunkCount: 1 });
      await call(`/uploads/${upload.uploadId}/chunks`, { index: 0, dataBase64: media.toString("base64") });
      const comment = { requestId: crypto.randomUUID(), text: "محادثة محفوظة", attachmentIds: [upload.uploadId] };
      await call(`/${ticket.id}/comments`, comment);
      const changed = (await call(`/${ticket.id}/status`, { status: "resolved" }, admin)).followup;
      const deletion = { orderId: ticket.orderId, expectedUpdatedAt: changed.updatedAt };
      await assert.rejects(call(`/${ticket.id}/delete`, deletion, courier), (error) => error.status === 403);
      await assert.rejects(call(`/${ticket.id}/delete`, deletion, other), (error) => error.status === 404);
      await assert.rejects(call(`/${ticket.id}/delete`, { ...deletion, expectedUpdatedAt: ticket.updatedAt }), (error) => error.status === 409);
      const countsBefore = (await read("/customers", admin)).payload.customers.find((item) => item.id === merchant.id);
      const replies = await Promise.all([call(`/${ticket.id}/delete`, deletion), call(`/${ticket.id}/delete`, deletion, admin)]);
      assert.deepEqual(replies[0], { deleted: true, followupId: ticket.id, orderId: ticket.orderId });
      assert.deepEqual(replies[0], replies[1]);
      assert.deepEqual(await call(`/${ticket.id}/delete`, deletion), replies[0]);
      for (const [path, replay] of [[`/${ticket.id}`], [`/${ticket.id}/comments`], [`/${ticket.id}/comments`, comment], ["", body], [`/attachments/${upload.uploadId}`], [`/${ticket.id}/status`, { status: "open" }]]) {
        await assert.rejects(call(path, replay), (error) => error.status === 404);
      }
      assert.equal((await read("?orderId=parcel-first", admin)).payload.followups.some((item) => item.id === ticket.id), false);
      const countsAfter = (await read("/customers", admin)).payload.customers.find((item) => item.id === merchant.id);
      assert.equal(countsAfter.followupCount, countsBefore.followupCount - 1);
      assert.equal(countsAfter.openCount, countsBefore.openCount);
      for (const [table, column, value] of [["almadina_followups", "id", ticket.id], ["almadina_followup_comments", "followup_id", ticket.id], ["almadina_followup_chunks", "upload_id", upload.uploadId], ["almadina_followup_deleted", "followup_id", ticket.id]]) {
        assert.equal(Number((await database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).bind(value).first()).count), 1);
      }
      assert.deepEqual(state.orders, originalOrders);
    });

    await t.test("PostgreSQL lifecycle guards serialize deletion against pending edit, comment and status finalization", async () => {
      const call = (path, body, account = merchant, rateLimit = async () => {}) => handleFollowupRequest(new Request(`${base}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }), { database, state, account, rateLimit });
      for (const operation of ["edit", "comment", "status"]) {
        const ticket = await create("parcel-first");
        const before = (await database.prepare("SELECT payload FROM almadina_followups WHERE id = ?").bind(ticket.id).first()).payload;
        const token = crypto.randomUUID();
        const body = operation === "edit" ? { requestId: token, expectedUpdatedAt: ticket.updatedAt, title: "cannot persist", description: ticket.description, attachmentIds: [] }
          : operation === "comment" ? { requestId: token, text: "cannot persist", attachmentIds: [] }
          : { status: "resolved", response: "cannot persist" };
        await assert.rejects(call(`/${ticket.id}/${operation === "comment" ? "comments" : operation}`, body, operation === "status" ? admin : merchant, async (namespace) => {
          if (namespace === `followup-${operation}`) await call(`/${ticket.id}/delete`, { orderId: ticket.orderId, expectedUpdatedAt: ticket.updatedAt });
        }), (error) => error.status === 409);
        assert.equal((await database.prepare("SELECT payload FROM almadina_followups WHERE id = ?").bind(ticket.id).first()).payload, before);
        assert.equal(Number((await database.prepare("SELECT COUNT(*) AS count FROM almadina_followup_comments WHERE followup_id = ?").bind(ticket.id).first()).count), 0);
        assert.equal(Number((await database.prepare("SELECT COUNT(*) AS count FROM almadina_followup_mutations WHERE request_id = ?").bind(token).first()).count), 0);
      }
    });

    await t.test("fresh reads track current parcel ownership and exclude deleted parcels", async () => {
      state.orders[0].deleted = true;
      state.orders[1].merchantId = other.id;
      await saveState();
      const directory = (await read("/customers", admin)).payload;
      assert.equal(directory.customers.find((item) => item.id === merchant.id).followupCount, 0);
      assert.equal(directory.customers.find((item) => item.id === other.id).followupCount, 2);
      assert.deepEqual((await read(`?merchantId=${merchant.id}`, courier)).payload.followups, []);
      const reassigned = (await read(`?merchantId=${other.id}`, courier)).payload.followups;
      assert.deepEqual(new Set(reassigned.map((item) => item.id)), new Set([second.id, foreign.id]));
      assert.ok(reassigned.every((item) => item.merchantId === other.id));
      assert.equal((await read(`/${first.id}`, courier)).response.status, 404);
    });
  } finally {
    await engine.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
