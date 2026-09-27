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
    const { handleFollowupRequest } = await import(pathToFileURL(join(temporary, "server-followups.mjs")));
    const { handleAlmadinaApi } = await import(pathToFileURL(join(temporary, "server-database.mjs")));
    const { PostgresD1Database } = await import(pathToFileURL(join(temporary, "postgres-d1-adapter.mjs")));
    const pool = {
      async query(sql, values = []) {
        const result = await engine.query(sql, values);
        // pg returns int8 aggregates as strings by default. Match that wire
        // representation while executing the actual query with PostgreSQL.
        const rows = result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
          [key, ["followup_count", "open_count"].includes(key) ? String(value) : value])));
        return { rows, rowCount: result.affectedRows ?? rows.length };
      },
      async connect() { return { query: this.query.bind(this), release() {} }; },
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
