import assert from "node:assert/strict";
import test from "node:test";
import { canHideCollection, canPurgeOrder, hiddenCollectionIds, normalizeCollectionVisibility, purgedCollectionIds, purgeSelectedTrash, setCollectionHidden } from "../app/lib/collection-visibility.ts";
import { createSeedDatabase, isOrderInvoicedForCurrentShipment, removeLegacyDemoData } from "../app/lib/data.ts";
import { matchRegistrationMapAddress } from "../app/lib/registration-map-address.ts";
import { reverseGeocode } from "../app/lib/reverse-geocoding.ts";

const TEST_ADMIN_PASSWORD = "Admin@Test-2026!";

test("invoice list deletion preserves settlement, respects roles, and restores without duplicate billing", () => {
  const database = createSeedDatabase();
  database.users = [
    { id: "owner", role: "merchant" }, { id: "other", role: "merchant" },
    { id: "courier", role: "courier" }, { id: "admin", role: "admin" },
  ];
  const order = { id: "o1", status: "delivered", shippedAt: "2026-09-01T00:00:00Z" };
  const invoice = { id: "i1", merchantId: "owner", status: "paid", paidAt: "2026-09-05T00:00:00Z", orderIds: ["o1"], netAmount: 85 };
  database.orders = [order];
  database.collections = [invoice];
  database.preferences = { owner: { sounds: false, custom: "preserve" }, other: { hiddenCollectionIds: ["i2"] } };
  const hidden = setCollectionHidden(database, "owner", "i1", true);
  assert.deepEqual([...hiddenCollectionIds(hidden, "owner")], ["i1"]);
  assert.strictEqual(hidden.collections, database.collections);
  assert.strictEqual(hidden.orders, database.orders);
  assert.equal(isOrderInvoicedForCurrentShipment(order, hidden.collections), true);
  assert.deepEqual(hidden.preferences.other, database.preferences.other);
  assert.equal(hidden.preferences.owner.sounds, false);
  assert.equal(hidden.preferences.owner.custom, "preserve");
  assert.deepEqual(setCollectionHidden(hidden, "owner", "i1", true), hidden);
  const restored = setCollectionHidden(hidden, "owner", "i1", false);
  assert.equal(hiddenCollectionIds(restored, "owner").size, 0);
  assert.equal(isOrderInvoicedForCurrentShipment(order, restored.collections), true);
  for (const id of ["other", "courier", "missing"]) assert.strictEqual(setCollectionHidden(database, id, "i1", true), database);
  assert.strictEqual(setCollectionHidden(database, "owner", "missing", true), database);
  assert.equal(hiddenCollectionIds(setCollectionHidden(database, "admin", "i1", true), "admin").has("i1"), true);
  assert.equal(hiddenCollectionIds(database, "owner").size, 0);
});

test("outstanding invoices cannot be hidden, regardless of amount, and old hidden entries reappear", () => {
  for (const role of ["merchant", "admin"]) for (const status of ["pending", "ready", "unknown"]) for (const netAmount of [-75, 0, 75]) {
    const db = createSeedDatabase();
    db.users = [{ id: "owner", role }];
    db.collections = [{ id: "due", merchantId: "owner", status, netAmount }];
    db.preferences = { owner: { sounds: false, hiddenCollectionIds: ["due", "missing"] } };
    assert.equal(canHideCollection(db.users[0], db.collections[0]), false);
    assert.strictEqual(setCollectionHidden(db, "owner", "due", true), db);
    assert.deepEqual([...hiddenCollectionIds(db, "owner")], []);
    const normalized = normalizeCollectionVisibility(db);
    assert.deepEqual(normalized.preferences.owner.hiddenCollectionIds, []);
    assert.equal(normalized.preferences.owner.sounds, false);
    assert.strictEqual(normalized.collections, db.collections);
    assert.deepEqual(setCollectionHidden(db, "owner", "due", false).preferences.owner.hiddenCollectionIds, []);
    for (const amount of [-75, 0, 75]) assert.equal(canHideCollection(db.users[0], { ...db.collections[0], status: "paid", netAmount: amount }), true);
  }
});

test("matches a reverse-geocoded pin to the supported registration address", () => {
  assert.deepEqual(matchRegistrationMapAddress({
    state: "محافظة نابلس",
    city: "نابلس",
    suburb: "رفيديا",
    street: "شارع الجامعة",
    houseNumber: "12",
  }), {
    governorate: "نابلس",
    city: "نابلس",
    address: "شارع الجامعة، مبنى 12",
  });
});

test("reads both supported Geoapify reverse-geocoding response shapes", async () => {
  const originalFetch = globalThis.fetch;
  const replies = [
    {
      results: [{
        state_district: "محافظة نابلس",
        city: "نابلس",
        suburb: "رفيديا",
        street: "شارع الجامعة",
        housenumber: "12",
      }],
    },
    {
      features: [{
        properties: {
          state: "محافظة رام الله والبيرة",
          city: "رام الله",
          neighbourhood: "الطيرة",
          address_line1: "شارع الإرسال",
        },
      }],
    },
  ];
  try {
    globalThis.fetch = async () => Response.json(replies.shift());
    const resultShape = await reverseGeocode({ geoapifyApiKey: "test-key" }, { latitude: 32.2211, longitude: 35.2544 });
    assert.equal(resultShape.stateDistrict, "محافظة نابلس");
    assert.equal(resultShape.houseNumber, "12");

    const featureShape = await reverseGeocode({ geoapifyApiKey: "test-key" }, { latitude: 31.9038, longitude: 35.2034 });
    assert.equal(featureShape.state, "محافظة رام الله والبيرة");
    assert.equal(featureShape.neighbourhood, "الطيرة");
    assert.equal(featureShape.addressLine1, "شارع الإرسال");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes legacy shipped collection invoices as delivered and paid", () => {
  const database = createSeedDatabase();
  const now = new Date().toISOString();
  const merchant = {
    id: "merchant-legacy-collection",
    name: "تاجر فاتورة قديمة",
    email: "legacy-collection@example.test",
    password: "Customer@123",
    phone: "0591111111",
    store: "متجر الفاتورة القديمة",
    role: "merchant",
    joinedAt: now,
  };
  database.users.push(merchant);
  database.collections.push({
    id: "legacy-shipped-collection",
    merchantId: merchant.id,
    merchantName: merchant.name,
    invoiceNumber: "#LEGACY-1",
    orderIds: [],
    grossAmount: 100,
    deliveryFees: 20,
    returnFees: 0,
    netAmount: 80,
    deliveredCount: 1,
    returnedCount: 0,
    status: "shipped",
    verificationCode: "1234",
    authorizedRecipient: "المستلم المفوض",
    createdAt: now,
    updatedAt: now,
    scheduledAt: now,
    shippedAt: now,
    verifiedAt: now,
  });

  const normalized = removeLegacyDemoData(database);
  assert.equal(normalized.collections[0].status, "paid");
  assert.equal(normalized.collections[0].paidAt, now);
});

class FakeD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql.trim().replace(/\s+/g, " ");
    this.values = values;
  }

  bind(...values) {
    return new FakeD1Statement(this.database, this.sql, values);
  }

  async first() {
    if (this.sql.startsWith("INSERT INTO almadina_rate_limits")) {
      const [keyHash, action, resetAt, now] = this.values;
      const current = this.database.rateLimits.get(keyHash);
      const next = !current || current.reset_at <= now
        ? { key_hash: keyHash, action, request_count: 1, reset_at: resetAt }
        : { ...current, action, request_count: current.request_count + 1 };
      this.database.rateLimits.set(keyHash, next);
      return { request_count: next.request_count, reset_at: next.reset_at };
    }

    if (this.sql.startsWith("SELECT revision FROM almadina_state")) {
      return this.database.state ? { revision: this.database.state.revision } : null;
    }

    if (this.sql.startsWith("SELECT payload, revision FROM almadina_state")) {
      return this.database.state ? { payload: this.database.state.payload, revision: this.database.state.revision } : null;
    }

    if (this.sql.startsWith("SELECT request_count, reset_at FROM almadina_rate_limits WHERE key_hash")) {
      return this.database.rateLimits.get(this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT platform, model, os_version, app_version, label, location, location_updated_at FROM almadina_session_details WHERE token_hash")) return this.database.sessionDetails.get(this.values[0]) ?? null;

    if (this.sql.startsWith("SELECT user_id, expires_at, created_at FROM almadina_sessions")) {
      const session = this.database.sessions.get(this.values[0]);
      return session ? { user_id: session.user_id, expires_at: session.expires_at, created_at: session.created_at } : null;
    }

    if (this.sql.startsWith("SELECT user_id, pin_hash, enabled, biometric_enabled, failed_attempts, locked_until FROM almadina_app_locks")) {
      return this.database.appLocks.get(this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT credential_id FROM almadina_webauthn_credentials WHERE user_id")) {
      return [...this.database.credentials.values()].find((credential) => credential.user_id === this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT credential_id FROM almadina_passkey_login_credentials WHERE user_id")) {
      return [...this.database.passkeyLoginCredentials.values()].find((credential) => credential.user_id === this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT challenge, origin, rp_id, expires_at FROM almadina_webauthn_challenges")) {
      return this.database.challenges.get(`${this.values[0]}:${this.values[2]}`) ?? null;
    }

    if (this.sql.startsWith("SELECT user_id FROM almadina_webauthn_credentials WHERE credential_id")) {
      return this.database.credentials.get(this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT credentials.credential_id") && this.sql.includes("INNER JOIN almadina_passkey_login_credentials")) {
      const credential = this.database.credentials.get(this.values[0]);
      return credential && this.database.passkeyLoginCredentials.has(this.values[0]) ? credential : null;
    }

    if (this.sql.startsWith("SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM almadina_webauthn_credentials WHERE credential_id")) {
      const credential = this.database.credentials.get(this.values[0]);
      return credential?.user_id === this.values[1] ? credential : null;
    }

    if (this.sql.startsWith("DELETE FROM almadina_webauthn_challenges") && this.sql.includes("RETURNING challenge")) {
      const key = `${this.values[0]}:${this.values[2]}`;
      const challenge = this.database.challenges.get(key) ?? null;
      if (challenge?.user_id !== this.values[1]) return null;
      this.database.challenges.delete(key);
      return challenge;
    }

    if (this.sql.includes("FROM almadina_password_reset_requests WHERE request_hash = ?")) {
      return this.database.passwordResets.get(this.values[0]) ?? null;
    }

    if (this.sql.includes("FROM almadina_password_reset_requests") && this.sql.includes("WHERE reset_token_hash = ?")) {
      const [resetTokenHash, now] = this.values;
      return [...this.database.passwordResets.values()].find((entry) => (
        entry.reset_token_hash === resetTokenHash
        && entry.verified_at !== null
        && entry.reset_expires_at > now
      )) ?? null;
    }

    if (this.sql.includes("FROM almadina_registration_requests WHERE request_hash = ?")) {
      return this.database.registrationRequests.get(this.values[0]) ?? null;
    }

    if (this.sql.includes("FROM almadina_registration_locations WHERE request_hash = ?")) {
      return this.database.registrationLocations.get(this.values[0]) ?? null;
    }

    if (this.sql.startsWith("UPDATE almadina_password_reset_requests SET verified_at") && this.sql.includes("RETURNING user_id")) {
      const [verifiedAt, resetTokenHash, resetExpiresAt, failedAttempts, requestHash, userId, codeHash, now, maxFailedAttempts] = this.values;
      const reset = this.database.passwordResets.get(requestHash);
      if (!reset
        || reset.user_id !== userId
        || reset.code_hash !== codeHash
        || reset.verified_at !== null
        || reset.expires_at <= now
        || reset.failed_attempts >= maxFailedAttempts) return null;

      Object.assign(reset, {
        verified_at: verifiedAt,
        reset_token_hash: resetTokenHash,
        reset_expires_at: resetExpiresAt,
        code_hash: "",
        failed_attempts: failedAttempts,
      });
      return { user_id: reset.user_id };
    }

    throw new Error(`Unsupported mock D1 first() query: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith("SELECT sessions.token_hash, sessions.created_at")) {
      const [userId, now] = this.values;
      const results = [...this.database.sessions.values()]
        .filter((session) => session.user_id === userId && session.expires_at > now)
        .map((session) => {
          const device = this.database.sessionDevices.get(session.token_hash);
          return {
            token_hash: session.token_hash,
            created_at: session.created_at,
            device_name: device?.device_name ?? null,
            device_type: device?.device_type ?? null,
            browser_name: device?.browser_name ?? null,
            last_active_at: device?.last_active_at ?? null,
            ...(this.database.sessionDetails.get(session.token_hash) ?? {}),
          };
        })
        .sort((first, second) => (second.last_active_at ?? second.created_at).localeCompare(first.last_active_at ?? first.created_at));
      return { results, success: true, meta: { changes: 0 } };
    }

    if (this.sql.startsWith("SELECT token_hash FROM almadina_sessions WHERE user_id")) {
      const [userId, now] = this.values;
      return {
        results: [...this.database.sessions.values()]
          .filter((session) => session.user_id === userId && session.expires_at > now)
          .map((session) => ({ token_hash: session.token_hash })),
        success: true,
        meta: { changes: 0 },
      };
    }

    if (this.sql.startsWith("SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM almadina_webauthn_credentials WHERE user_id")) {
      return { results: [...this.database.credentials.values()].filter((credential) => credential.user_id === this.values[0]), success: true, meta: { changes: 0 } };
    }
    throw new Error(`Unsupported mock D1 all() query: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("CREATE TABLE") || this.sql.startsWith("CREATE INDEX")) return { success: true, meta: { changes: 0 } };
    if (this.sql.startsWith("DELETE FROM almadina_web_push_subscriptions")) return { success: true, meta: { changes: 0 } };
    // This snapshot fixture has no ticket/comment/media rows. The independent
    // SQLite and PostgreSQL tests execute actual follow-up SQL and purge races.
    // Model the exact singleton/revocation statements used during shared schema
    // initialization and account deletion; unknown SQL must still fail loudly.
    if (this.sql === "INSERT INTO almadina_followup_lifecycle (id, lock_version) VALUES ('main', 0) ON CONFLICT (id) DO NOTHING") {
      const changes = Number(this.database.followupLifecycle === null);
      this.database.followupLifecycle ??= 0;
      return { success: true, meta: { changes } };
    }
    if (this.sql === "INSERT INTO almadina_followup_sequence (id, next_value) VALUES ('main', 0) ON CONFLICT (id) DO NOTHING") {
      const changes = Number(this.database.followupSequence === null);
      this.database.followupSequence ??= 0;
      return { success: true, meta: { changes } };
    }
    if (this.sql === "UPDATE almadina_followup_lifecycle SET lock_version = lock_version + 1 WHERE id = 'main'") {
      if (this.database.followupLifecycle === null) return { success: true, meta: { changes: 0 } };
      this.database.followupLifecycle += 1;
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql === "INSERT INTO almadina_followup_revoked (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING") {
      const changes = Number(!this.database.followupRevoked.has(this.values[0]));
      this.database.followupRevoked.add(this.values[0]);
      return { success: true, meta: { changes } };
    }
    if (/^DELETE FROM almadina_followup(?:s|_uploads|_chunks|_owners|_comments|_comment_media|_mutations|_references)\b/.test(this.sql)) return { success: true, meta: { changes: 0 } };

    if (this.sql.startsWith("INSERT INTO almadina_state") && this.sql.includes("ON CONFLICT (id) DO NOTHING")) {
      if (this.database.state) return { success: true, meta: { changes: 0 } };
      this.database.state = { id: this.values[0], payload: this.values[1], revision: this.values[2], updated_at: this.values[3] };
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_state SET payload")) {
      if (!this.database.state || this.database.state.id !== this.values[2] || this.database.state.revision !== this.values[3]) {
        return { success: true, meta: { changes: 0 } };
      }

      if (this.sql.includes("EXISTS (SELECT 1 FROM almadina_password_reset_requests")) {
        const resetTokenHash = this.values[4];
        const userId = this.values[5];
        const now = this.values[6];
        const reset = [...this.database.passwordResets.values()].find((entry) => (
          entry.reset_token_hash === resetTokenHash
          && entry.user_id === userId
          && entry.verified_at !== null
          && entry.reset_expires_at > now
        ));
        if (!reset) return { success: true, meta: { changes: 0 } };
      }

      if (this.sql.includes("EXISTS (SELECT 1 FROM almadina_registration_requests")) {
        const requestHash = this.values[4];
        const codeHash = this.values[5];
        const now = this.values[6];
        const maxFailedAttempts = this.values[7];
        const registration = this.database.registrationRequests.get(requestHash);
        if (!registration
          || registration.code_hash !== codeHash
          || registration.expires_at <= now
          || registration.failed_attempts >= maxFailedAttempts) return { success: true, meta: { changes: 0 } };
      }

      this.database.state = {
        ...this.database.state,
        payload: this.values[0],
        updated_at: this.values[1],
        revision: this.database.state.revision + 1,
      };
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_sessions")) {
      this.database.sessions.set(this.values[0], {
        token_hash: this.values[0],
        user_id: this.values[1],
        expires_at: this.values[2],
        created_at: this.values[3],
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_session_details")) {
      const [token_hash, user_id, platform, model, os_version, app_version, label, location, location_updated_at] = this.values;
      const session = this.database.sessions.get(token_hash);
      if (!session || session.user_id !== user_id) return { success: true, meta: { changes: 0 } };
      const old = this.database.sessionDetails.get(token_hash);
      if (!old) this.database.sessionDetails.set(token_hash, { token_hash, user_id, platform, model, os_version, app_version, label, location, location_updated_at });
      else if (old.user_id === user_id) {
        const compatible = old.platform === 'unknown' || old.platform === platform;
        if (compatible && model) old.model = model;
        if (compatible && os_version) old.os_version = os_version;
        if (compatible && app_version) old.app_version = app_version;
        if (old.platform === 'unknown') old.platform = platform;
        old.location ??= location; old.location_updated_at ??= location_updated_at;
      }
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE almadina_session_details SET label")) {
      const [label, hash, userId, expectedHash, expectedUser, now] = this.values;
      const session = this.database.sessions.get(expectedHash), details = this.database.sessionDetails.get(hash);
      if (!details || details.user_id !== userId || !session || session.user_id !== expectedUser || session.expires_at <= now) return { success: true, meta: { changes: 0 } };
      details.label = label;
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_session_devices")) {
      const [tokenHash, userId, deviceName, deviceType, browserName, createdAt, lastActiveAt] = this.values;
      const staleBefore = this.values.at(-1);
      if (this.sql.includes("FROM almadina_sessions WHERE token_hash")) {
        const parent = this.database.sessions.get(this.values[7]);
        if (!parent || parent.user_id !== this.values[8] || parent.expires_at <= this.values[9]) return { success: true, meta: { changes: 0 } };
      }
      const current = this.database.sessionDevices.get(tokenHash);
      if (!current) {
        this.database.sessionDevices.set(tokenHash, {
          token_hash: tokenHash,
          user_id: userId,
          device_name: deviceName,
          device_type: deviceType,
          browser_name: browserName,
          created_at: createdAt,
          last_active_at: lastActiveAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (this.sql.includes("ON CONFLICT") && (current.last_active_at <= staleBefore || current.device_name !== deviceName)) {
        Object.assign(current, {
          user_id: userId,
          device_name: deviceType === "unknown" ? current.device_name : deviceName,
          device_type: deviceType === "unknown" ? current.device_type : deviceType,
          browser_name: deviceType === "unknown" ? current.browser_name : browserName,
          last_active_at: lastActiveAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_sessions WHERE user_id")) {
      let changes = 0;
      for (const [tokenHash, session] of this.database.sessions) {
        if (session.user_id !== this.values[0]) continue;
        this.database.sessions.delete(tokenHash);
        this.database.sessionDetails.delete(tokenHash); // ON DELETE CASCADE
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_sessions WHERE token_hash")) {
      const session = this.database.sessions.get(this.values[0]);
      if (this.sql.includes("AND user_id") && session?.user_id !== this.values[1]) return { success: true, meta: { changes: 0 } };
      this.database.sessionDetails.delete(this.values[0]); // ON DELETE CASCADE
      return { success: true, meta: { changes: Number(this.database.sessions.delete(this.values[0])) } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_session_devices WHERE user_id")) {
      let changes = 0;
      for (const [tokenHash, device] of this.database.sessionDevices) {
        if (device.user_id !== this.values[0]) continue;
        this.database.sessionDevices.delete(tokenHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_session_devices WHERE token_hash")) {
      const device = this.database.sessionDevices.get(this.values[0]);
      if (this.sql.includes("AND user_id") && device?.user_id !== this.values[1]) return { success: true, meta: { changes: 0 } };
      return { success: true, meta: { changes: Number(this.database.sessionDevices.delete(this.values[0])) } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_app_locks")) {
      this.database.appLocks.set(this.values[0], {
        user_id: this.values[0], pin_hash: this.values[1], enabled: 1, biometric_enabled: 0,
        failed_attempts: 0, locked_until: 0, updated_at: this.values[2],
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_app_locks SET failed_attempts = ?")) {
      const lock = this.database.appLocks.get(this.values[3]);
      if (!lock) return { success: true, meta: { changes: 0 } };
      Object.assign(lock, { failed_attempts: this.values[0], locked_until: this.values[1], updated_at: this.values[2] });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_app_locks SET failed_attempts = 0")) {
      const lock = this.database.appLocks.get(this.values[1]);
      if (!lock) return { success: true, meta: { changes: 0 } };
      Object.assign(lock, { failed_attempts: 0, locked_until: 0, updated_at: this.values[0] });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_app_locks SET biometric_enabled =")) {
      const enabled = this.sql.includes("biometric_enabled = 1") ? 1 : 0;
      const lock = this.database.appLocks.get(this.values[1]);
      if (!lock) return { success: true, meta: { changes: 0 } };
      Object.assign(lock, { biometric_enabled: enabled, updated_at: this.values[0] });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_app_locks WHERE user_id")) {
      return { success: true, meta: { changes: Number(this.database.appLocks.delete(this.values[0])) } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_webauthn_credentials WHERE user_id")) {
      let changes = 0;
      for (const [credentialId, credential] of this.database.credentials) {
        if (credential.user_id !== this.values[0]) continue;
        this.database.credentials.delete(credentialId);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_passkey_login_credentials WHERE user_id")) {
      let changes = 0;
      for (const [credentialId, credential] of this.database.passkeyLoginCredentials) {
        if (credential.user_id !== this.values[0]) continue;
        this.database.passkeyLoginCredentials.delete(credentialId);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_passkey_login_credentials")) {
      this.database.passkeyLoginCredentials.set(this.values[0], {
        credential_id: this.values[0], user_id: this.values[1], created_at: this.values[2],
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_webauthn_challenges WHERE user_id")) {
      let changes = 0;
      for (const [key, challenge] of this.database.challenges) {
        if (challenge.user_id !== this.values[0]) continue;
        this.database.challenges.delete(key);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_webauthn_challenges WHERE expires_at")) {
      let changes = 0;
      for (const [key, challenge] of this.database.challenges) {
        if (challenge.expires_at > this.values[0]) continue;
        this.database.challenges.delete(key);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_webauthn_challenges")) {
      this.database.challenges.set(`${this.values[0]}:${this.values[2]}`, {
        session_hash: this.values[0], user_id: this.values[1], kind: this.values[2], challenge: this.values[3],
        origin: this.values[4], rp_id: this.values[5], expires_at: this.values[6], created_at: this.values[7],
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_webauthn_challenges WHERE session_hash")) {
      return { success: true, meta: { changes: Number(this.database.challenges.delete(`${this.values[0]}:${this.values[1]}`)) } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_password_reset_requests")) {
      const [requestHash, userId, channel, codeHash, expiresAt, createdAt] = this.values;
      this.database.passwordResets.set(requestHash, {
        request_hash: requestHash,
        user_id: userId,
        channel,
        code_hash: codeHash,
        failed_attempts: 0,
        expires_at: expiresAt,
        verified_at: null,
        reset_token_hash: null,
        reset_expires_at: null,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_password_reset_requests") && this.sql.includes("verified_at IS NULL AND expires_at")) {
      const [now, resetNow] = this.values;
      let changes = 0;
      for (const [requestHash, reset] of this.database.passwordResets) {
        const expired = reset.verified_at === null
          ? reset.expires_at <= now
          : reset.reset_expires_at !== null && reset.reset_expires_at <= resetNow;
        if (!expired) continue;
        this.database.passwordResets.delete(requestHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_password_reset_requests WHERE user_id")) {
      const userId = this.values[0];
      if (this.sql.includes("AND EXISTS")) {
        const [, stateId, revision, payload] = this.values;
        if (!this.database.state
          || this.database.state.id !== stateId
          || this.database.state.revision !== revision
          || this.database.state.payload !== payload) return { success: true, meta: { changes: 0 } };
      }

      let changes = 0;
      for (const [requestHash, reset] of this.database.passwordResets) {
        if (reset.user_id !== userId) continue;
        this.database.passwordResets.delete(requestHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("UPDATE almadina_password_reset_requests SET user_id")) {
      if (this.sql.includes("SET user_id = '', code_hash = ''")) {
        const [failedAttempts, requestHash] = this.values;
        const reset = this.database.passwordResets.get(requestHash);
        if (!reset) return { success: true, meta: { changes: 0 } };
        Object.assign(reset, {
          user_id: "",
          code_hash: "",
          failed_attempts: failedAttempts,
          verified_at: null,
          reset_token_hash: null,
          reset_expires_at: null,
        });
        return { success: true, meta: { changes: 1 } };
      }

      const [userId, codeHash, requestHash] = this.values;
      const reset = this.database.passwordResets.get(requestHash);
      if (!reset) return { success: true, meta: { changes: 0 } };
      Object.assign(reset, { user_id: userId, code_hash: codeHash });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_password_reset_requests SET failed_attempts = failed_attempts + 1")) {
      const [requestHash, now, maxFailedAttempts] = this.values;
      const reset = this.database.passwordResets.get(requestHash);
      if (!reset
        || reset.verified_at !== null
        || reset.expires_at <= now
        || reset.failed_attempts >= maxFailedAttempts) return { success: true, meta: { changes: 0 } };
      reset.failed_attempts += 1;
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_password_reset_requests SET failed_attempts = ?")) {
      const [failedAttempts, requestHash] = this.values;
      const reset = this.database.passwordResets.get(requestHash);
      if (!reset) return { success: true, meta: { changes: 0 } };
      reset.failed_attempts = failedAttempts;
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_registration_requests")) {
      const [requestHash, email, name, phone, store, passwordHash, codeHash, expiresAt, createdAt] = this.values;
      this.database.registrationRequests.set(requestHash, {
        request_hash: requestHash,
        email,
        name,
        phone,
        store,
        password_hash: passwordHash,
        code_hash: codeHash,
        failed_attempts: 0,
        expires_at: expiresAt,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO almadina_registration_locations")) {
      const [requestHash, governorate, city, address, latitude, longitude, createdAt] = this.values;
      this.database.registrationLocations.set(requestHash, {
        request_hash: requestHash,
        governorate,
        city,
        address,
        latitude,
        longitude,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_registration_locations WHERE request_hash IN")) {
      let changes = 0;
      if (this.sql.includes("expires_at <=")) {
        const now = this.values[0];
        for (const [requestHash] of this.database.registrationLocations) {
          const registration = this.database.registrationRequests.get(requestHash);
          if (!registration || registration.expires_at > now) continue;
          this.database.registrationLocations.delete(requestHash);
          changes += 1;
        }
      } else {
        const [email, phone] = this.values;
        for (const [requestHash] of this.database.registrationLocations) {
          const registration = this.database.registrationRequests.get(requestHash);
          if (!registration || (registration.email !== email && registration.phone !== phone)) continue;
          this.database.registrationLocations.delete(requestHash);
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_registration_locations WHERE request_hash")) {
      const [requestHash] = this.values;
      if (this.sql.includes("AND EXISTS")) {
        const [, stateId, revision, payload] = this.values;
        if (!this.database.state
          || this.database.state.id !== stateId
          || this.database.state.revision !== revision
          || this.database.state.payload !== payload) return { success: true, meta: { changes: 0 } };
      }
      return { success: true, meta: { changes: Number(this.database.registrationLocations.delete(requestHash)) } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_registration_requests WHERE expires_at")) {
      const now = this.values[0];
      let changes = 0;
      for (const [requestHash, registration] of this.database.registrationRequests) {
        if (registration.expires_at > now) continue;
        this.database.registrationRequests.delete(requestHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_registration_requests WHERE email")) {
      const [email, phone] = this.values;
      let changes = 0;
      for (const [requestHash, registration] of this.database.registrationRequests) {
        if (registration.email !== email && registration.phone !== phone) continue;
        this.database.registrationRequests.delete(requestHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("UPDATE almadina_registration_requests SET failed_attempts = failed_attempts + 1")) {
      const [requestHash, now, maxFailedAttempts] = this.values;
      const registration = this.database.registrationRequests.get(requestHash);
      if (!registration || registration.expires_at <= now || registration.failed_attempts >= maxFailedAttempts) {
        return { success: true, meta: { changes: 0 } };
      }
      registration.failed_attempts += 1;
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_registration_requests WHERE request_hash")) {
      const [requestHash] = this.values;
      if (this.sql.includes("AND EXISTS")) {
        const [, stateId, revision, payload] = this.values;
        if (!this.database.state
          || this.database.state.id !== stateId
          || this.database.state.revision !== revision
          || this.database.state.payload !== payload) return { success: true, meta: { changes: 0 } };
      }
      return { success: true, meta: { changes: Number(this.database.registrationRequests.delete(requestHash)) } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_rate_limits WHERE reset_at")) {
      let changes = 0;
      for (const [keyHash, rateLimit] of this.database.rateLimits) {
        if (rateLimit.reset_at > this.values[0]) continue;
        this.database.rateLimits.delete(keyHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_rate_limits WHERE key_hash")) {
      return { success: true, meta: { changes: Number(this.database.rateLimits.delete(this.values[0])) } };
    }

    throw new Error(`Unsupported mock D1 run() query: ${this.sql}`);
  }
}

class FakeD1Database {
  state = null;
  sessions = new Map();
  sessionDevices = new Map();
  sessionDetails = new Map();
  appLocks = new Map();
  credentials = new Map();
  passkeyLoginCredentials = new Map();
  challenges = new Map();
  rateLimits = new Map();
  passwordResets = new Map();
  registrationRequests = new Map();
  registrationLocations = new Map();
  followupLifecycle = null;
  followupSequence = null;
  followupRevoked = new Set();

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }

  batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

async function loadWorker() {
  if (process.env.ALMADINA_SERVER_TEST_MODULE) {
    const { handleAlmadinaApi } = await import(process.env.ALMADINA_SERVER_TEST_MODULE);
    return {
      fetch: (request, environment, context) => handleAlmadinaApi(request, environment.DB, {
        supportPhone: environment.ALMADINA_SUPPORT_PHONE,
        supportEmail: environment.ALMADINA_SUPPORT_EMAIL,
        geoapifyApiKey: environment.GEOAPIFY_API_KEY,
        reverseGeocoder: environment.REVERSE_GEOCODER,
        sender: environment.PASSWORD_RESET_SENDER,
        bootstrapAdminEmail: environment.ALMADINA_ADMIN_EMAIL,
        bootstrapAdminPassword: environment.ALMADINA_ADMIN_PASSWORD,
        bootstrapAdminPhone: environment.ALMADINA_ADMIN_PHONE,
        bootstrapAdminName: environment.ALMADINA_ADMIN_NAME,
        secondaryAdminEmail: environment.ALMADINA_SECOND_ADMIN_EMAIL,
        secondaryAdminPassword: environment.ALMADINA_SECOND_ADMIN_PASSWORD,
        secondaryAdminPhone: environment.ALMADINA_SECOND_ADMIN_PHONE,
        secondaryAdminName: environment.ALMADINA_SECOND_ADMIN_NAME,
        defer: (promise) => context.waitUntil(promise),
      }),
    };
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("shared-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function rawCall(worker, database, path, { method = "GET", payload, rawBody, cookie, origin, headers: extraHeaders, environment = {} } = {}) {
  const headers = new Headers(extraHeaders);
  if (payload) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);

  const backgroundTasks = [];
  const response = await worker.fetch(
    new Request(`http://almadina.test/api/almadina/${path}`, {
      method,
      headers,
      ...(rawBody !== undefined
        ? { body: rawBody }
        : payload
          ? { body: JSON.stringify(payload) }
          : {}),
    }),
    {
      ALMADINA_ADMIN_EMAIL: "admin@almadinaexpress.com",
      ALMADINA_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ALMADINA_ADMIN_PHONE: "0599000000",
      ALMADINA_ADMIN_NAME: "إدارة المدينة إكسبرس",
      ...environment,
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    {
      waitUntil(promise) { backgroundTasks.push(Promise.resolve(promise)); },
      passThroughOnException() {},
    },
  );

  for (let index = 0; index < backgroundTasks.length; index += 1) await backgroundTasks[index];

  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function call(worker, database, path, options = {}) {
  if (path !== "register" || options.method !== "POST") return rawCall(worker, database, path, options);

  const messages = [];
  const requested = await rawCall(worker, database, "register/request", {
    ...options,
    environment: {
      ...(options.environment ?? {}),
      PASSWORD_RESET_SENDER: async (message) => { messages.push(structuredClone(message)); },
    },
  });
  if (requested.status !== 202) return requested;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].purpose, "registration");
  const registrationCookie = namedCookieFrom(requested, "almadina_registration");
  return rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: registrationCookie,
    payload: { code: messages[0].code },
    origin: options.origin,
    headers: options.headers,
    environment: options.environment,
  });
}

function accountPayload(name, email, phone) {
  return {
    name,
    email,
    phone,
    store: `متجر ${name}`,
    governorate: "نابلس",
    city: "نابلس",
    address: "شارع فيصل، قرب الدوار",
    latitude: 32.2211,
    longitude: 35.2544,
    password: "Customer@123",
    acceptedTerms: true,
  };
}

function sessionFrom(result) {
  const value = result.headers.get("set-cookie");
  assert.ok(value);
  assert.match(value, /HttpOnly/);
  return value.split(";")[0];
}

async function reserveCodes(worker, database, count, requestId = "fixture-printed-labels") {
  const login = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  assert.equal(login.status, 200);
  const reserved = await call(worker, database, "parcel-code-batches", { method: "POST", cookie: sessionFrom(login), payload: { requestId, count, label: "رموز الاختبار" } });
  assert.equal(reserved.status, 201, reserved.body.error);
  const batch = reserved.body.database.parcelCodeBatches.find((entry) => entry.id === requestId);
  return Array.from({ length: batch.count }, (_, index) => `ALX-${batch.startNumber + index}`);
}

function namedCookieFrom(result, name) {
  const value = result.headers.get("set-cookie");
  assert.ok(value);
  const match = value.match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]*)`));
  assert.ok(match, `expected ${name} cookie in ${value}`);
  return match[1];
}

test("synchronizes the bootstrap administrator when Render environment credentials change", async () => {
  const worker = await loadWorker();
  const originalDatabase = new FakeD1Database();
  const originalEnvironment = {
    ALMADINA_ADMIN_EMAIL: "old-admin@example.test",
    ALMADINA_ADMIN_PASSWORD: "OldAdmin@Test-2026!",
    ALMADINA_ADMIN_PHONE: "0591000000",
  };
  const originalLogin = await rawCall(worker, originalDatabase, "login", {
    method: "POST",
    payload: { email: originalEnvironment.ALMADINA_ADMIN_EMAIL, password: originalEnvironment.ALMADINA_ADMIN_PASSWORD },
    environment: originalEnvironment,
  });
  assert.equal(originalLogin.status, 200);

  const database = new FakeD1Database();
  database.state = structuredClone(originalDatabase.state);
  database.sessions.set("stale-session", {
    token_hash: "stale-session",
    user_id: "admin-almadina",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    created_at: new Date().toISOString(),
  });
  database.sessionDevices.set("stale-session", {
    token_hash: "stale-session",
    user_id: "admin-almadina",
    device_name: "Old device",
    device_type: "desktop",
    browser_name: "Old browser",
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  });

  const updatedEnvironment = {
    ALMADINA_ADMIN_EMAIL: "current-admin@example.test",
    ALMADINA_ADMIN_PASSWORD: "CurrentAdmin@Test-2026!",
    ALMADINA_ADMIN_PHONE: "0592000000",
  };
  const updatedLogin = await rawCall(worker, database, "login", {
    method: "POST",
    payload: { email: updatedEnvironment.ALMADINA_ADMIN_EMAIL, password: updatedEnvironment.ALMADINA_ADMIN_PASSWORD },
    environment: updatedEnvironment,
  });
  assert.equal(updatedLogin.status, 200);
  assert.equal(updatedLogin.body.userId, "admin-almadina");
  assert.equal(updatedLogin.body.database.users[0].email, updatedEnvironment.ALMADINA_ADMIN_EMAIL);
  assert.equal(updatedLogin.body.database.users[0].phone, updatedEnvironment.ALMADINA_ADMIN_PHONE);
  assert.equal(database.sessions.has("stale-session"), false);
  assert.equal(database.sessionDevices.has("stale-session"), false);

  const storedAdministrator = JSON.parse(database.state.payload).users.find((account) => account.id === "admin-almadina");
  assert.match(storedAdministrator.password, /^pbkdf2:600000:/);
  assert.notEqual(storedAdministrator.password, updatedEnvironment.ALMADINA_ADMIN_PASSWORD);

  const oldCredentials = await rawCall(worker, database, "login", {
    method: "POST",
    payload: { email: originalEnvironment.ALMADINA_ADMIN_EMAIL, password: originalEnvironment.ALMADINA_ADMIN_PASSWORD },
    environment: updatedEnvironment,
  });
  assert.equal(oldCredentials.status, 401);
});

test("recovers updated Render administrator credentials even after this database was already initialized", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const originalEnvironment = {
    ALMADINA_ADMIN_EMAIL: "initialized-admin@example.test",
    ALMADINA_ADMIN_PASSWORD: "InitializedAdmin@Test-2026!",
    ALMADINA_ADMIN_PHONE: "0596000000",
  };
  const originalLogin = await rawCall(worker, database, "login", {
    method: "POST",
    payload: {
      email: originalEnvironment.ALMADINA_ADMIN_EMAIL,
      password: originalEnvironment.ALMADINA_ADMIN_PASSWORD,
    },
    environment: originalEnvironment,
  });
  assert.equal(originalLogin.status, 200);
  assert.equal(database.sessions.size, 1);

  const updatedEnvironment = {
    ALMADINA_ADMIN_EMAIL: "live-admin@example.test",
    ALMADINA_ADMIN_PASSWORD: "LiveAdmin@Test-2026!",
    ALMADINA_ADMIN_PHONE: "0597000000",
  };
  const recoveredLogin = await rawCall(worker, database, "login", {
    method: "POST",
    payload: {
      email: updatedEnvironment.ALMADINA_ADMIN_EMAIL,
      password: updatedEnvironment.ALMADINA_ADMIN_PASSWORD,
    },
    environment: updatedEnvironment,
  });
  assert.equal(recoveredLogin.status, 200);
  assert.equal(recoveredLogin.body.userId, "admin-almadina");
  assert.equal(recoveredLogin.body.database.users[0].email, updatedEnvironment.ALMADINA_ADMIN_EMAIL);
  assert.equal(recoveredLogin.body.database.users[0].phone, updatedEnvironment.ALMADINA_ADMIN_PHONE);
  assert.equal(database.sessions.size, 1);

  const retiredCredentials = await rawCall(worker, database, "login", {
    method: "POST",
    payload: {
      email: originalEnvironment.ALMADINA_ADMIN_EMAIL,
      password: originalEnvironment.ALMADINA_ADMIN_PASSWORD,
    },
    environment: updatedEnvironment,
  });
  assert.equal(retiredCredentials.status, 401);
});

test("repairs an administrator stored by a legacy plaintext release", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const legacy = createSeedDatabase();
  legacy.users.push({
    id: "admin-almadina",
    name: "إدارة قديمة",
    email: "legacy-admin@example.test",
    password: "Admin@123",
    phone: "0593000000",
    store: "المدينة إكسبرس",
    role: "admin",
    joinedAt: new Date().toISOString(),
    avatarColor: "#087c45",
  });
  database.state = {
    id: "main",
    payload: JSON.stringify(legacy),
    revision: 4,
    updated_at: new Date().toISOString(),
  };

  const environment = {
    ALMADINA_ADMIN_EMAIL: "recovered-admin@example.test",
    ALMADINA_ADMIN_PASSWORD: "RecoveredAdmin@Test-2026!",
    ALMADINA_ADMIN_PHONE: "0594000000",
  };
  const recovered = await rawCall(worker, database, "login", {
    method: "POST",
    payload: { email: environment.ALMADINA_ADMIN_EMAIL, password: environment.ALMADINA_ADMIN_PASSWORD },
    environment,
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.database.users[0].email, environment.ALMADINA_ADMIN_EMAIL);
});

test("adds an independent secondary administrator without replacing the primary administrator", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const environment = {
    ALMADINA_SECOND_ADMIN_EMAIL: "owner-admin@example.test",
    ALMADINA_SECOND_ADMIN_PASSWORD: "OwnerAdmin@Test-2026!",
    ALMADINA_SECOND_ADMIN_PHONE: "0595000000",
    ALMADINA_SECOND_ADMIN_NAME: "مدير النظام",
  };

  const secondaryLogin = await rawCall(worker, database, "login", {
    method: "POST",
    payload: {
      email: environment.ALMADINA_SECOND_ADMIN_EMAIL,
      password: environment.ALMADINA_SECOND_ADMIN_PASSWORD,
    },
    environment,
  });
  assert.equal(secondaryLogin.status, 200);
  assert.equal(secondaryLogin.body.userId, "admin-owner");
  assert.equal(secondaryLogin.body.database.users.length, 2);
  assert.equal(secondaryLogin.body.database.users.find((account) => account.id === "admin-owner").role, "admin");

  const primaryLogin = await rawCall(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
    environment,
  });
  assert.equal(primaryLogin.status, 200);
  assert.equal(primaryLogin.body.userId, "admin-almadina");

  const storedUsers = JSON.parse(database.state.payload).users;
  assert.match(storedUsers.find((account) => account.id === "admin-owner").password, /^pbkdf2:600000:/);
  assert.equal(storedUsers.find((account) => account.id === "admin-almadina").email, "admin@almadinaexpress.com");
});

test("allows several active accounts to share one phone number while keeping emails unique", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const environment = {
    ALMADINA_SECOND_ADMIN_EMAIL: "owner-same-phone@example.test",
    ALMADINA_SECOND_ADMIN_PASSWORD: "OwnerSamePhone@Test-2026!",
    ALMADINA_SECOND_ADMIN_PHONE: "0599000000",
    ALMADINA_SECOND_ADMIN_NAME: "مدير برقم قديم مشترك",
  };

  const administrator = await rawCall(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
    environment,
  });
  assert.equal(administrator.status, 200);
  assert.equal(administrator.body.database.users.filter((account) => account.phone === "0599000000").length, 2);
  const adminCookie = sessionFrom(administrator);

  const preferencesUpdated = await rawCall(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    environment,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        preferences: {
          ...administrator.body.database.preferences,
          [administrator.body.userId]: {
            ...administrator.body.database.preferences[administrator.body.userId],
            sounds: false,
          },
        },
      },
    },
  });
  assert.equal(preferencesUpdated.status, 200);
  assert.equal(preferencesUpdated.body.database.preferences[administrator.body.userId].sounds, false);

  const duplicateNewAccount = await rawCall(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    environment,
    payload: {
      revision: preferencesUpdated.body.revision,
      database: {
        ...preferencesUpdated.body.database,
        users: [...preferencesUpdated.body.database.users, {
          id: "merchant-new-duplicate-phone",
          name: "حساب برقم مكرر جديد",
          email: "new-duplicate-phone@example.test",
          phone: "0599000000",
          store: "متجر الاختبار",
          password: "Merchant@Test-2026!",
          role: "merchant",
          membership: "standard",
          joinedAt: new Date().toISOString(),
          avatarColor: "#187a50",
        }],
      },
    },
  });
  assert.equal(duplicateNewAccount.status, 200);

  const current = await rawCall(worker, database, "database", { cookie: adminCookie, environment });
  assert.equal(current.body.revision, duplicateNewAccount.body.revision);
  assert.equal(current.body.database.users.some((account) => account.id === "merchant-new-duplicate-phone"), true);
  assert.equal(current.body.database.users.filter((account) => account.phone === "0599000000").length, 3);
});

test("reverse-geocodes a registration pin with a safe manual fallback", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  let receivedPoint;
  const address = {
    state: "محافظة نابلس",
    city: "نابلس",
    suburb: "رفيديا",
    street: "شارع الجامعة",
    houseNumber: "12",
  };
  const resolved = await rawCall(worker, database, "geocode/reverse", {
    method: "POST",
    payload: { latitude: 32.2211, longitude: 35.2544 },
    environment: {
      REVERSE_GEOCODER: async (point) => {
        receivedPoint = point;
        return address;
      },
    },
  });

  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.success, true);
  assert.deepEqual(receivedPoint, { latitude: 32.2211, longitude: 35.2544 });
  assert.deepEqual(resolved.body.address, address);

  const unavailable = await rawCall(worker, new FakeD1Database(), "geocode/reverse", {
    method: "POST",
    payload: { latitude: 32.2211, longitude: 35.2544 },
  });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body.error, /يدوي/);

  const outsideServiceArea = await rawCall(worker, new FakeD1Database(), "geocode/reverse", {
    method: "POST",
    payload: { latitude: 40, longitude: 20 },
    environment: { REVERSE_GEOCODER: async () => address },
  });
  assert.equal(outsideServiceArea.status, 400);
  assert.match(outsideServiceArea.body.error, /نطاق التوصيل/);
});

test("rejects forged, unsupported, and oversized API request envelopes", async () => {
  const worker = await loadWorker();

  const emptyLogout = await rawCall(worker, new FakeD1Database(), "logout", {
    method: "POST",
    rawBody: "",
  });
  assert.equal(emptyLogout.status, 200);
  assert.equal(emptyLogout.body.success, true);

  const unsupported = await rawCall(worker, new FakeD1Database(), "login", {
    method: "POST",
    rawBody: "{}",
    headers: { "Content-Type": "text/plain" },
  });
  assert.equal(unsupported.status, 415);
  assert.match(unsupported.body.error, /نوع محتوى/);

  const crossSite = await rawCall(worker, new FakeD1Database(), "login", {
    method: "POST",
    payload: { email: "attacker@example.test", password: "Wrong@123" },
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(crossSite.status, 403);
  assert.match(crossSite.body.error, /مصدر الطلب/);

  const oversized = await rawCall(worker, new FakeD1Database(), "login", {
    method: "POST",
    rawBody: `{"padding":"${"x".repeat(2 * 1024 * 1024)}"}`,
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(oversized.status, 413);
  assert.match(oversized.body.error, /حجم الطلب/);

  for (const response of [unsupported, crossSite, oversized]) {
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  }
});

test("creates an account only after the six-digit email verification code succeeds", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const payload = accountPayload("تاجر التسجيل الموثق", "verified-signup@example.test", "0591112233");
  const delivered = [];
  const environment = {
    PASSWORD_RESET_SENDER: async (message) => { delivered.push(structuredClone(message)); },
  };

  const legacy = await rawCall(worker, database, "register", { method: "POST", payload, environment });
  assert.equal(legacy.status, 410);
  assert.match(legacy.body.error, /أكمل خطوات إنشاء الحساب/);
  assert.equal(JSON.parse(database.state.payload).users.filter((account) => account.role === "merchant").length, 0);

  const missingConsent = await rawCall(worker, database, "register/request", {
    method: "POST",
    payload: { ...payload, acceptedTerms: false },
    environment,
  });
  assert.equal(missingConsent.status, 400);
  assert.match(missingConsent.body.error, /يجب الموافقة على شروط الاستخدام/);
  assert.equal(delivered.length, 0);
  assert.equal(database.registrationRequests.size, 0);

  const missingDelivery = await rawCall(worker, database, "register/request", { method: "POST", payload });
  assert.equal(missingDelivery.status, 503);
  assert.equal(JSON.parse(database.state.payload).users.filter((account) => account.role === "merchant").length, 0);

  const requested = await rawCall(worker, database, "register/request", { method: "POST", payload, environment });
  assert.equal(requested.status, 202);
  assert.equal(requested.body.success, true);
  assert.equal(requested.body.email, "verified-signup@example.test");
  assert.equal(Object.hasOwn(requested.body, "code"), false);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].destination, "verified-signup@example.test");
  assert.equal(delivered[0].purpose, "registration");
  assert.match(delivered[0].code, /^\d{6}$/);
  assert.equal(JSON.parse(database.state.payload).users.filter((account) => account.role === "merchant").length, 0);

  const requestCookie = namedCookieFrom(requested, "almadina_registration");
  const pending = [...database.registrationRequests.values()][0];
  const pendingLocation = [...database.registrationLocations.values()][0];
  assert.ok(pending);
  assert.ok(pendingLocation);
  assert.match(pending.password_hash, /^pbkdf2:600000:/);
  assert.notEqual(pending.password_hash, payload.password);
  assert.notEqual(pending.code_hash, delivered[0].code);
  assert.ok(!JSON.stringify(pending).includes(delivered[0].code));
  assert.equal(pendingLocation.governorate, payload.governorate);
  assert.equal(pendingLocation.city, payload.city);
  assert.equal(pendingLocation.address, payload.address);
  assert.equal(pendingLocation.latitude, payload.latitude);
  assert.equal(pendingLocation.longitude, payload.longitude);

  const wrongCode = delivered[0].code === "000000" ? "000001" : "000000";
  const rejected = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: requestCookie,
    payload: { code: wrongCode },
    environment,
  });
  assert.equal(rejected.status, 422);
  assert.equal(pending.failed_attempts, 1);
  assert.equal(JSON.parse(database.state.payload).users.filter((account) => account.role === "merchant").length, 0);

  const verified = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: requestCookie,
    payload: { code: delivered[0].code },
    environment,
  });
  assert.equal(verified.status, 201);
  assert.equal(verified.body.database.users.length, 1);
  assert.equal(verified.body.database.users[0].email, "verified-signup@example.test");
  assert.equal(verified.body.database.users[0].password, "");
  assert.equal(verified.body.database.users[0].governorate, payload.governorate);
  assert.equal(verified.body.database.users[0].city, payload.city);
  assert.equal(verified.body.database.users[0].address, payload.address);
  assert.equal(verified.body.database.users[0].latitude, payload.latitude);
  assert.equal(verified.body.database.users[0].longitude, payload.longitude);
  assert.equal(database.registrationRequests.size, 0);
  assert.equal(database.registrationLocations.size, 0);
  const sessionCookieValue = sessionFrom(verified);
  assert.match(sessionCookieValue, /^almadina_session=/);

  const replayed = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: requestCookie,
    payload: { code: delivered[0].code },
    environment,
  });
  assert.equal(replayed.status, 422);

  const duplicate = await rawCall(worker, database, "register/request", { method: "POST", payload, environment });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /هذا الحساب موجود بالفعل بهذا البريد الإلكتروني/);
  const sharedPhoneRequest = await rawCall(worker, database, "register/request", {
    method: "POST",
    payload: { ...payload, email: "different-email@example.test" },
    environment,
  });
  assert.equal(sharedPhoneRequest.status, 202);
  assert.equal(delivered.length, 2);
  const sharedPhoneVerified = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: namedCookieFrom(sharedPhoneRequest, "almadina_registration"),
    payload: { code: delivered[1].code },
    environment,
  });
  assert.equal(sharedPhoneVerified.status, 201);
  assert.notEqual(sharedPhoneVerified.body.userId, verified.body.userId);
  assert.equal(sharedPhoneVerified.body.database.users[0].phone, payload.phone);
  assert.equal(JSON.parse(database.state.payload).users.filter((account) => account.phone === payload.phone).length, 2);

  const login = await rawCall(worker, database, "login", {
    method: "POST",
    payload: { email: payload.email, password: payload.password },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.userId, verified.body.userId);

  const failurePayload = accountPayload("تاجر فشل الإرسال", "signup-delivery-failure@example.test", "0591112244");
  const previousConsoleError = console.error;
  let deliveryFailure;
  try {
    console.error = () => {};
    deliveryFailure = await rawCall(worker, database, "register/request", {
      method: "POST",
      payload: failurePayload,
      environment: { PASSWORD_RESET_SENDER: async () => { throw new Error("simulated delivery failure"); } },
    });
  } finally {
    console.error = previousConsoleError;
  }
  assert.equal(deliveryFailure.status, 502);
  assert.equal([...database.registrationRequests.values()].some((entry) => entry.email === failurePayload.email), false);
  assert.equal(database.registrationLocations.size, 0);

  const mismatchedArea = await rawCall(worker, database, "register/request", {
    method: "POST",
    payload: { ...accountPayload("عنوان غير مطابق", "bad-area@example.test", "0591112255"), governorate: "نابلس", city: "القدس" },
    environment,
  });
  assert.equal(mismatchedArea.status, 400);
  assert.match(mismatchedArea.body.error, /غير متطابقتين/);

  const outsideMap = await rawCall(worker, database, "register/request", {
    method: "POST",
    payload: { ...accountPayload("موقع خارج النطاق", "bad-map@example.test", "0591112266"), latitude: 40, longitude: 20 },
    environment,
  });
  assert.equal(outsideMap.status, 400);
  assert.match(outsideMap.body.error, /نطاق التوصيل على الخريطة/);
  assert.equal(delivered.length, 2);
});

test("keeps simultaneous registrations with one shared phone number independent", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const delivered = [];
  const environment = {
    PASSWORD_RESET_SENDER: async (message) => { delivered.push(structuredClone(message)); },
  };
  const sharedPhone = "0591234567";

  const firstRequest = await rawCall(worker, database, "register/request", {
    method: "POST",
    payload: accountPayload("الحساب المشترك الأول", "shared-phone-one@example.test", sharedPhone),
    environment,
  });
  const secondRequest = await rawCall(worker, database, "register/request", {
    method: "POST",
    payload: accountPayload("الحساب المشترك الثاني", "shared-phone-two@example.test", sharedPhone),
    environment,
  });

  assert.equal(firstRequest.status, 202);
  assert.equal(secondRequest.status, 202);
  assert.equal(database.registrationRequests.size, 2);
  assert.equal(database.registrationLocations.size, 2);
  assert.equal(delivered.length, 2);

  const firstVerified = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: namedCookieFrom(firstRequest, "almadina_registration"),
    payload: { code: delivered[0].code },
    environment,
  });
  const secondVerified = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: namedCookieFrom(secondRequest, "almadina_registration"),
    payload: { code: delivered[1].code },
    environment,
  });

  assert.equal(firstVerified.status, 201);
  assert.equal(secondVerified.status, 201);
  assert.notEqual(firstVerified.body.userId, secondVerified.body.userId);
  assert.equal(JSON.parse(database.state.payload).users.filter((account) => account.phone === sharedPhone).length, 2);
  assert.equal(database.registrationRequests.size, 0);
  assert.equal(database.registrationLocations.size, 0);
});

test("accepts a complete manual address without requiring or trusting map coordinates", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const delivered = [];
  const environment = {
    PASSWORD_RESET_SENDER: async (message) => { delivered.push(structuredClone(message)); },
  };
  const payload = {
    ...accountPayload("تاجر العنوان اليدوي", "manual-location@example.test", "0591112277"),
    locationMethod: "manual",
    latitude: 90,
    longitude: 180,
  };

  const requested = await rawCall(worker, database, "register/request", { method: "POST", payload, environment });
  assert.equal(requested.status, 202);
  assert.equal(delivered.length, 1);
  const pendingLocation = [...database.registrationLocations.values()][0];
  assert.equal(pendingLocation.governorate, payload.governorate);
  assert.equal(pendingLocation.city, payload.city);
  assert.equal(pendingLocation.address, payload.address);
  assert.equal(pendingLocation.latitude, 0);
  assert.equal(pendingLocation.longitude, 0);

  const verified = await rawCall(worker, database, "register/verify", {
    method: "POST",
    cookie: namedCookieFrom(requested, "almadina_registration"),
    payload: { code: delivered[0].code },
    environment,
  });
  assert.equal(verified.status, 201);
  assert.equal(verified.body.database.users[0].latitude, undefined);
  assert.equal(verified.body.database.users[0].longitude, undefined);
});

test("shares accounts and orders across devices while isolating customers and protecting sessions", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const issuedCodes = await reserveCodes(worker, database, 1);

  const firstDevice = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("التاجر الأول", "first@example.test", "0591234567"),
  });

  assert.equal(firstDevice.status, 201);
  assert.equal(firstDevice.body.database.users.length, 1);
  assert.equal(firstDevice.body.database.users[0].email, "first@example.test");
  assert.equal(firstDevice.body.database.users[0].password, "");
  const firstCookie = sessionFrom(firstDevice);

  const secondDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "first@example.test", password: "Customer@123" },
  });

  assert.equal(secondDevice.status, 200);
  assert.equal(secondDevice.body.userId, firstDevice.body.userId);
  const secondCookie = sessionFrom(secondDevice);
  assert.notEqual(secondCookie, firstCookie);

  const courierInstructions = "اتصل بالمستلم قبل الوصول بساعة.";
  const adminOnlyNote = "ملاحظة داخلية سرية للمسؤول فقط.";
  const order = {
    id: "order-cross-device",
    merchantId: firstDevice.body.userId,
    merchantName: "التاجر الأول",
    merchantStore: "متجر التاجر الأول",
    recipientName: "المستلم",
    recipientPhone: "0597654321",
    governorate: "القدس",
    city: "القدس",
    address: "عنوان خاص",
    pickupAddress: "الخليل",
    preferredDeliveryDate: "2026-08-30",
    amount: 100,
    deliveryFee: 999,
    content: "طرد",
    weight: "0 - 5 كغم",
    dimensions: "50 × 50 × 50 سم",
    lengthCm: 50,
    widthCm: 50,
    heightCm: 50,
    weightFee: 999,
    oversizeFee: 999,
    notes: courierInstructions,
    privateNotes: adminOnlyNote,
    reference: "",
    type: "طرد عادي",
    status: "ready",
    courierName: "بانتظار تعيين المندوب",
    courierId: "courier-forged-by-merchant",
    shippedAt: new Date(0).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trackingNumber: issuedCodes[0],
    deleted: false,
  };

  const createdOrder = await call(worker, database, "database", {
    method: "PUT",
    cookie: firstCookie,
    payload: {
      revision: firstDevice.body.revision,
      database: {
        ...firstDevice.body.database,
        orders: [order],
        nextOrder: firstDevice.body.database.nextOrder + 1,
      },
    },
  });

  assert.equal(createdOrder.status, 200);
  assert.equal(createdOrder.body.database.orders[0].trackingNumber, "ALX-20200001");
  assert.equal(createdOrder.body.database.orders[0].status, "draft");
  assert.equal(createdOrder.body.database.orders[0].trackingEvents.length, 1);
  assert.equal(createdOrder.body.database.orders[0].trackingEvents[0].status, "draft");
  assert.equal(createdOrder.body.database.orders[0].trackingEvents[0].title, "قيد الإنشاء");
  assert.equal(createdOrder.body.database.orders[0].trackingEvents[0].actor, "التاجر الأول");
  assert.equal(createdOrder.body.database.orders[0].trackingEvents[0].note, "تم إنشاء الطرد وهو قيد الإنشاء.");
  assert.equal(createdOrder.body.database.orders[0].deliveryFee, 56);
  assert.equal(createdOrder.body.database.orders[0].weightFee, 0);
  assert.equal(createdOrder.body.database.orders[0].oversizeFee, 21);
  assert.equal(createdOrder.body.database.orders[0].courierId, undefined);
  assert.equal(createdOrder.body.database.orders[0].shippedAt, undefined);
  assert.equal(createdOrder.body.database.orders[0].notes, "");
  assert.equal(createdOrder.body.database.orders[0].privateNotes, "");
  assert.ok(!JSON.stringify(createdOrder.body).includes(courierInstructions));
  assert.ok(!JSON.stringify(createdOrder.body).includes(adminOnlyNote));

  const synchronized = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(synchronized.status, 200);
  assert.equal(synchronized.body.database.orders.length, 1);
  assert.equal(synchronized.body.database.orders[0].recipientName, "المستلم");
  assert.equal(synchronized.body.database.orders[0].preferredDeliveryDate, "2026-08-30");
  assert.equal(synchronized.body.database.orders[0].notes, "");
  assert.equal(synchronized.body.database.orders[0].privateNotes, "");

  const otherCustomer = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("التاجر الثاني", "second@example.test", "0561234567"),
  });

  assert.equal(otherCustomer.status, 201);
  assert.equal(otherCustomer.body.database.users.length, 1);
  assert.equal(otherCustomer.body.database.users[0].email, "second@example.test");
  assert.deepEqual(otherCustomer.body.database.orders, []);
  assert.deepEqual(otherCustomer.body.database.collections, []);
  const otherCookie = sessionFrom(otherCustomer);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });

  assert.equal(administrator.status, 200);
  assert.equal(administrator.body.database.users.length, 3);
  assert.equal(administrator.body.database.orders.length, 1);
  assert.equal(administrator.body.database.orders[0].notes, "");
  assert.equal(administrator.body.database.orders[0].privateNotes, adminOnlyNote);
  assert.ok(!JSON.stringify(administrator.body).includes(courierInstructions));
  assert.ok(JSON.stringify(administrator.body).includes(adminOnlyNote));
  assert.ok(administrator.body.database.users.every((account) => account.password === ""));
  const adminPrivateNoteNotice = administrator.body.database.notices.find((notice) => notice.title === "ملاحظة خاصة جديدة");
  assert.ok(adminPrivateNoteNotice);
  assert.equal(adminPrivateNoteNotice.userId, administrator.body.userId);
  assert.equal(adminPrivateNoteNotice.read, false);
  assert.ok(adminPrivateNoteNotice.message.includes(order.trackingNumber));
  assert.ok(adminPrivateNoteNotice.message.includes(adminOnlyNote));
  const adminCookie = sessionFrom(administrator);

  const upgraded = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        users: administrator.body.database.users.map((account) => account.id === firstDevice.body.userId ? { ...account, membership: "premium" } : account),
        orders: administrator.body.database.orders.map((item) => item.id === order.id ? { ...item, status: "ready", privateNotes: "", updatedAt: new Date().toISOString() } : item),
      },
    },
  });

  assert.equal(upgraded.status, 200);

  const administratorCreatedAccount = {
    id: "merchant-admin-created",
    name: "تاجر أنشأه المسؤول",
    email: "managed@example.test",
    phone: "0597654321",
    store: "متجر الإدارة",
    password: "Managed@123",
    role: "merchant",
    membership: "diamond",
    joinedAt: new Date().toISOString(),
    avatarColor: "#187a50",
  };

  const employeeAccount = {
    id: "courier-collection-camera",
    name: "موظف التحصيل",
    email: "employee@example.test",
    phone: "0567654321",
    store: "قسم التحصيلات",
    password: "Employee@123",
    role: "courier",
    joinedAt: new Date().toISOString(),
    avatarColor: "#6655a6",
  };

  const sameNameEmployeeAccount = {
    ...employeeAccount,
    id: "courier-same-name",
    email: "employee-same-name@example.test",
    phone: "0567654322",
  };

  const managedAccount = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: upgraded.body.revision,
      database: {
        ...upgraded.body.database,
        users: [...upgraded.body.database.users, administratorCreatedAccount, employeeAccount, sameNameEmployeeAccount],
      },
    },
  });

  assert.equal(managedAccount.status, 200);
  assert.equal(managedAccount.body.database.users.find((account) => account.email === "managed@example.test").password, "");

  const managedDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "managed@example.test", password: "Managed@123" },
  });

  assert.equal(managedDevice.status, 200);
  assert.equal(managedDevice.body.database.users.length, 1);
  assert.deepEqual(managedDevice.body.database.orders, []);
  const managedCookie = sessionFrom(managedDevice);

  const employeeDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "employee@example.test", password: "Employee@123" },
  });

  assert.equal(employeeDevice.status, 200);
  assert.equal(employeeDevice.body.database.users.length, 1);
  assert.equal(employeeDevice.body.database.users[0].role, "courier");
  assert.deepEqual(employeeDevice.body.database.orders.map((item) => item.id), [order.id]);
  assert.deepEqual(employeeDevice.body.database.collections, []);
  const employeeCookie = sessionFrom(employeeDevice);

  const sameNameEmployeeDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "employee-same-name@example.test", password: "Employee@123" },
  });
  assert.equal(sameNameEmployeeDevice.status, 200);
  assert.deepEqual(sameNameEmployeeDevice.body.database.orders.map((item) => item.id), [order.id]);
  const sameNameEmployeeCookie = sessionFrom(sameNameEmployeeDevice);

  const merchantBroadcastAttempt = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: secondCookie,
    payload: {
      requestId: "release-merchant-attempt",
      audience: "all",
      title: "تحديث تجريبي",
      message: "يجب ألا يستطيع التاجر إرسال هذا الإشعار.",
    },
  });
  assert.equal(merchantBroadcastAttempt.status, 403);

  const anonymousBroadcastAttempt = await call(worker, database, "notices/broadcast", {
    method: "POST",
    payload: {
      requestId: "release-anonymous-attempt",
      audience: "all",
      title: "تحديث تجريبي",
      message: "يجب ألا يستطيع الزائر إرسال هذا الإشعار.",
    },
  });
  assert.equal(anonymousBroadcastAttempt.status, 401);

  const courierBroadcastAttempt = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: employeeCookie,
    payload: {
      requestId: "release-courier-attempt",
      audience: "all",
      title: "تحديث تجريبي",
      message: "يجب ألا يستطيع المندوب إرسال هذا الإشعار.",
    },
  });
  assert.equal(courierBroadcastAttempt.status, 403);

  const invalidBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: { requestId: "short", audience: "unknown", title: "x", message: "x" },
  });
  assert.equal(invalidBroadcast.status, 400);

  const nonStringBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: { requestId: 12345678, audience: "all", title: { text: "عنوان" }, message: ["رسالة"] },
  });
  assert.equal(nonStringBroadcast.status, 400);

  const adminBeforeBroadcast = await call(worker, database, "database", { cookie: adminCookie });
  const preservedBeforeBroadcast = {
    users: adminBeforeBroadcast.body.database.users,
    orders: adminBeforeBroadcast.body.database.orders,
    recipients: adminBeforeBroadcast.body.database.recipients,
    collections: adminBeforeBroadcast.body.database.collections,
    preferences: adminBeforeBroadcast.body.database.preferences,
    nextOrder: adminBeforeBroadcast.body.database.nextOrder,
    nextCollection: adminBeforeBroadcast.body.database.nextCollection,
  };
  const noticeIdsBeforeBroadcast = new Set(adminBeforeBroadcast.body.database.notices.map((notice) => notice.id));
  const broadcastRequest = {
    requestId: "release-2026-09-01-001",
    audience: "all",
    title: "آخر تحديثات المدينة إكسبرس",
    message: "تم تحسين قارئ QR وإضافة مزايا جديدة للتطبيق.",
  };
  const broadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: broadcastRequest,
  });

  assert.equal(broadcast.status, 200);
  assert.equal(broadcast.body.recipientCount, 5);
  assert.equal(broadcast.body.revision, adminBeforeBroadcast.body.revision + 1);
  assert.deepEqual({
    users: broadcast.body.database.users,
    orders: broadcast.body.database.orders,
    recipients: broadcast.body.database.recipients,
    collections: broadcast.body.database.collections,
    preferences: broadcast.body.database.preferences,
    nextOrder: broadcast.body.database.nextOrder,
    nextCollection: broadcast.body.database.nextCollection,
  }, preservedBeforeBroadcast);
  const deliveredBroadcasts = broadcast.body.database.notices.filter((notice) => notice.title === broadcastRequest.title);
  assert.equal(deliveredBroadcasts.length, 5);
  assert.ok(deliveredBroadcasts.every((notice) => notice.userId !== administrator.body.userId));
  assert.ok(deliveredBroadcasts.every((notice) => notice.read === false && notice.icon === "sparkles"));
  assert.ok(deliveredBroadcasts.every((notice) => notice.broadcastId === broadcastRequest.requestId && notice.audience === "all"));
  assert.equal(new Set(deliveredBroadcasts.map((notice) => notice.userId)).size, 5);
  assert.ok([...noticeIdsBeforeBroadcast].every((noticeId) => broadcast.body.database.notices.some((notice) => notice.id === noticeId)));

  const repeatedBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: broadcastRequest,
  });
  assert.equal(repeatedBroadcast.status, 200);
  assert.equal(repeatedBroadcast.body.revision, broadcast.body.revision);
  assert.equal(repeatedBroadcast.body.database.notices.filter((notice) => notice.title === broadcastRequest.title).length, 5);

  const conflictingBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: { ...broadcastRequest, title: "محتوى مختلف للمفتاح نفسه" },
  });
  assert.equal(conflictingBroadcast.status, 409);
  assert.equal(conflictingBroadcast.body.revision, broadcast.body.revision);
  assert.equal(conflictingBroadcast.body.database.notices.filter((notice) => notice.title === "محتوى مختلف للمفتاح نفسه").length, 0);

  const [merchantOnlyBroadcast, courierOnlyBroadcast] = await Promise.all([
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: {
        requestId: "release-merchants-2026-09-01",
        audience: "merchants",
        title: "تحديث خاص بالتجار",
        message: "تمت إضافة تحسين جديد إلى أدوات إدارة الطرود.",
      },
    }),
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: {
        requestId: "release-couriers-2026-09-01",
        audience: "couriers",
        title: "تحديث خاص بالمندوبين",
        message: "تمت إضافة تحسين جديد إلى أدوات مسح الطرود.",
      },
    }),
  ]);
  assert.equal(merchantOnlyBroadcast.status, 200);
  assert.equal(courierOnlyBroadcast.status, 200);
  assert.equal(merchantOnlyBroadcast.body.recipientCount, 3);
  assert.equal(courierOnlyBroadcast.body.recipientCount, 2);

  const merchantAfterBroadcast = await call(worker, database, "database", { cookie: secondCookie });
  const merchantBroadcasts = merchantAfterBroadcast.body.database.notices.filter((notice) => notice.title === broadcastRequest.title);
  assert.equal(merchantBroadcasts.length, 1);
  assert.equal(merchantBroadcasts[0].userId, firstDevice.body.userId);
  assert.equal(merchantAfterBroadcast.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالتجار").length, 1);
  assert.equal(merchantAfterBroadcast.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالمندوبين").length, 0);
  const courierAfterBroadcast = await call(worker, database, "database", { cookie: employeeCookie });
  const courierBroadcasts = courierAfterBroadcast.body.database.notices.filter((notice) => notice.title === broadcastRequest.title);
  assert.equal(courierBroadcasts.length, 1);
  assert.equal(courierBroadcasts[0].userId, employeeAccount.id);
  assert.equal(courierAfterBroadcast.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالتجار").length, 0);
  assert.equal(courierAfterBroadcast.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالمندوبين").length, 1);

  const [premiumOnlyBroadcast, diamondOnlyBroadcast, standardOnlyBroadcast] = await Promise.all([
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: {
        requestId: "release-premium-2026-09-01",
        audience: "premium",
        title: "تحديث خاص بحسابات البريميوم",
        message: "هذا الإشعار مخصص للتجار أصحاب حسابات البريميوم فقط.",
      },
    }),
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: {
        requestId: "release-diamond-2026-09-01",
        audience: "diamond",
        title: "تحديث خاص بالحسابات الماسية",
        message: "هذا الإشعار مخصص للتجار أصحاب الحسابات الماسية فقط.",
      },
    }),
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: {
        requestId: "release-standard-2026-09-01",
        audience: "standard",
        title: "تحديث خاص بالحسابات العادية",
        message: "هذا الإشعار مخصص للتجار أصحاب الحسابات العادية فقط.",
      },
    }),
  ]);
  assert.equal(premiumOnlyBroadcast.status, 200);
  assert.equal(diamondOnlyBroadcast.status, 200);
  assert.equal(standardOnlyBroadcast.status, 200);
  assert.equal(premiumOnlyBroadcast.body.recipientCount, 1);
  assert.equal(diamondOnlyBroadcast.body.recipientCount, 1);
  assert.equal(standardOnlyBroadcast.body.recipientCount, 1);

  const premiumMerchantAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: secondCookie });
  const standardMerchantAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: otherCookie });
  const diamondMerchantAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: managedCookie });
  const courierAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: employeeCookie });
  assert.equal(premiumMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم" && notice.audience === "premium").length, 1);
  assert.equal(premiumMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات الماسية").length, 0);
  assert.equal(premiumMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات العادية").length, 0);
  assert.equal(standardMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم").length, 0);
  assert.equal(standardMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات الماسية").length, 0);
  assert.equal(standardMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات العادية" && notice.audience === "standard").length, 1);
  assert.equal(diamondMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات الماسية" && notice.audience === "diamond").length, 1);
  assert.equal(diamondMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم" || notice.title === "تحديث خاص بالحسابات العادية").length, 0);
  assert.equal(courierAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم" || notice.title === "تحديث خاص بالحسابات الماسية" || notice.title === "تحديث خاص بالحسابات العادية").length, 0);

  const readByMerchant = await call(worker, database, "database", {
    method: "PUT",
    cookie: secondCookie,
    payload: {
      revision: premiumMerchantAfterMembershipBroadcasts.body.revision,
      database: {
        ...premiumMerchantAfterMembershipBroadcasts.body.database,
        notices: premiumMerchantAfterMembershipBroadcasts.body.database.notices.map((notice) => notice.title === broadcastRequest.title ? { ...notice, read: true } : notice),
      },
    },
  });
  assert.equal(readByMerchant.status, 200);
  assert.equal(readByMerchant.body.database.notices.find((notice) => notice.title === broadcastRequest.title).read, true);
  const courierAfterMerchantRead = await call(worker, database, "database", { cookie: employeeCookie });
  assert.equal(courierAfterMerchantRead.body.database.notices.find((notice) => notice.title === broadcastRequest.title).read, false);

  const beforeTargetedBroadcast = await call(worker, database, "database", { cookie: adminCookie });
  const targetedBroadcastRequest = {
    requestId: "release-user-2026-09-01",
    audience: "user",
    recipientUserId: administratorCreatedAccount.id,
    title: "تحديث لحساب محدد",
    message: "هذا الإشعار مخصص للحساب الذي اختاره المسؤول فقط.",
  };
  const targetedBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: targetedBroadcastRequest,
  });
  assert.equal(targetedBroadcast.status, 200);
  assert.equal(targetedBroadcast.body.recipientCount, 1);
  assert.equal(targetedBroadcast.body.revision, beforeTargetedBroadcast.body.revision + 1);
  const targetedNotices = targetedBroadcast.body.database.notices.filter((notice) => notice.title === targetedBroadcastRequest.title);
  assert.equal(targetedNotices.length, 1);
  assert.equal(targetedNotices[0].userId, administratorCreatedAccount.id);
  assert.equal(targetedNotices[0].audience, "user");

  const repeatedTargetedBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: targetedBroadcastRequest,
  });
  assert.equal(repeatedTargetedBroadcast.status, 200);
  assert.equal(repeatedTargetedBroadcast.body.revision, targetedBroadcast.body.revision);
  assert.equal(repeatedTargetedBroadcast.body.database.notices.filter((notice) => notice.title === targetedBroadcastRequest.title).length, 1);

  const conflictingTargetedBroadcast = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: { ...targetedBroadcastRequest, recipientUserId: otherCustomer.body.userId },
  });
  assert.equal(conflictingTargetedBroadcast.status, 409);

  const [missingTargetBroadcast, unknownTargetBroadcast, administratorTargetBroadcast, ambiguousGroupBroadcast] = await Promise.all([
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: { ...targetedBroadcastRequest, requestId: "release-user-missing-target", recipientUserId: "" },
    }),
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: { ...targetedBroadcastRequest, requestId: "release-user-unknown-target", recipientUserId: "merchant-does-not-exist" },
    }),
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: { ...targetedBroadcastRequest, requestId: "release-user-admin-target", recipientUserId: administrator.body.userId },
    }),
    call(worker, database, "notices/broadcast", {
      method: "POST",
      cookie: adminCookie,
      payload: { ...targetedBroadcastRequest, requestId: "release-user-ambiguous-group", audience: "all" },
    }),
  ]);
  assert.equal(missingTargetBroadcast.status, 400);
  assert.equal(unknownTargetBroadcast.status, 422);
  assert.equal(administratorTargetBroadcast.status, 422);
  assert.equal(ambiguousGroupBroadcast.status, 400);

  const targetedRecipientDatabase = await call(worker, database, "database", { cookie: managedCookie });
  const nonTargetedRecipientDatabase = await call(worker, database, "database", { cookie: otherCookie });
  assert.equal(targetedRecipientDatabase.body.database.notices.filter((notice) => notice.title === targetedBroadcastRequest.title).length, 1);
  assert.equal(nonTargetedRecipientDatabase.body.database.notices.filter((notice) => notice.title === targetedBroadcastRequest.title).length, 0);

  const merchantBeforeNoticeClear = await call(worker, database, "database", { cookie: secondCookie });
  const noticeIdsCapturedForClear = merchantBeforeNoticeClear.body.database.notices.map((notice) => notice.id);
  const courierBeforeNoticeClear = await call(worker, database, "database", { cookie: employeeCookie });
  const foreignCourierNoticeId = courierBeforeNoticeClear.body.database.notices[0]?.id;
  assert.ok(noticeIdsCapturedForClear.length > 0);
  assert.ok(foreignCourierNoticeId);

  const arrivedAfterCaptureRequest = {
    requestId: "release-after-clear-capture-2026",
    audience: "user",
    recipientUserId: firstDevice.body.userId,
    title: "إشعار جديد بعد بدء المسح",
    message: "يجب أن يبقى هذا الإشعار لأنه وصل بعد التقاط قائمة الإشعارات المطلوب مسحها.",
  };
  const arrivedAfterCapture = await call(worker, database, "notices/broadcast", {
    method: "POST",
    cookie: adminCookie,
    payload: arrivedAfterCaptureRequest,
  });
  assert.equal(arrivedAfterCapture.status, 200);
  assert.equal(arrivedAfterCapture.body.recipientCount, 1);
  const arrivedAfterCaptureNotice = arrivedAfterCapture.body.database.notices.find((notice) => notice.title === arrivedAfterCaptureRequest.title);
  assert.ok(arrivedAfterCaptureNotice);
  assert.equal(noticeIdsCapturedForClear.includes(arrivedAfterCaptureNotice.id), false);

  const clearPayload = { noticeIds: [...noticeIdsCapturedForClear, foreignCourierNoticeId] };
  const clearedCurrentAccountNotices = await call(worker, database, "notices/clear", {
    method: "POST",
    cookie: secondCookie,
    payload: clearPayload,
  });
  assert.equal(clearedCurrentAccountNotices.status, 200);
  assert.equal(clearedCurrentAccountNotices.body.removedCount, noticeIdsCapturedForClear.length);
  assert.equal(clearedCurrentAccountNotices.body.revision, arrivedAfterCapture.body.revision + 1);
  assert.ok(noticeIdsCapturedForClear.every((noticeId) => !clearedCurrentAccountNotices.body.database.notices.some((notice) => notice.id === noticeId)));
  assert.ok(clearedCurrentAccountNotices.body.database.notices.some((notice) => notice.id === arrivedAfterCaptureNotice.id));

  const courierAfterForeignClearAttempt = await call(worker, database, "database", { cookie: employeeCookie });
  const otherMerchantAfterNoticeClear = await call(worker, database, "database", { cookie: otherCookie });
  assert.ok(courierAfterForeignClearAttempt.body.database.notices.some((notice) => notice.id === foreignCourierNoticeId));
  assert.ok(otherMerchantAfterNoticeClear.body.database.notices.some((notice) => notice.title === broadcastRequest.title));

  const repeatedNoticeClear = await call(worker, database, "notices/clear", {
    method: "POST",
    cookie: secondCookie,
    payload: clearPayload,
  });
  assert.equal(repeatedNoticeClear.status, 200);
  assert.equal(repeatedNoticeClear.body.removedCount, 0);
  assert.equal(repeatedNoticeClear.body.revision, clearedCurrentAccountNotices.body.revision);
  assert.ok(repeatedNoticeClear.body.database.notices.some((notice) => notice.id === arrivedAfterCaptureNotice.id));

  const adminCannotClearRecipientNotice = await call(worker, database, "notices/clear", {
    method: "POST",
    cookie: adminCookie,
    payload: { noticeIds: [arrivedAfterCaptureNotice.id] },
  });
  assert.equal(adminCannotClearRecipientNotice.status, 200);
  assert.equal(adminCannotClearRecipientNotice.body.removedCount, 0);
  assert.equal(adminCannotClearRecipientNotice.body.revision, repeatedNoticeClear.body.revision);
  const merchantAfterAdminClearAttempt = await call(worker, database, "database", { cookie: secondCookie });
  assert.ok(merchantAfterAdminClearAttempt.body.database.notices.some((notice) => notice.id === arrivedAfterCaptureNotice.id));

  const anonymousParcelScan = await call(worker, database, "orders/scan", {
    method: "POST",
    payload: { trackingNumber: order.trackingNumber },
  });
  assert.equal(anonymousParcelScan.status, 401);

  const merchantParcelScan = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: secondCookie,
    payload: { trackingNumber: order.trackingNumber },
  });
  assert.equal(merchantParcelScan.status, 403);

  const administratorParcelScan = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: adminCookie,
    payload: { trackingNumber: order.trackingNumber },
  });
  assert.equal(administratorParcelScan.status, 403);

  const malformedParcelScan = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: employeeCookie,
    payload: { trackingNumber: "INVALID" },
  });
  assert.equal(malformedParcelScan.status, 400);

  const unknownParcelScan = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: employeeCookie,
    payload: { trackingNumber: "ALX-20999999" },
  });
  assert.equal(unknownParcelScan.status, 404);

  const scannedParcel = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: employeeCookie,
    payload: { trackingNumber: order.trackingNumber },
  });
  assert.equal(scannedParcel.status, 200);
  assert.equal(scannedParcel.body.database.orders.length, 1);
  assert.equal(scannedParcel.body.database.orders[0].id, order.id);
  assert.equal(scannedParcel.body.database.orders[0].status, "shipped");
  assert.equal(scannedParcel.body.database.orders[0].courierName, employeeAccount.name);
  assert.equal(scannedParcel.body.database.orders[0].courierId, employeeAccount.id);
  assert.equal(scannedParcel.body.database.orders[0].notes, courierInstructions);
  assert.equal(scannedParcel.body.database.orders[0].privateNotes, "");
  assert.ok(JSON.stringify(scannedParcel.body).includes(courierInstructions));
  assert.ok(!JSON.stringify(scannedParcel.body).includes(adminOnlyNote));
  const employeeInstructionNotice = scannedParcel.body.database.notices.find((notice) => notice.title === "تعليمات جديدة للطرد");
  assert.ok(employeeInstructionNotice);
  assert.equal(employeeInstructionNotice.userId, employeeAccount.id);
  assert.equal(employeeInstructionNotice.read, false);
  assert.ok(employeeInstructionNotice.message.includes(order.trackingNumber));
  assert.ok(employeeInstructionNotice.message.includes(courierInstructions));
  assert.deepEqual(scannedParcel.body.database.recipients, []);
  assert.deepEqual(scannedParcel.body.database.collections, []);

  const sameNameAfterScan = await call(worker, database, "database", { cookie: sameNameEmployeeCookie });
  assert.equal(sameNameAfterScan.status, 200);
  assert.deepEqual(sameNameAfterScan.body.database.orders.map((item) => item.id), [order.id]);
  assert.equal(sameNameAfterScan.body.database.notices.some((notice) => notice.title === "تعليمات جديدة للطرد"), false);

  const merchantAfterInstructionNotice = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(merchantAfterInstructionNotice.status, 200);
  assert.equal(merchantAfterInstructionNotice.body.database.notices.some((notice) => notice.title === "تعليمات جديدة للطرد"), false);
  const shippedNotice = merchantAfterInstructionNotice.body.database.notices.find((notice) => notice.title === "تم شحن الطرد");
  assert.ok(shippedNotice);
  assert.equal(shippedNotice.userId, firstDevice.body.userId);
  assert.equal(shippedNotice.orderId, order.id);
  assert.equal(shippedNotice.read, false);
  assert.ok(shippedNotice.message.includes(order.trackingNumber));

  const adminAfterParcelScan = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(adminAfterParcelScan.status, 200);
  const shippedParcel = adminAfterParcelScan.body.database.orders.find((item) => item.id === order.id);
  assert.equal(shippedParcel.status, "shipped");
  assert.equal(shippedParcel.courierName, employeeAccount.name);
  assert.equal(shippedParcel.courierId, employeeAccount.id);
  assert.equal(shippedParcel.notes, "");
  assert.equal(shippedParcel.privateNotes, adminOnlyNote);
  assert.equal(shippedParcel.trackingEvents.at(-1).status, "shipped");
  assert.equal(shippedParcel.trackingEvents.at(-1).actor, employeeAccount.name);
  assert.ok(adminAfterParcelScan.body.database.notices.some((notice) => notice.userId === firstDevice.body.userId));

  const repeatedParcelScan = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: employeeCookie,
    payload: { trackingNumber: order.trackingNumber },
  });
  assert.ok(repeatedParcelScan.status === 409 || repeatedParcelScan.status === 422);

  const unchangedAfterRepeatedScan = await call(worker, database, "database", { cookie: adminCookie });
  const stillShippedParcel = unchangedAfterRepeatedScan.body.database.orders.find((item) => item.id === order.id);
  assert.equal(stillShippedParcel.status, "shipped");
  assert.equal(stillShippedParcel.trackingEvents.filter((event) => event.status === "shipped").length, 1);

  const returnedBeforeRescan = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: unchangedAfterRepeatedScan.body.revision,
      database: {
        ...unchangedAfterRepeatedScan.body.database,
        orders: unchangedAfterRepeatedScan.body.database.orders.map((item) => item.id === order.id ? { ...item, status: "returned", updatedAt: new Date().toISOString() } : item),
      },
    },
  });
  assert.equal(returnedBeforeRescan.status, 200);

  const rescannedReturnedParcel = await call(worker, database, "orders/scan", {
    method: "POST",
    cookie: employeeCookie,
    payload: { trackingNumber: order.trackingNumber },
  });
  assert.equal(rescannedReturnedParcel.status, 200);
  assert.equal(rescannedReturnedParcel.body.database.orders[0].status, "shipped");

  const adminAfterReturnedRescan = await call(worker, database, "database", { cookie: adminCookie });
  const reshippedReturnedParcel = adminAfterReturnedRescan.body.database.orders.find((item) => item.id === order.id);
  assert.equal(reshippedReturnedParcel.status, "shipped");
  assert.equal(reshippedReturnedParcel.trackingEvents.filter((event) => event.status === "shipped").length, 2);
  assert.match(reshippedReturnedParcel.trackingEvents.at(-1).note, /الطرد الراجع/);

  const deliveredAfterScan = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: adminAfterReturnedRescan.body.revision,
      database: {
        ...adminAfterReturnedRescan.body.database,
        orders: adminAfterReturnedRescan.body.database.orders.map((item) => item.id === order.id ? { ...item, status: "delivered", updatedAt: new Date().toISOString() } : item),
      },
    },
  });
  assert.equal(deliveredAfterScan.status, 200);

  const premiumCustomer = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(premiumCustomer.body.database.users[0].membership, "premium");
  assert.equal(premiumCustomer.body.database.orders[0].status, "delivered");

  const protectedMerchantWrite = await call(worker, database, "database", {
    method: "PUT",
    cookie: secondCookie,
    payload: {
      revision: premiumCustomer.body.revision,
      database: {
        ...premiumCustomer.body.database,
        orders: premiumCustomer.body.database.orders.map((item) => item.id === order.id ? {
          ...item,
          trackingNumber: "ALX-20999999",
          merchantName: "اسم مزور من أدوات المطور",
          recipientName: "مستلم مزور",
          recipientPhone: "0590000000",
          city: "مدينة مزورة",
          address: "عنوان مزور",
          amount: 999999,
          deliveryFee: 0,
          status: "returned",
          privateNotes: "محاولة حقن ملاحظة داخلية",
        } : item),
      },
    },
  });
  assert.equal(protectedMerchantWrite.status, 200);
  const protectedOrder = protectedMerchantWrite.body.database.orders.find((item) => item.id === order.id);
  assert.equal(protectedOrder.trackingNumber, "ALX-20200001");
  assert.equal(protectedOrder.merchantName, "التاجر الأول");
  assert.equal(protectedOrder.recipientName, "المستلم");
  assert.equal(protectedOrder.recipientPhone, "0597654321");
  assert.equal(protectedOrder.city, "القدس");
  assert.equal(protectedOrder.address, "عنوان خاص");
  assert.equal(protectedOrder.amount, 100);
  assert.equal(protectedOrder.deliveryFee, 56);
  assert.equal(protectedOrder.status, "delivered");
  assert.equal(protectedOrder.privateNotes, "");

  const collectionDraft = {
    id: "collection-cross-device",
    merchantId: firstDevice.body.userId,
    merchantName: "بيانات لا يعتمد عليها الخادم",
    invoiceNumber: "#999999",
    orderIds: [order.id],
    grossAmount: 9999,
    deliveryFees: 0,
    returnFees: 0,
    netAmount: 9999,
    deliveredCount: 99,
    returnedCount: 99,
    status: "shipped",
    verificationCode: "0000",
    authorizedRecipient: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    scheduledAt: new Date(0).toISOString(),
  };

  const createdCollection = await call(worker, database, "database", {
    method: "PUT",
    cookie: secondCookie,
    payload: {
      revision: protectedMerchantWrite.body.revision,
      database: {
        ...protectedMerchantWrite.body.database,
        collections: [collectionDraft],
        nextCollection: protectedMerchantWrite.body.database.nextCollection + 1,
      },
    },
  });

  assert.equal(createdCollection.status, 200);
  assert.equal(createdCollection.body.database.collections.length, 1);
  assert.equal(createdCollection.body.database.collections[0].invoiceNumber, "#618000");
  assert.equal(createdCollection.body.database.collections[0].grossAmount, 100);
  assert.equal(createdCollection.body.database.collections[0].deliveryFees, 56);
  assert.equal(createdCollection.body.database.collections[0].netAmount, 44);
  assert.equal(createdCollection.body.database.collections[0].deliveredCount, 1);
  assert.equal(createdCollection.body.database.collections[0].status, "pending");
  assert.match(createdCollection.body.database.collections[0].verificationCode, /^\d{4}$/);

  const pendingVerificationUpdate = await call(worker, database, "database", {
    method: "PUT",
    cookie: secondCookie,
    payload: {
      revision: createdCollection.body.revision,
      database: {
        ...createdCollection.body.database,
        collections: createdCollection.body.database.collections.map((invoice) => ({ ...invoice, netAmount: 7000, status: "shipped", verificationCode: "2468", authorizedRecipient: "مستلم أثناء التجهيز" })),
      },
    },
  });
  assert.equal(pendingVerificationUpdate.status, 200);
  assert.equal(pendingVerificationUpdate.body.database.collections[0].netAmount, 44);
  assert.equal(pendingVerificationUpdate.body.database.collections[0].status, "pending");
  assert.equal(pendingVerificationUpdate.body.database.collections[0].verificationCode, "2468");
  assert.equal(pendingVerificationUpdate.body.database.collections[0].authorizedRecipient, "مستلم أثناء التجهيز");

  const pendingCollectionVerificationByCourier = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: employeeCookie,
    payload: {
      invoiceId: pendingVerificationUpdate.body.database.collections[0].id,
      verificationCode: "2468",
    },
  });
  assert.equal(pendingCollectionVerificationByCourier.status, 409);

  const pendingCollectionsForCourier = await call(worker, database, "database", { cookie: employeeCookie });
  const pendingCollectionForCourier = pendingCollectionsForCourier.body.database.collections.find((invoice) => invoice.id === pendingVerificationUpdate.body.database.collections[0].id);
  assert.ok(pendingCollectionForCourier);
  assert.equal(pendingCollectionForCourier.status, "pending");
  assert.equal(pendingCollectionForCourier.merchantId, "");
  assert.equal(pendingCollectionForCourier.verificationCode, "");

  const merchantCannotPrepareCollection = await call(worker, database, "collections/prepare", {
    method: "POST",
    cookie: secondCookie,
    payload: { invoiceId: pendingCollectionForCourier.id },
  });
  assert.equal(merchantCannotPrepareCollection.status, 403);

  const employeeCannotPrepareUnknownCollection = await call(worker, database, "collections/prepare", {
    method: "POST",
    cookie: employeeCookie,
    payload: { invoiceId: "collection-does-not-exist" },
  });
  assert.equal(employeeCannotPrepareUnknownCollection.status, 422);

  const isolatedCollections = await call(worker, database, "database", { cookie: otherCookie });
  assert.deepEqual(isolatedCollections.body.database.collections, []);

  const preparedCollection = await call(worker, database, "collections/prepare", {
    method: "POST",
    cookie: employeeCookie,
    payload: { invoiceId: pendingCollectionForCourier.id },
  });
  assert.equal(preparedCollection.status, 200);
  assert.equal(preparedCollection.body.prepared, true);
  assert.equal(preparedCollection.body.database.collections.find((invoice) => invoice.id === pendingCollectionForCourier.id).status, "ready");

  const readyForMerchant = await call(worker, database, "database", { cookie: firstCookie });
  assert.equal(readyForMerchant.body.database.collections[0].status, "ready");
  const preparedNotice = readyForMerchant.body.database.notices.find((notice) => notice.title === "فاتورة التحصيل جاهزة" && notice.message.includes(readyForMerchant.body.database.collections[0].invoiceNumber));
  assert.ok(preparedNotice);
  assert.equal(preparedNotice.userId, firstDevice.body.userId);
  assert.equal(preparedNotice.read, false);
  const securedMerchantUpdate = await call(worker, database, "database", {
    method: "PUT",
    cookie: firstCookie,
    payload: {
      revision: readyForMerchant.body.revision,
      database: {
        ...readyForMerchant.body.database,
        collections: readyForMerchant.body.database.collections.map((invoice) => ({ ...invoice, netAmount: 5000, status: "shipped", verificationCode: "4321", authorizedRecipient: "المستلم المفوض" })),
      },
    },
  });
  assert.equal(securedMerchantUpdate.status, 200);
  assert.equal(securedMerchantUpdate.body.database.collections[0].netAmount, 44);
  assert.equal(securedMerchantUpdate.body.database.collections[0].status, "ready");
  assert.equal(securedMerchantUpdate.body.database.collections[0].verificationCode, "4321");
  assert.equal(securedMerchantUpdate.body.database.collections[0].authorizedRecipient, "المستلم المفوض");

  const invoiceId = securedMerchantUpdate.body.database.collections[0].id;
  const readyCollectionsForCourier = await call(worker, database, "database", { cookie: employeeCookie });
  const readyCollectionForCourier = readyCollectionsForCourier.body.database.collections.find((invoice) => invoice.id === invoiceId);
  assert.equal(readyCollectionsForCourier.status, 200);
  assert.ok(readyCollectionForCourier);
  assert.equal(readyCollectionForCourier.id, invoiceId);
  assert.equal(readyCollectionForCourier.invoiceNumber, securedMerchantUpdate.body.database.collections[0].invoiceNumber);
  assert.equal(readyCollectionForCourier.merchantName, securedMerchantUpdate.body.database.collections[0].merchantName);
  assert.equal(readyCollectionForCourier.status, "ready");
  assert.equal(readyCollectionForCourier.merchantId, "");
  assert.deepEqual(readyCollectionForCourier.orderIds, []);
  assert.equal(readyCollectionForCourier.grossAmount, 0);
  assert.equal(readyCollectionForCourier.deliveryFees, 0);
  assert.equal(readyCollectionForCourier.returnFees, 0);
  assert.equal(readyCollectionForCourier.netAmount, 0);
  assert.equal(readyCollectionForCourier.deliveredCount, 0);
  assert.equal(readyCollectionForCourier.returnedCount, 0);
  assert.equal(readyCollectionForCourier.verificationCode, "");
  assert.equal(readyCollectionForCourier.authorizedRecipient, "");

  const merchantVerification = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: secondCookie,
    payload: { invoiceId, verificationCode: "4321" },
  });
  assert.equal(merchantVerification.status, 403);

  const unknownInvoiceVerification = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: employeeCookie,
    payload: { invoiceId: "collection-does-not-exist", verificationCode: "9999" },
  });
  assert.equal(unknownInvoiceVerification.status, 422);

  const incorrectVerification = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: employeeCookie,
    payload: { invoiceId, verificationCode: "9999" },
  });
  assert.equal(incorrectVerification.status, 422);
  assert.equal(unknownInvoiceVerification.body.error, incorrectVerification.body.error);

  const unchangedAfterIncorrectCode = await call(worker, database, "database", { cookie: adminCookie });
  const stillReady = unchangedAfterIncorrectCode.body.database.collections.find((invoice) => invoice.id === invoiceId);
  const noticeCountBeforeVerification = unchangedAfterIncorrectCode.body.database.notices.length;
  assert.equal(stillReady.status, "ready");
  assert.equal(stillReady.verifiedAt, undefined);
  assert.equal(stillReady.verifiedById, undefined);
  assert.equal(stillReady.verifiedByName, undefined);
  assert.equal(stillReady.paidAt, undefined);

  const verifiedCollection = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: employeeCookie,
    payload: { invoiceId, verificationCode: "4321" },
  });
  assert.equal(verifiedCollection.status, 200);
  const afterCourierVerification = await call(worker, database, "database", { cookie: adminCookie });
  const deliveredInvoice = afterCourierVerification.body.database.collections.find((invoice) => invoice.id === invoiceId);
  assert.equal(deliveredInvoice.status, "paid");
  assert.equal(deliveredInvoice.verifiedById, employeeAccount.id);
  assert.equal(deliveredInvoice.verifiedByName, employeeAccount.name);
  assert.match(deliveredInvoice.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(deliveredInvoice.paidAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(afterCourierVerification.body.database.notices.length, noticeCountBeforeVerification + 1);
  assert.ok(afterCourierVerification.body.database.notices.some((notice) => notice.userId === firstDevice.body.userId));

  const deliveredForMerchant = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(deliveredForMerchant.body.database.collections[0].status, "paid");
  assert.equal(deliveredForMerchant.body.database.collections[0].netAmount, 44);
  assert.ok(deliveredForMerchant.body.database.notices.some((notice) => notice.userId === firstDevice.body.userId));

  const merchantNoteText = "يرجى الاتصال بالمستلم قبل التوصيل.";
  const merchantNote = await call(worker, database, "database", {
    method: "PUT",
    cookie: secondCookie,
    payload: {
      revision: deliveredForMerchant.body.revision,
      database: {
        ...deliveredForMerchant.body.database,
        orders: deliveredForMerchant.body.database.orders.map((item) => item.id === order.id ? {
          ...item,
          status: "returned",
          courierId: sameNameEmployeeAccount.id,
          trackingEvents: [...(item.trackingEvents ?? []), {
            id: "forged-note-id",
            kind: "note",
            status: "returned",
            title: "عنوان مزور",
            location: "موقع مزور",
            actor: "مسؤول مزور",
            note: merchantNoteText,
            createdAt: new Date(0).toISOString(),
          }],
        } : item),
      },
    },
  });

  assert.equal(merchantNote.status, 200);
  const savedMerchantOrder = merchantNote.body.database.orders.find((item) => item.id === order.id);
  const savedMerchantNote = savedMerchantOrder.trackingEvents.at(-1);
  assert.equal(savedMerchantOrder.status, "delivered");
  assert.equal(savedMerchantOrder.courierId, employeeAccount.id);
  assert.equal(savedMerchantNote.kind, "note");
  assert.equal(savedMerchantNote.status, "delivered");
  assert.equal(savedMerchantNote.actor, "التاجر الأول");
  assert.equal(savedMerchantNote.note, merchantNoteText);
  assert.notEqual(savedMerchantNote.id, "forged-note-id");
  assert.notEqual(savedMerchantNote.createdAt, new Date(0).toISOString());

  const adminSeesMerchantNote = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(adminSeesMerchantNote.body.database.orders.find((item) => item.id === order.id).trackingEvents.at(-1).note, merchantNoteText);
  const merchantNoteNotice = adminSeesMerchantNote.body.database.notices.find((notice) => notice.orderId === order.id && notice.message.includes(merchantNoteText));
  assert.ok(merchantNoteNotice);
  assert.equal(merchantNoteNotice.userId, administrator.body.userId);
  assert.equal(merchantNoteNotice.title, "ملاحظة جديدة على الطرد");
  assert.equal(merchantNoteNotice.read, false);
  assert.equal(merchantNote.body.database.notices.some((notice) => notice.message.includes(merchantNoteText)), false);

  const assignedCourierAfterNote = await call(worker, database, "database", { cookie: employeeCookie });
  const assignedNoteNotices = assignedCourierAfterNote.body.database.notices.filter((notice) => notice.orderId === order.id && notice.message.includes(merchantNoteText));
  assert.equal(assignedNoteNotices.length, 1);
  assert.equal(assignedNoteNotices[0].userId, employeeAccount.id);
  assert.equal(assignedNoteNotices[0].title, "ملاحظة جديدة على الطرد");
  assert.equal(assignedNoteNotices[0].read, false);
  const sameNameCourierAfterNote = await call(worker, database, "database", { cookie: sameNameEmployeeCookie });
  assert.equal(sameNameCourierAfterNote.body.database.notices.some((notice) => notice.message.includes(merchantNoteText)), false);

  const otherMerchantAfterMerchantNote = await call(worker, database, "database", { cookie: otherCookie });
  assert.equal(otherMerchantAfterMerchantNote.body.database.notices.some((notice) => notice.message.includes(merchantNoteText)), false);

  const adminNoteText = "تمت مراجعة الملاحظة وسيتم تجهيز الطرد اليوم.";
  const adminNote = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: adminSeesMerchantNote.body.revision,
      database: {
        ...adminSeesMerchantNote.body.database,
        orders: adminSeesMerchantNote.body.database.orders.map((item) => item.id === order.id ? {
          ...item,
          trackingEvents: [...(item.trackingEvents ?? []), {
            id: "admin-note-request",
            kind: "note",
            status: item.status,
            title: "ملاحظة الإدارة",
            location: "مع الإدارة",
            actor: "الإدارة",
            note: adminNoteText,
            createdAt: new Date().toISOString(),
          }],
        } : item),
      },
    },
  });
  assert.equal(adminNote.status, 200);
  assert.equal(adminNote.body.database.orders.find((item) => item.id === order.id).trackingEvents.some((event) => event.note === adminNoteText), true);

  const merchantAfterAdminNote = await call(worker, database, "database", { cookie: secondCookie });
  const adminNoteNotice = merchantAfterAdminNote.body.database.notices.find((notice) => notice.orderId === order.id && notice.message.includes(adminNoteText));
  assert.ok(adminNoteNotice);
  assert.equal(adminNoteNotice.userId, firstDevice.body.userId);
  assert.equal(adminNoteNotice.title, "ملاحظة جديدة على الطرد");
  assert.equal(adminNoteNotice.read, false);
  assert.equal(merchantAfterAdminNote.body.database.orders.find((item) => item.id === order.id).trackingEvents.some((event) => event.note === adminNoteText), true);

  const otherMerchantAfterAdminNote = await call(worker, database, "database", { cookie: otherCookie });
  assert.equal(otherMerchantAfterAdminNote.body.database.notices.some((notice) => notice.orderId === order.id), false);

  const adminStatusNoteText = "تمت مراجعة الطرد وتحويله إلى راجع بناءً على نتيجة المعالجة.";
  const adminStatusUpdate = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: adminNote.body.revision,
      database: {
        ...adminNote.body.database,
        orders: adminNote.body.database.orders.map((item) => item.id === order.id ? {
          ...item,
          status: "returned",
          updatedAt: new Date().toISOString(),
          trackingEvents: [...(item.trackingEvents ?? []), {
            id: "admin-status-note-request",
            kind: "status",
            status: "returned",
            title: "راجع",
            location: "مع الإدارة",
            actor: "الإدارة",
            note: adminStatusNoteText,
            createdAt: new Date().toISOString(),
          }],
        } : item),
      },
    },
  });
  assert.equal(adminStatusUpdate.status, 200);

  const merchantAfterAdminStatusUpdate = await call(worker, database, "database", { cookie: secondCookie });
  const statusUpdateNotice = merchantAfterAdminStatusUpdate.body.database.notices.find((notice) => notice.title === "تحديث حالة الطرد" && notice.message.includes(adminStatusNoteText));
  assert.ok(statusUpdateNotice);
  assert.equal(statusUpdateNotice.userId, firstDevice.body.userId);
  assert.equal(statusUpdateNotice.orderId, order.id);
  assert.equal(statusUpdateNotice.read, false);
  assert.ok(statusUpdateNotice.message.includes("راجع"));

  const otherMerchantAfterAdminStatusUpdate = await call(worker, database, "database", { cookie: otherCookie });
  assert.equal(otherMerchantAfterAdminStatusUpdate.body.database.notices.some((notice) => notice.message.includes(adminStatusNoteText)), false);

  const courierSeesStatusNoteNotice = await call(worker, database, "database", { cookie: employeeCookie });
  assert.equal(courierSeesStatusNoteNotice.status, 200);
  const courierOrderAfterNote = courierSeesStatusNoteNotice.body.database.orders.find((item) => item.id === order.id);
  assert.equal(courierOrderAfterNote.notes, courierInstructions);
  assert.ok(courierOrderAfterNote.trackingEvents.every((event) => event.kind !== "note"));
  assert.ok(JSON.stringify(courierSeesStatusNoteNotice.body.database.notices).includes(merchantNoteText));
  assert.ok(!JSON.stringify(courierSeesStatusNoteNotice.body).includes(adminNoteText));
  assert.equal(courierSeesStatusNoteNotice.body.database.notices.filter((notice) => notice.orderId === order.id && notice.message.includes(merchantNoteText)).length, 1);

  const outdatedWrite = await call(worker, database, "database", {
    method: "PUT",
    cookie: firstCookie,
    payload: { revision: firstDevice.body.revision, database: firstDevice.body.database },
  });
  assert.equal(outdatedWrite.status, 409);
  assert.equal(outdatedWrite.body.database.users.length, 1);

  const tracked = await call(worker, database, "track?tracking=ALX-20200001");
  assert.equal(tracked.status, 200);
  assert.equal(tracked.body.order.id, "public-ALX-20200001");
  assert.equal(tracked.body.order.recipientName, undefined);
  assert.ok(tracked.body.order.trackingEvents.length >= 2);
  assert.equal(tracked.body.order.trackingEvents.at(-1).status, "returned");
  assert.ok(tracked.body.order.trackingEvents.every((event) => event.actor === "فريق المدينة إكسبرس"));
  assert.ok(tracked.body.order.trackingEvents.every((event) => event.kind !== "note"));
  assert.ok(tracked.body.order.trackingEvents.every((event) => event.note !== merchantNoteText));
  assert.equal(tracked.body.order.recipientPhone, undefined);
  assert.equal(tracked.body.order.city, undefined);
  assert.equal(tracked.body.order.governorate, undefined);
  assert.equal(tracked.body.order.address, undefined);
  assert.equal(tracked.body.order.notes, undefined);
  assert.equal(tracked.body.order.privateNotes, undefined);
  assert.ok(!JSON.stringify(tracked.body).includes(courierInstructions));
  assert.ok(!JSON.stringify(tracked.body).includes(adminOnlyNote));

  const duplicate = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("مكرر", "first@example.test", "0599999999"),
  });
  assert.equal(duplicate.status, 409);

  const incorrectPassword = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "first@example.test", password: "Incorrect@123" },
  });
  assert.equal(incorrectPassword.status, 401);

  const anonymous = await call(worker, database, "database");
  assert.equal(anonymous.status, 401);

  const forgedOrigin = await call(worker, database, "database", {
    method: "PUT",
    cookie: firstCookie,
    origin: "http://attacker.test",
    payload: { revision: premiumCustomer.body.revision, database: premiumCustomer.body.database },
  });
  assert.equal(forgedOrigin.status, 403);

  const persisted = JSON.parse(database.state.payload);
  assert.ok(persisted.users.every((account) => account.password.startsWith("pbkdf2:600000:")));
  assert.equal(persisted.orders.find((item) => item.id === order.id).notes, courierInstructions);
  assert.equal(persisted.orders.find((item) => item.id === order.id).privateNotes, adminOnlyNote);
  assert.doesNotMatch(database.state.payload, /Customer@123|Admin@Test-2026!|Managed@123|Employee@123/);

  const loggedOut = await call(worker, database, "logout", { method: "POST", cookie: secondCookie });
  assert.equal(loggedOut.status, 200);
  const revoked = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(revoked.status, 401);
  const stillSignedIn = await call(worker, database, "database", { cookie: firstCookie });
  assert.equal(stillSignedIn.status, 200);
});

test("couriers read every active parcel while private data and write permissions remain scoped", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const merchant = await call(worker, database, "register", {
    method: "POST", payload: accountPayload("التاجر الأول", "staff-read-owner@example.test", "0591000201"),
  });
  const otherMerchant = await call(worker, database, "register", {
    method: "POST", payload: accountPayload("التاجر الثاني", "staff-read-other@example.test", "0591000202"),
  });
  const admin = await call(worker, database, "login", {
    method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(merchant.status, 201);
  assert.equal(otherMerchant.status, 201);
  assert.equal(admin.status, 200);
  const adminCookie = sessionFrom(admin);
  const time = new Date().toISOString();
  const courierAccount = {
    id: "courier-all-parcels", name: "موظف الطرود", email: "staff-read@example.test", phone: "0561000201",
    store: "قسم التوصيل", password: "Courier@123", role: "courier", joinedAt: time, avatarColor: "#6655a6",
  };
  const otherCourier = { ...courierAccount, id: "courier-other-parcels", name: "موظف آخر", email: "staff-read-other-courier@example.test", phone: "0561000202" };
  const created = await call(worker, database, "database", {
    method: "PUT", cookie: adminCookie,
    payload: {
      revision: admin.body.revision,
      database: { ...admin.body.database, users: [...admin.body.database.users, courierAccount, otherCourier] },
    },
  });
  assert.equal(created.status, 200);

  const order = (id, merchantId, status, assignedCourier, deleted = false) => ({
    id, merchantId, merchantName: "تاجر الطرد", merchantStore: "متجر الطرد", trackingNumber: "",
    recipientName: "مستلم الطرد", recipientPhone: "0591234567", governorate: "نابلس", city: "نابلس",
    address: "عنوان المستلم", pickupAddress: "عنوان الاستلام", amount: 100, deliveryFee: 25, content: "ملابس",
    weight: "0 - 5 كغم", dimensions: "20 × 20 × 20 سم", notes: `تعليمات التوصيل ${id}`,
    privateNotes: `ملاحظة إدارية سرية ${id}`, reference: "", type: "طرد عادي", status,
    ...(assignedCourier ? { courierId: assignedCourier.id } : {}), courierName: assignedCourier?.name ?? "بانتظار تعيين المندوب",
    createdAt: time, updatedAt: time, deleted, ...(deleted ? { deletedAt: time } : {}),
    trackingEvents: [
      { id: `${id}-status`, kind: "status", status, title: "حالة الطرد", location: "نابلس", actor: "الإدارة", note: `تعليمات التوصيل ${id}`, createdAt: time },
      { id: `${id}-private-note`, kind: "note", status, title: "ملاحظة خاصة", location: "نابلس", actor: "الإدارة", note: `تفاصيل تتبع خاصة ${id}`, createdAt: time },
    ],
  });
  const seed = JSON.parse(database.state.payload);
  seed.orders = [
    order("staff-assigned", merchant.body.userId, "shipped", courierAccount),
    order("staff-unassigned", otherMerchant.body.userId, "draft"),
    order("staff-other-courier", otherMerchant.body.userId, "delivered", otherCourier),
    order("staff-returned", merchant.body.userId, "returned"),
    order("staff-deleted-self", merchant.body.userId, "shipped", courierAccount, true),
    order("staff-deleted-other", otherMerchant.body.userId, "ready", otherCourier, true),
  ];
  const invoice = (id, status, verifiedById) => ({
    id, merchantId: merchant.body.userId, merchantName: "التاجر الأول", invoiceNumber: `#${id}`, orderIds: ["staff-assigned"],
    grossAmount: 100, deliveryFees: 25, returnFees: 0, netAmount: 75, deliveredCount: 1, returnedCount: 0,
    status, verificationCode: "7391", authorizedRecipient: "المفوض السري", createdAt: time, updatedAt: time, scheduledAt: time,
    returnPricingVersion: 1, returnPricingMembership: "standard", returnFeeDetails: [],
    ...(status === "paid" ? { paidAt: time, verifiedAt: time, verifiedById, verifiedByName: "موظف التحصيل" } : {}),
  });
  seed.collections = [
    invoice("staff-pending", "pending"), invoice("staff-ready", "ready"),
    invoice("staff-paid-self", "paid", courierAccount.id), invoice("staff-paid-other", "paid", otherCourier.id),
  ];
  seed.recipients = [{ id: "staff-private-recipient", merchantId: merchant.body.userId, name: "عنوان محفوظ", phone: "0591234567", city: "نابلس", address: "العنوان الخاص", favorite: true }];
  database.state.payload = JSON.stringify(seed);

  const courier = await call(worker, database, "login", {
    method: "POST", payload: { email: courierAccount.email, password: courierAccount.password },
  });
  assert.equal(courier.status, 200);
  const courierCookie = sessionFrom(courier);
  const current = await call(worker, database, "database", { cookie: courierCookie });
  assert.equal(current.status, 200);
  const expectedIds = seed.orders.filter((item) => !item.deleted).map((item) => item.id).sort();
  for (const response of [courier, current]) {
    const scoped = response.body.database;
    assert.deepEqual(scoped.orders.map((item) => item.id).sort(), expectedIds);
    assert.deepEqual(scoped.users.map((account) => account.id), [courierAccount.id]);
    assert.equal(scoped.users[0].password, "");
    assert.deepEqual(scoped.recipients, []);
    assert.ok(scoped.notices.every((notice) => notice.userId === courierAccount.id));
    assert.ok(Object.keys(scoped.preferences).every((id) => id === courierAccount.id));
    for (const parcel of scoped.orders) {
      assert.equal(parcel.notes, `تعليمات التوصيل ${parcel.id}`);
      assert.equal(parcel.privateNotes, "");
      assert.deepEqual(parcel.trackingEvents.map((event) => event.id), [`${parcel.id}-status`]);
      assert.equal(parcel.trackingEvents[0].note, "تم إنشاء الطرد وهو قيد الإنشاء.");
    }
    assert.ok(!JSON.stringify(scoped).includes("ملاحظة إدارية سرية"));
    assert.ok(!JSON.stringify(scoped).includes("تفاصيل تتبع خاصة"));
    assert.deepEqual(scoped.collections.map((entry) => entry.id).sort(), ["staff-paid-self", "staff-pending", "staff-ready"]);
    for (const entry of scoped.collections) {
      assert.equal(entry.merchantId, "");
      assert.deepEqual(entry.orderIds, []);
      for (const field of ["grossAmount", "deliveryFees", "returnFees", "netAmount", "deliveredCount", "returnedCount"]) assert.equal(entry[field], 0);
      for (const field of ["verificationCode", "authorizedRecipient", "createdAt", "updatedAt", "scheduledAt"]) assert.equal(entry[field], "");
    }
  }
  for (const account of [merchant, otherMerchant]) {
    const scoped = await call(worker, database, "database", { cookie: sessionFrom(account) });
    assert.equal(scoped.status, 200);
    assert.deepEqual(scoped.body.database.users.map((entry) => entry.id), [account.body.userId]);
    assert.deepEqual(scoped.body.database.orders.map((entry) => entry.id).sort(), seed.orders.filter((entry) => entry.merchantId === account.body.userId).map((entry) => entry.id).sort());
    assert.ok(scoped.body.database.collections.every((entry) => entry.merchantId === account.body.userId));
  }

  const before = await call(worker, database, "database", { cookie: adminCookie });
  const forged = await call(worker, database, "database", {
    method: "PUT", cookie: courierCookie,
    payload: {
      revision: current.body.revision,
      database: {
        ...current.body.database,
        users: [
          { ...current.body.database.users[0], role: "admin", name: "مسؤول مزور", email: "forged-staff@example.test", password: "Forged@123" },
          { ...otherCourier, id: "forged-new-account", role: "admin", email: "forged-new-admin@example.test" },
        ],
        orders: current.body.database.orders.filter((entry) => entry.id !== "staff-other-courier").map((entry) => ({
          ...entry, status: "delivered", deleted: true, deletedAt: time, courierId: courierAccount.id,
          amount: 9999, recipientPhone: "0599999999", notes: "تعليمات مزورة", privateNotes: "ملاحظة مزورة", trackingEvents: [],
        })),
        collections: current.body.database.collections.filter((entry) => entry.id !== "staff-pending").map((entry) => ({
          ...entry, status: "paid", paidAt: time, verificationCode: "1111", netAmount: 9999, authorizedRecipient: "مفوض مزور",
        })),
        nextOrder: 99999999,
        nextCollection: 99999999,
      },
    },
  });
  assert.equal(forged.status, 200);
  assert.equal(forged.body.database.users[0].role, "courier");
  assert.deepEqual(forged.body.database.orders.map((entry) => entry.id).sort(), expectedIds);
  const after = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(after.status, 200);
  for (const field of ["users", "orders", "collections", "recipients", "nextOrder", "nextCollection"]) {
    assert.deepEqual(after.body.database[field], before.body.database[field], `courier must not change ${field}`);
  }
  const persisted = JSON.parse(database.state.payload);
  assert.deepEqual(persisted.users, seed.users, "courier must not create, remove, promote, or change account credentials");
  assert.deepEqual(persisted.orders, seed.orders, "courier must not edit, delete, reassign, or overwrite hidden parcel fields");
});

test("invoice list deletion synchronizes for its account and keeps paid records on the server", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const first = await call(worker, database, "register", { method: "POST", payload: accountPayload("صاحب الفاتورة", "swipe-owner@example.test", "0594433221") });
  const second = await call(worker, database, "register", { method: "POST", payload: accountPayload("حساب آخر", "swipe-other@example.test", "0594433222") });
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  const ownerId = first.body.userId, otherId = second.body.userId;
  const time = "2026-01-01T00:00:00.000Z";
  const invoice = {
    id: "swipe-paid-invoice", merchantId: ownerId, merchantName: "صاحب الفاتورة", invoiceNumber: "#618900",
    orderIds: [], grossAmount: 100, deliveryFees: 25, returnFees: 0, netAmount: 75, deliveredCount: 1, returnedCount: 0,
    status: "paid", verificationCode: "1234", authorizedRecipient: "", createdAt: time, updatedAt: time, scheduledAt: time, paidAt: time,
    returnPricingVersion: 1, returnPricingMembership: "standard", returnFeeDetails: [],
  };
  const seed = JSON.parse(database.state.payload);
  seed.collections = [invoice, { ...invoice, id: "other-private-entry", merchantId: otherId, invoiceNumber: "#618901" }];
  seed.preferences[otherId] = { ...seed.preferences[otherId], hiddenCollectionIds: ["other-private-entry"] };
  database.state.payload = JSON.stringify(seed);
  const cookie = sessionFrom(first);
  const current = await call(worker, database, "database", { cookie });
  assert.equal(current.status, 200);
  const next = setCollectionHidden(current.body.database, ownerId, invoice.id, true);
  // Simulate an untrusted client attempting to alter a second account's list.
  next.preferences[otherId] = { hiddenCollectionIds: ["tampered"] };
  const saved = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: current.body.revision, database: next } });
  assert.equal(saved.status, 200);
  assert.equal(hiddenCollectionIds(saved.body.database, ownerId).has(invoice.id), true);
  assert.equal(saved.body.database.collections.find((item) => item.id === invoice.id).status, "paid");
  const other = await call(worker, database, "database", { cookie: sessionFrom(second) });
  assert.deepEqual(other.body.database.preferences[otherId].hiddenCollectionIds, ["other-private-entry"]);
  const secondDevice = await call(worker, database, "login", { method: "POST", payload: { email: "swipe-owner@example.test", password: "Customer@123" } });
  assert.equal(hiddenCollectionIds(secondDevice.body.database, ownerId).has(invoice.id), true);
  const restored = await call(worker, database, "database", { method: "PUT", cookie: sessionFrom(secondDevice), payload: { revision: secondDevice.body.revision, database: setCollectionHidden(secondDevice.body.database, ownerId, invoice.id, false) } });
  assert.equal(restored.status, 200);
  assert.equal(hiddenCollectionIds(restored.body.database, ownerId).size, 0);
  assert.equal(JSON.parse(database.state.payload).collections.find((item) => item.id === invoice.id).netAmount, 75);
});

test("server blocks hiding outstanding invoices for merchants and admins, repairs old visibility and retains omitted invoices", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const owner = await call(worker, database, "register", { method: "POST", payload: accountPayload("صاحب المستحقات", "due-owner@example.test", "0594433291") });
  const admin = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  assert.equal(owner.status, 201); assert.equal(admin.status, 200);
  const seed = JSON.parse(database.state.payload);
  const time = "2026-01-01T00:00:00.000Z";
  seed.collections = ["pending", "ready", "paid"].map((status, index) => ({
    id: `due-${status}`, merchantId: owner.body.userId, merchantName: "صاحب المستحقات", invoiceNumber: `#61900${index}`,
    orderIds: [], grossAmount: 0, deliveryFees: 0, returnFees: 0, netAmount: 0, deliveredCount: 0, returnedCount: 0,
    status, verificationCode: "1234", authorizedRecipient: "", createdAt: time, updatedAt: time, scheduledAt: time,
    returnPricingVersion: 1, returnPricingMembership: "standard", returnFeeDetails: [],
  }));
  seed.preferences[owner.body.userId] = { ...seed.preferences[owner.body.userId], hiddenCollectionIds: ["due-pending", "due-ready", "due-paid"] };
  database.state.payload = JSON.stringify(seed);
  for (const session of [owner, admin]) {
    const cookie = sessionFrom(session), userId = session.body.userId;
    let current = await call(worker, database, "database", { cookie });
    assert.equal(current.status, 200);
    if (session === owner) assert.deepEqual(current.body.database.preferences[userId].hiddenCollectionIds, ["due-paid"]);
    for (const status of ["pending", "ready"]) {
      const submitted = structuredClone(current.body.database);
      submitted.preferences[userId] = { ...submitted.preferences[userId], hiddenCollectionIds: [`due-${status}`] };
      // Hiding and forging a paid status in one request cannot bypass the check.
      submitted.collections.find((invoice) => invoice.id === `due-${status}`).status = "paid";
      const result = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: current.body.revision, database: submitted } });
      assert.equal(result.status, 403); assert.match(result.body.error, /مستحقة/);
    }
    const omitted = structuredClone(current.body.database); omitted.collections = [];
    const result = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: current.body.revision, database: omitted } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.database.collections.map((invoice) => invoice.id).sort(), ["due-paid", "due-pending", "due-ready"]);
    assert.equal(result.body.database.collections.find((invoice) => invoice.id === "due-ready").status, "ready");
  }
});

test("preserves a settled return invoice and bills a later delivery once after a courier rescan", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const registration = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر إعادة الشحن", "reship-merchant@example.test", "0594455771"),
  });
  assert.equal(registration.status, 201);
  const merchantCookie = sessionFrom(registration);
  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);
  const oldTime = "2026-01-01T10:00:00.000Z";
  const courierAccount = {
    id: "courier-return-reship", name: "موظف إعادة الشحن", email: "reship-courier@example.test",
    phone: "0564455771", store: "قسم التوصيل", password: "Courier@123", role: "courier",
    joinedAt: oldTime, avatarColor: "#6655a6",
  };
  const courierCreated = await call(worker, database, "database", {
    method: "PUT", cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: { ...administrator.body.database, users: [...administrator.body.database.users, courierAccount] },
    },
  });
  assert.equal(courierCreated.status, 200);
  const courier = await call(worker, database, "login", {
    method: "POST", payload: { email: courierAccount.email, password: courierAccount.password },
  });
  assert.equal(courier.status, 200);
  const courierCookie = sessionFrom(courier);
  const order = {
    id: "order-return-reship", trackingNumber: "ALX-20880001", merchantId: registration.body.userId,
    merchantName: "تاجر إعادة الشحن", merchantStore: "متجر إعادة الشحن", recipientName: "مستلم الطرد",
    recipientPhone: "0591122334", governorate: "نابلس", city: "نابلس", address: "رفيديا",
    pickupAddress: "نابلس", amount: 100, deliveryFee: 25, content: "ملابس", weight: "0 - 5 كغم",
    dimensions: "20 × 20 × 20 سم", notes: "", privateNotes: "", reference: "", type: "طرد عادي",
    status: "returned", courierName: "بانتظار تعيين المندوب", shippedAt: oldTime,
    createdAt: oldTime, updatedAt: oldTime, deleted: false,
  };
  const invoice = {
    id: "invoice-settled-return", merchantId: registration.body.userId, merchantName: order.merchantName,
    invoiceNumber: "#618800", orderIds: [order.id], grossAmount: 0, deliveryFees: 0, returnFees: 20,
    netAmount: -20, deliveredCount: 0, returnedCount: 1, status: "ready", verificationCode: "2468",
    authorizedRecipient: "", createdAt: oldTime, updatedAt: oldTime, scheduledAt: oldTime,
  };
  const seed = JSON.parse(database.state.payload);
  database.state.payload = JSON.stringify({ ...seed, orders: [order], collections: [invoice] });
  const paid = await call(worker, database, "collections/verify", {
    method: "POST", cookie: courierCookie,
    payload: { invoiceId: invoice.id, verificationCode: invoice.verificationCode },
  });
  assert.equal(paid.status, 200);

  // The original return was settled before today's second shipping attempt.
  const settledState = JSON.parse(database.state.payload);
  const settledInvoice = settledState.collections.find((entry) => entry.id === invoice.id);
  settledInvoice.paidAt = "2026-01-02T10:00:00.000Z";
  settledInvoice.verifiedAt = settledInvoice.paidAt;
  settledInvoice.updatedAt = settledInvoice.paidAt;
  database.state.payload = JSON.stringify(settledState);
  assert.equal(settledInvoice.status, "paid");
  assert.equal(settledInvoice.returnPricingVersion, 1);
  assert.equal(isOrderInvoicedForCurrentShipment(order, [settledInvoice]), true);

  const rescanned = await call(worker, database, "orders/scan", {
    method: "POST", cookie: courierCookie, payload: { trackingNumber: order.trackingNumber },
  });
  assert.equal(rescanned.status, 200);
  const rescannedOrder = rescanned.body.database.orders.find((entry) => entry.id === order.id);
  assert.equal(rescannedOrder.status, "shipped");
  assert.equal(rescannedOrder.courierId, courierAccount.id);
  assert.match(rescannedOrder.trackingEvents.at(-1).note, /الطرد الراجع/);
  assert.equal(isOrderInvoicedForCurrentShipment(rescannedOrder, [settledInvoice]), false);
  assert.equal(isOrderInvoicedForCurrentShipment(rescannedOrder, [{ ...settledInvoice, status: "ready" }]), true);
  assert.equal(isOrderInvoicedForCurrentShipment({ ...rescannedOrder, shippedAt: undefined }, [settledInvoice]), true);
  assert.equal(isOrderInvoicedForCurrentShipment(rescannedOrder, [{ ...settledInvoice, paidAt: "invalid" }]), true);
  assert.deepEqual(JSON.parse(database.state.payload).collections.find((entry) => entry.id === invoice.id), settledInvoice);
  const merchantAfterScan = await call(worker, database, "database", { cookie: merchantCookie });
  assert.deepEqual(merchantAfterScan.body.database.collections.find((entry) => entry.id === invoice.id), settledInvoice);

  const adminAfterScan = await call(worker, database, "database", { cookie: adminCookie });
  const delivered = await call(worker, database, "database", {
    method: "PUT", cookie: adminCookie,
    payload: {
      revision: adminAfterScan.body.revision,
      database: {
        ...adminAfterScan.body.database,
        orders: adminAfterScan.body.database.orders.map((entry) => entry.id === order.id
          ? { ...entry, status: "delivered", updatedAt: new Date().toISOString() } : entry),
      },
    },
  });
  assert.equal(delivered.status, 200);
  const merchantWithDelivery = await call(worker, database, "database", { cookie: merchantCookie });
  assert.deepEqual(merchantWithDelivery.body.database.collections.find((entry) => entry.id === invoice.id), settledInvoice);
  const newInvoice = { ...invoice, id: "invoice-second-delivery", status: "pending" };
  const beforeDuplicates = database.state.payload;
  const duplicateBatch = await call(worker, database, "database", {
    method: "PUT", cookie: merchantCookie,
    payload: {
      revision: merchantWithDelivery.body.revision,
      database: {
        ...merchantWithDelivery.body.database,
        collections: [newInvoice, { ...newInvoice, id: "invoice-duplicate-delivery" }, ...merchantWithDelivery.body.database.collections],
      },
    },
  });
  assert.equal(duplicateBatch.status, 409);
  assert.equal(database.state.payload, beforeDuplicates);

  const billed = await call(worker, database, "database", {
    method: "PUT", cookie: merchantCookie,
    payload: {
      revision: merchantWithDelivery.body.revision,
      database: { ...merchantWithDelivery.body.database, collections: [newInvoice, ...merchantWithDelivery.body.database.collections] },
    },
  });
  assert.equal(billed.status, 200, billed.body.error);
  const deliveryInvoice = billed.body.database.collections.find((entry) => entry.id === newInvoice.id);
  assert.equal(deliveryInvoice.grossAmount, 100);
  assert.equal(deliveryInvoice.deliveryFees, 25);
  assert.equal(deliveryInvoice.returnFees, 0);
  assert.equal(deliveryInvoice.netAmount, 75);
  assert.equal(deliveryInvoice.deliveredCount, 1);
  assert.equal(isOrderInvoicedForCurrentShipment(rescannedOrder, billed.body.database.collections), true);
  const repeated = await call(worker, database, "database", {
    method: "PUT", cookie: merchantCookie,
    payload: {
      revision: billed.body.revision,
      database: { ...billed.body.database, collections: [{ ...newInvoice, id: "invoice-repeated-delivery" }, ...billed.body.database.collections] },
    },
  });
  assert.equal(repeated.status, 409);
  const finalMerchantView = await call(worker, database, "database", { cookie: merchantCookie });
  assert.equal(finalMerchantView.body.database.collections.length, 2);
  assert.deepEqual(finalMerchantView.body.database.collections.find((entry) => entry.id === invoice.id), settledInvoice);
});

test("rate limits repeated courier collection-code attempts without changing the invoice", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

  const merchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر محدد المحاولات", "collection-limit-merchant@example.test", "0594444444"),
  });
  assert.equal(merchant.status, 201);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);

  const courierAccount = {
    id: "courier-collection-rate-limit",
    name: "موظف محدد المحاولات",
    email: "collection-limit-courier@example.test",
    phone: "0564444444",
    store: "قسم التحصيلات",
    password: "Courier@123",
    role: "courier",
    joinedAt: new Date().toISOString(),
    avatarColor: "#6655a6",
  };
  const courierCreated = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        users: [...administrator.body.database.users, courierAccount],
      },
    },
  });
  assert.equal(courierCreated.status, 200);

  const courier = await call(worker, database, "login", {
    method: "POST",
    payload: { email: courierAccount.email, password: courierAccount.password },
  });
  assert.equal(courier.status, 200);
  const courierCookie = sessionFrom(courier);

  const invoice = {
    id: "collection-rate-limited",
    merchantId: merchant.body.userId,
    merchantName: "تاجر محدد المحاولات",
    invoiceNumber: "#619999",
    orderIds: [],
    grossAmount: 100,
    deliveryFees: 25,
    returnFees: 0,
    netAmount: 75,
    deliveredCount: 1,
    returnedCount: 0,
    status: "ready",
    verificationCode: "2468",
    authorizedRecipient: "المستلم المفوض",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scheduledAt: new Date().toISOString(),
  };
  const seededState = JSON.parse(database.state.payload);
  database.state.payload = JSON.stringify({ ...seededState, collections: [...seededState.collections, invoice] });
  const stateBeforeAttempts = database.state.payload;
  const revisionBeforeAttempts = database.state.revision;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const rejected = await call(worker, database, "collections/verify", {
      method: "POST",
      cookie: courierCookie,
      payload: { invoiceId: invoice.id, verificationCode: "9999" },
    });
    assert.equal(rejected.status, 422, `expected wrong-code attempt ${attempt} to reach validation`);
  }

  const rateLimited = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: courierCookie,
    payload: { invoiceId: invoice.id, verificationCode: invoice.verificationCode },
  });
  assert.equal(rateLimited.status, 429);
  assert.match(rateLimited.body.error, /محاولات كثيرة/);
  assert.equal(database.state.revision, revisionBeforeAttempts);
  assert.equal(database.state.payload, stateBeforeAttempts);

  const unchanged = await call(worker, database, "database", { cookie: adminCookie });
  const unchangedInvoice = unchanged.body.database.collections.find((entry) => entry.id === invoice.id);
  assert.equal(unchanged.status, 200);
  assert.ok(unchangedInvoice);
  assert.equal(unchangedInvoice.status, "ready");
  assert.equal(unchangedInvoice.verifiedAt, undefined);
  assert.equal(unchangedInvoice.verifiedById, undefined);
  assert.equal(unchangedInvoice.verifiedByName, undefined);
  assert.equal(unchangedInvoice.paidAt, undefined);
});

test("rate limits a courier after twenty collection-code attempts across different invoices", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

  const merchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر الحد العام", "collection-global-merchant@example.test", "0595555555"),
  });
  assert.equal(merchant.status, 201);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);

  const courierAccount = {
    id: "courier-collection-global-rate-limit",
    name: "موظف الحد العام",
    email: "collection-global-courier@example.test",
    phone: "0565555555",
    store: "قسم التحصيلات",
    password: "Courier@123",
    role: "courier",
    joinedAt: new Date().toISOString(),
    avatarColor: "#6655a6",
  };
  const courierCreated = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        users: [...administrator.body.database.users, courierAccount],
      },
    },
  });
  assert.equal(courierCreated.status, 200);

  const courier = await call(worker, database, "login", {
    method: "POST",
    payload: { email: courierAccount.email, password: courierAccount.password },
  });
  assert.equal(courier.status, 200);
  const courierCookie = sessionFrom(courier);

  const now = new Date().toISOString();
  const invoices = Array.from({ length: 21 }, (_, index) => ({
    id: `collection-global-rate-${index + 1}`,
    merchantId: merchant.body.userId,
    merchantName: "تاجر الحد العام",
    invoiceNumber: `#62${String(index + 1).padStart(4, "0")}`,
    orderIds: [],
    grossAmount: 100,
    deliveryFees: 25,
    returnFees: 0,
    netAmount: 75,
    deliveredCount: 1,
    returnedCount: 0,
    status: "ready",
    verificationCode: "2468",
    authorizedRecipient: "المستلم المفوض",
    createdAt: now,
    updatedAt: now,
    scheduledAt: now,
  }));
  const seededState = JSON.parse(database.state.payload);
  database.state.payload = JSON.stringify({ ...seededState, collections: [...seededState.collections, ...invoices] });
  const stateBeforeAttempts = database.state.payload;
  const revisionBeforeAttempts = database.state.revision;

  for (let index = 0; index < 20; index += 1) {
    const rejected = await call(worker, database, "collections/verify", {
      method: "POST",
      cookie: courierCookie,
      payload: { invoiceId: invoices[index].id, verificationCode: "9999" },
    });
    assert.equal(rejected.status, 422, `expected global attempt ${index + 1} to reach code validation`);
  }

  const rateLimited = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: courierCookie,
    payload: { invoiceId: invoices[20].id, verificationCode: invoices[20].verificationCode },
  });
  assert.equal(rateLimited.status, 429);
  assert.match(rateLimited.body.error, /محاولات كثيرة/);
  assert.equal(database.state.revision, revisionBeforeAttempts);
  assert.equal(database.state.payload, stateBeforeAttempts);

  const unchanged = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.database.collections.length, invoices.length);
  assert.ok(unchanged.body.database.collections.every((invoice) => invoice.status === "ready"));
  assert.ok(unchanged.body.database.collections.every((invoice) => invoice.verifiedAt === undefined && invoice.paidAt === undefined));
});

test("allows only the administrator to change merchant and courier account fields", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

  const merchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("التاجر الأصلي", "profile-owner@example.test", "0591111111"),
  });
  assert.equal(merchant.status, 201);
  const merchantCookie = sessionFrom(merchant);

  const secondMerchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("التاجر الثاني", "profile-second@example.test", "0562222222"),
  });
  assert.equal(secondMerchant.status, 201);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);

  const courierId = "courier-profile-permissions";
  const courierAccount = {
    id: courierId,
    name: "المندوب الأصلي",
    email: "profile-courier@example.test",
    phone: "0563333333",
    store: "منطقة القدس",
    password: "Courier@123",
    role: "courier",
    joinedAt: new Date().toISOString(),
    avatarColor: "#6655a6",
  };
  const courierCreated = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        users: [...administrator.body.database.users, courierAccount],
      },
    },
  });
  assert.equal(courierCreated.status, 200);

  const merchantSnapshot = await call(worker, database, "database", { cookie: merchantCookie });
  const originalMerchant = merchantSnapshot.body.database.users[0];
  const forgedMerchant = await call(worker, database, "database", {
    method: "PUT",
    cookie: merchantCookie,
    payload: {
      revision: merchantSnapshot.body.revision,
      database: {
        ...merchantSnapshot.body.database,
        users: merchantSnapshot.body.database.users.map((account) => ({
          ...account,
          name: "اسم مزور من المستخدم",
          email: "forged-merchant@example.test",
          phone: "0599999999",
          store: "متجر مزور",
        })),
      },
    },
  });
  assert.equal(forgedMerchant.status, 200);
  assert.deepEqual(
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(forgedMerchant.body.database.users[0]),
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(originalMerchant),
  );

  const courier = await call(worker, database, "login", {
    method: "POST",
    payload: { email: courierAccount.email, password: courierAccount.password },
  });
  assert.equal(courier.status, 200);
  const courierCookie = sessionFrom(courier);
  const forgedCourier = await call(worker, database, "database", {
    method: "PUT",
    cookie: courierCookie,
    payload: {
      revision: courier.body.revision,
      database: {
        ...courier.body.database,
        users: courier.body.database.users.map((account) => ({
          ...account,
          name: "اسم مزور من المندوب",
          email: "forged-courier@example.test",
          phone: "0569999999",
          store: "منطقة مزورة",
        })),
      },
    },
  });
  assert.equal(forgedCourier.status, 200);
  assert.deepEqual(
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(forgedCourier.body.database.users[0]),
    {
      name: courierAccount.name,
      email: courierAccount.email,
      phone: courierAccount.phone,
      store: courierAccount.store,
    },
  );

  const latestAdmin = await call(worker, database, "database", { cookie: adminCookie });
  const merchantUpdate = {
    name: "التاجر بعد تعديل المسؤول",
    email: "profile-owner-updated@example.test",
    phone: "0584444444",
    store: "المتجر بعد التعديل",
  };
  const courierUpdate = {
    name: "المندوب بعد تعديل المسؤول",
    email: "profile-courier-updated@example.test",
    phone: "0585555555",
    store: "منطقة رام الله",
  };
  const administratorUpdated = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: latestAdmin.body.revision,
      database: {
        ...latestAdmin.body.database,
        users: latestAdmin.body.database.users.map((account) => account.id === merchant.body.userId
          ? { ...account, ...merchantUpdate }
          : account.id === courierId
            ? { ...account, ...courierUpdate }
            : account),
      },
    },
  });
  assert.equal(administratorUpdated.status, 200);
  assert.deepEqual(
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(administratorUpdated.body.database.users.find((account) => account.id === merchant.body.userId)),
    merchantUpdate,
  );
  assert.deepEqual(
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(administratorUpdated.body.database.users.find((account) => account.id === courierId)),
    courierUpdate,
  );

  const merchantAfterAdmin = await call(worker, database, "database", { cookie: merchantCookie });
  const courierAfterAdmin = await call(worker, database, "database", { cookie: courierCookie });
  assert.deepEqual(
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(merchantAfterAdmin.body.database.users[0]),
    merchantUpdate,
  );
  assert.deepEqual(
    (({ name, email, phone, store }) => ({ name, email, phone, store }))(courierAfterAdmin.body.database.users[0]),
    courierUpdate,
  );

  const oldMerchantLogin = await call(worker, database, "login", {
    method: "POST",
    payload: { email: originalMerchant.email, password: "Customer@123" },
  });
  const oldCourierLogin = await call(worker, database, "login", {
    method: "POST",
    payload: { email: courierAccount.email, password: courierAccount.password },
  });
  assert.equal(oldMerchantLogin.status, 401);
  assert.equal(oldCourierLogin.status, 401);
  assert.equal((await call(worker, database, "login", { method: "POST", payload: { email: merchantUpdate.email, password: "Customer@123" } })).status, 200);
  assert.equal((await call(worker, database, "login", { method: "POST", payload: { email: courierUpdate.email, password: courierAccount.password } })).status, 200);

  const duplicateEmail = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administratorUpdated.body.revision,
      database: {
        ...administratorUpdated.body.database,
        users: administratorUpdated.body.database.users.map((account) => account.id === courierId
          ? { ...account, email: " PROFILE-SECOND@EXAMPLE.TEST " }
          : account),
      },
    },
  });
  assert.equal(duplicateEmail.status, 409);
  const unchangedAfterDuplicate = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(unchangedAfterDuplicate.body.revision, administratorUpdated.body.revision);
  assert.equal(unchangedAfterDuplicate.body.database.users.find((account) => account.id === courierId).email, courierUpdate.email);
});

test("recalculates progressive weight and dimension fees without trusting client totals", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const issuedCodes = await reserveCodes(worker, database, 13);
  const registration = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر القياسات", "dimensions@example.test", "0591112233"),
  });
  assert.equal(registration.status, 201);
  const cookie = sessionFrom(registration);

  let snapshot = registration.body;
  const cases = [
    { id: "parcel-at-limit", weight: "0 - 5 كغم", dimensions: [40, 40, 40], expectedWeightFee: 0, expectedOversizeFee: 0, expectedFee: 35 },
    { id: "parcel-one-over", weight: "5 - 10 كغم", dimensions: [41, 20, 20], expectedWeightFee: 5, expectedOversizeFee: 7, expectedFee: 47 },
    { id: "parcel-first-tier-end", weight: "10 - 20 كغم", dimensions: [60, 20, 20], expectedWeightFee: 10, expectedOversizeFee: 7, expectedFee: 52 },
    { id: "parcel-second-tier", weight: "20 - 30 كغم", dimensions: [61, 20, 20], expectedWeightFee: 15, expectedOversizeFee: 14, expectedFee: 64 },
    { id: "parcel-third-tier", weight: "أكثر من 30 كغم", dimensions: [81, 20, 20], expectedWeightFee: 20, expectedOversizeFee: 21, expectedFee: 76 },
    { id: "parcel-capped-size", weight: "أكثر من 30 كغم", dimensions: [101, 20, 20], expectedWeightFee: 20, expectedOversizeFee: 28, expectedFee: 83 },
    { id: "parcel-all-over", weight: "0 - 5 كغم", dimensions: [50, 50, 50], expectedWeightFee: 0, expectedOversizeFee: 21, expectedFee: 56 },
    { id: "parcel-mixed-tiers", weight: "0 - 5 كغم", dimensions: [41, 61, 81], expectedWeightFee: 0, expectedOversizeFee: 42, expectedFee: 77 },
    { id: "parcel-partial-width", weight: undefined, dimensions: [undefined, 50, undefined], dimensionText: "50 سم", expectedDimensions: [0, 50, 0], expectedWeight: "0 - 5 كغم", expectedWeightFee: 0, expectedOversizeFee: 7, expectedFee: 42 },
    { id: "parcel-arabic-digits", weight: "5 - 10 كغم", dimensions: [undefined, undefined, undefined], dimensionText: "٨١ × ٢٠ × ٢٠ سم", expectedDimensions: [81, 20, 20], expectedWeightFee: 5, expectedOversizeFee: 21, expectedFee: 61 },
    { id: "parcel-decimal-arabic-digits", weight: "0 - 5 كغم", dimensions: [undefined, undefined, undefined], dimensionText: "٤٠٫٥ × ٦٠٫٢٥ × ۸۰,۵ سم", expectedDimensions: [40.5, 60.25, 80.5], expectedWeightFee: 0, expectedOversizeFee: 42, expectedFee: 77 },
  ];

  for (const [index, entry] of cases.entries()) {
    const [lengthCm, widthCm, heightCm] = entry.dimensions;
    const now = new Date().toISOString();
    const candidate = {
      id: entry.id,
      trackingNumber: issuedCodes[index],
      merchantId: registration.body.userId,
      merchantName: "قيمة غير موثوقة",
      merchantStore: "قيمة غير موثوقة",
      recipientName: `مستلم ${index + 1}`,
      recipientPhone: "0597654321",
      governorate: "القدس",
      city: "القدس",
      address: "عنوان الاختبار",
      pickupAddress: "الخليل",
      amount: 100,
      deliveryFee: index % 2 ? 0 : 999,
      content: "طرد قياسات",
      weight: entry.weight,
      dimensions: entry.dimensionText ?? `${lengthCm} × ${widthCm} × ${heightCm} سم`,
      lengthCm,
      widthCm,
      heightCm,
      weightFee: 999,
      oversizeFee: 999,
      notes: "",
      privateNotes: "",
      reference: "",
      type: "طرد عادي",
      status: "ready",
      courierName: "بانتظار تعيين المندوب",
      createdAt: now,
      updatedAt: now,
      deleted: false,
    };

    const response = await call(worker, database, "database", {
      method: "PUT",
      cookie,
      payload: {
        revision: snapshot.revision,
        database: {
          ...snapshot.database,
          orders: [candidate, ...snapshot.database.orders],
          nextOrder: snapshot.database.nextOrder + 1,
        },
      },
    });

    assert.equal(response.status, 200, `${entry.id}: ${response.body?.error ?? "unknown error"}`);
    const saved = response.body.database.orders.find((order) => order.id === entry.id);
    assert.equal(saved.deliveryFee, entry.expectedFee);
    assert.equal(saved.weight, entry.expectedWeight ?? entry.weight);
    assert.equal(saved.weightFee, entry.expectedWeightFee);
    assert.equal(saved.oversizeFee, entry.expectedOversizeFee);
    assert.deepEqual(
      [saved.lengthCm ?? 0, saved.widthCm ?? 0, saved.heightCm ?? 0],
      entry.expectedDimensions ?? entry.dimensions,
    );
    snapshot = response.body;
  }

  const conflictingDestination = {
    ...snapshot.database.orders[0],
    id: "parcel-conflicting-destination",
    trackingNumber: issuedCodes[11],
    governorate: "الخليل",
    city: "حيفا",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const rejectedConflict = await call(worker, database, "database", {
    method: "PUT",
    cookie,
    payload: {
      revision: snapshot.revision,
      database: {
        ...snapshot.database,
        orders: [conflictingDestination, ...snapshot.database.orders],
        nextOrder: snapshot.database.nextOrder + 1,
      },
    },
  });
  assert.equal(rejectedConflict.status, 400);
  assert.match(rejectedConflict.body.error, /تطابق المحافظة والمدينة/);
  const unchangedAfterConflict = await call(worker, database, "database", { cookie });
  assert.equal(unchangedAfterConflict.body.revision, snapshot.revision);
  assert.equal(unchangedAfterConflict.body.database.orders.some((order) => order.id === conflictingDestination.id), false);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);
  const premiumUpgrade = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        users: administrator.body.database.users.map((account) => account.id === registration.body.userId
          ? { ...account, membership: "premium" }
          : account),
      },
    },
  });
  assert.equal(premiumUpgrade.status, 200);

  const premiumMerchant = await call(worker, database, "database", { cookie });
  const now = new Date().toISOString();
  const premiumOversize = {
    id: "parcel-premium-over",
    trackingNumber: issuedCodes[12],
    merchantId: registration.body.userId,
    merchantName: "قيمة غير موثوقة",
    merchantStore: "قيمة غير موثوقة",
    recipientName: "مستلم بريميوم",
    recipientPhone: "0597654321",
    governorate: "القدس",
    city: "القدس",
    address: "عنوان الاختبار",
    pickupAddress: "الخليل",
    amount: 100,
    deliveryFee: 999,
    content: "طرد قياسات",
    weight: "أكثر من 30 كغم",
    dimensions: "101 × 20 × 20 سم",
    lengthCm: 101,
    widthCm: 20,
    heightCm: 20,
    weightFee: 999,
    oversizeFee: 999,
    notes: "",
    privateNotes: "",
    reference: "",
    type: "طرد عادي",
    status: "ready",
    courierName: "بانتظار تعيين المندوب",
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  const premiumCreated = await call(worker, database, "database", {
    method: "PUT",
    cookie,
    payload: {
      revision: premiumMerchant.body.revision,
      database: {
        ...premiumMerchant.body.database,
        orders: [premiumOversize, ...premiumMerchant.body.database.orders],
        nextOrder: premiumMerchant.body.database.nextOrder + 1,
      },
    },
  });
  assert.equal(premiumCreated.status, 200);
  const savedPremium = premiumCreated.body.database.orders.find((order) => order.id === premiumOversize.id);
  assert.equal(savedPremium.deliveryFee, 78);
  assert.equal(savedPremium.weightFee, 20);
  assert.equal(savedPremium.oversizeFee, 28);
});

test("persists diamond membership and enforces its 15/25/55 regional prices on the server", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const issuedCodes = await reserveCodes(worker, database, 3);
  const registration = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر ماسي", "diamond@example.test", "0599988776"),
  });
  assert.equal(registration.status, 201);
  const merchantCookie = sessionFrom(registration);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const diamondUpgrade = await call(worker, database, "database", {
    method: "PUT",
    cookie: sessionFrom(administrator),
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        users: administrator.body.database.users.map((account) => account.id === registration.body.userId
          ? { ...account, membership: "diamond" }
          : account),
      },
    },
  });
  assert.equal(diamondUpgrade.status, 200);
  assert.equal(
    diamondUpgrade.body.database.users.find((account) => account.id === registration.body.userId).membership,
    "diamond",
  );

  const merchant = await call(worker, database, "database", { cookie: merchantCookie });
  assert.equal(merchant.body.database.users[0].membership, "diamond");
  const destinations = [
    { id: "diamond-west-bank", governorate: "الخليل", city: "الخليل", expectedFee: 15 },
    { id: "diamond-jerusalem", governorate: "القدس", city: "القدس", expectedFee: 25 },
    { id: "diamond-interior", governorate: "الداخل", city: "حيفا", expectedFee: 55 },
  ];
  const now = new Date().toISOString();
  const orders = destinations.map((destination, index) => ({
    id: destination.id,
    trackingNumber: issuedCodes[index],
    merchantId: registration.body.userId,
    merchantName: "قيمة غير موثوقة",
    merchantStore: "قيمة غير موثوقة",
    recipientName: `مستلم ماسي ${index + 1}`,
    recipientPhone: "0597654321",
    governorate: destination.governorate,
    city: destination.city,
    address: "عنوان الاختبار",
    pickupAddress: "الخليل",
    amount: 100,
    deliveryFee: 999,
    content: "اختبار السعر الماسي",
    weight: "0 - 5 كغم",
    dimensions: "20 × 20 × 20 سم",
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    weightFee: 999,
    oversizeFee: 999,
    notes: "",
    privateNotes: "",
    reference: "",
    type: "طرد عادي",
    status: "ready",
    courierName: "بانتظار تعيين المندوب",
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }));

  const created = await call(worker, database, "database", {
    method: "PUT",
    cookie: merchantCookie,
    payload: {
      revision: merchant.body.revision,
      database: {
        ...merchant.body.database,
        orders: [...orders, ...merchant.body.database.orders],
        nextOrder: merchant.body.database.nextOrder + orders.length,
      },
    },
  });
  assert.equal(created.status, 200);
  for (const destination of destinations) {
    const saved = created.body.database.orders.find((order) => order.id === destination.id);
    assert.equal(saved.deliveryFee, destination.expectedFee);
    assert.equal(saved.weightFee, 0);
    assert.equal(saved.oversizeFee, 0);
  }
});

test("recalculates return fees on the server for standard, premium, and diamond invoices", async () => {
  const worker = await loadWorker();
  const memberships = [
    { membership: "standard", email: "returns-standard@example.test", phone: "0594400011", expected: 100, fees: [20, 30, 50] },
    { membership: "premium", email: "returns-premium@example.test", phone: "0594400022", expected: 80, fees: [15, 25, 40] },
    { membership: "diamond", email: "returns-diamond@example.test", phone: "0594400033", expected: 50, fees: [10, 15, 25] },
  ];
  const destinations = [
    { governorate: "الخليل", city: "الخليل" },
    { governorate: "القدس", city: "القدس" },
    { governorate: "الداخل", city: "حيفا" },
  ];

  for (const [membershipIndex, pricing] of memberships.entries()) {
    const database = new FakeD1Database();
  const issuedCodes = await reserveCodes(worker, database, 3);
    const registration = await call(worker, database, "register", {
      method: "POST",
      payload: accountPayload(`تاجر رواجع ${pricing.membership}`, pricing.email, pricing.phone),
    });
    assert.equal(registration.status, 201);
    const merchantCookie = sessionFrom(registration);

    const administrator = await call(worker, database, "login", {
      method: "POST",
      payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
    });
    assert.equal(administrator.status, 200);
    const adminCookie = sessionFrom(administrator);
    const membershipUpdate = await call(worker, database, "database", {
      method: "PUT",
      cookie: adminCookie,
      payload: {
        revision: administrator.body.revision,
        database: {
          ...administrator.body.database,
          users: administrator.body.database.users.map((account) => account.id === registration.body.userId
            ? { ...account, membership: pricing.membership }
            : account),
        },
      },
    });
    assert.equal(membershipUpdate.status, 200);

    const merchant = await call(worker, database, "database", { cookie: merchantCookie });
    const now = new Date().toISOString();
    const orderIds = destinations.map((_, index) => `return-${membershipIndex}-${index}`);
    const candidates = destinations.map((destination, index) => ({
      id: orderIds[index],
      trackingNumber: issuedCodes[index],
      merchantId: registration.body.userId,
      merchantName: "قيمة غير موثوقة",
      merchantStore: "قيمة غير موثوقة",
      recipientName: `مستلم راجع ${index + 1}`,
      recipientPhone: "0597654321",
      governorate: destination.governorate,
      city: destination.city,
      address: "عنوان اختبار الرواجع",
      pickupAddress: "الخليل",
      amount: 100,
      deliveryFee: 999,
      content: "اختبار رسوم الرواجع",
      weight: "0 - 5 كغم",
      dimensions: "20 × 20 × 20 سم",
      lengthCm: 20,
      widthCm: 20,
      heightCm: 20,
      weightFee: 999,
      oversizeFee: 999,
      notes: "",
      privateNotes: "",
      reference: "",
      type: "طرد عادي",
      status: "returned",
      courierName: "بانتظار تعيين المندوب",
      createdAt: now,
      updatedAt: now,
      deleted: false,
    }));
    const created = await call(worker, database, "database", {
      method: "PUT",
      cookie: merchantCookie,
      payload: {
        revision: merchant.body.revision,
        database: {
          ...merchant.body.database,
          orders: [...candidates, ...merchant.body.database.orders],
          nextOrder: merchant.body.database.nextOrder + candidates.length,
        },
      },
    });
    assert.equal(created.status, 200);

    const adminWithOrders = await call(worker, database, "database", { cookie: adminCookie });
    const returned = await call(worker, database, "database", {
      method: "PUT",
      cookie: adminCookie,
      payload: {
        revision: adminWithOrders.body.revision,
        database: {
          ...adminWithOrders.body.database,
          orders: adminWithOrders.body.database.orders.map((order) => orderIds.includes(order.id)
            ? { ...order, status: "returned", updatedAt: new Date().toISOString() }
            : order),
        },
      },
    });
    assert.equal(returned.status, 200);

    const merchantWithReturns = await call(worker, database, "database", { cookie: merchantCookie });
    const collectionDraft = {
      id: `return-invoice-${membershipIndex}`,
      merchantId: registration.body.userId,
      merchantName: "قيمة غير موثوقة",
      invoiceNumber: "#FORGED",
      orderIds,
      grossAmount: 999,
      deliveryFees: 999,
      returnFees: 999,
      netAmount: 999,
      deliveredCount: 999,
      returnedCount: 999,
      status: "pending",
      verificationCode: "0000",
      authorizedRecipient: "",
      createdAt: now,
      updatedAt: now,
      scheduledAt: now,
    };
    const invoiced = await call(worker, database, "database", {
      method: "PUT",
      cookie: merchantCookie,
      payload: {
        revision: merchantWithReturns.body.revision,
        database: {
          ...merchantWithReturns.body.database,
          collections: [collectionDraft, ...merchantWithReturns.body.database.collections],
          nextCollection: merchantWithReturns.body.database.nextCollection + 1,
        },
      },
    });
    assert.equal(invoiced.status, 200, invoiced.body?.error);
    const invoice = invoiced.body.database.collections.find((entry) => entry.id === collectionDraft.id);
    assert.equal(invoice.returnFees, pricing.expected);
    assert.equal(invoice.netAmount, -pricing.expected);
    assert.equal(invoice.grossAmount, 0);
    assert.equal(invoice.deliveryFees, 0);
    assert.equal(invoice.deliveredCount, 0);
    assert.equal(invoice.returnedCount, 3);
    assert.equal(invoice.returnPricingMembership, pricing.membership);
    assert.equal(invoice.returnPricingVersion, 1);
    assert.deepEqual(invoice.returnFeeDetails.map((item) => item.fee), pricing.fees);

    if (pricing.membership === "diamond") {
      const legacyState = JSON.parse(database.state.payload);
      const legacyInvoice = legacyState.collections.find((entry) => entry.id === collectionDraft.id);
      legacyInvoice.status = "ready";
      legacyInvoice.returnFees = 95;
      legacyInvoice.netAmount = -95;
      delete legacyInvoice.returnFeeDetails;
      delete legacyInvoice.returnPricingMembership;
      delete legacyInvoice.returnPricingVersion;
      database.state.payload = JSON.stringify(legacyState);

      const correctedMerchantView = await call(worker, database, "database", { cookie: merchantCookie });
      const merchantInvoice = correctedMerchantView.body.database.collections.find((entry) => entry.id === collectionDraft.id);
      assert.equal(merchantInvoice.returnFees, 50);
      assert.equal(merchantInvoice.netAmount, -50);
      assert.deepEqual(merchantInvoice.returnFeeDetails.map((item) => item.fee), [10, 15, 25]);

      const correctedAdminView = await call(worker, database, "database", { cookie: adminCookie });
      const adminInvoice = correctedAdminView.body.database.collections.find((entry) => entry.id === collectionDraft.id);
      assert.equal(adminInvoice.returnFees, merchantInvoice.returnFees);
      assert.equal(adminInvoice.netAmount, merchantInvoice.netAmount);
      assert.deepEqual(adminInvoice.returnFeeDetails, merchantInvoice.returnFeeDetails);
    }
  }
});

test("stores the app-lock PIN only as a server hash and gates device biometrics behind it", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const registration = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر القفل", "app-lock@example.test", "0593344556"),
  });
  assert.equal(registration.status, 201);
  const cookie = sessionFrom(registration);

  const initialStatus = await call(worker, database, "security/status", { cookie });
  assert.deepEqual(initialStatus.body, { enabled: false, biometricEnabled: false, biometricLoginReady: false });

  const invalidPin = await call(worker, database, "security/pin", { method: "POST", cookie, payload: { pin: "12" } });
  assert.equal(invalidPin.status, 400);

  const enabled = await call(worker, database, "security/pin", { method: "POST", cookie, payload: { pin: "١٢٣٤" } });
  assert.equal(enabled.status, 200);
  assert.deepEqual(enabled.body, { enabled: true, biometricEnabled: false, biometricLoginReady: false });
  const storedLock = database.appLocks.get(registration.body.userId);
  assert.ok(storedLock.pin_hash.startsWith("pbkdf2:"));
  assert.ok(!storedLock.pin_hash.includes("1234"));
  assert.ok(!database.state.payload.includes('"pin":"1234"'));

  const rejected = await call(worker, database, "security/pin/verify", { method: "POST", cookie, payload: { pin: "0000" } });
  assert.equal(rejected.status, 403);
  const verified = await call(worker, database, "security/pin/verify", { method: "POST", cookie, payload: { pin: "1234" } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);

  const registrationWithoutPin = await call(worker, database, "security/webauthn/register/options", { method: "POST", cookie, payload: {} });
  assert.equal(registrationWithoutPin.status, 400);
  const registrationOptions = await call(worker, database, "security/webauthn/register/options", { method: "POST", cookie, payload: { pin: "1234" } });
  assert.equal(registrationOptions.status, 200);
  assert.equal(registrationOptions.body.rp.id, "almadina.test");
  assert.equal(registrationOptions.body.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(registrationOptions.body.authenticatorSelection.residentKey, "required");
  assert.equal(registrationOptions.body.authenticatorSelection.requireResidentKey, true);
  assert.equal(registrationOptions.body.authenticatorSelection.userVerification, "required");
  assert.equal(database.challenges.size, 1);

  const disabled = await call(worker, database, "security/disable", { method: "POST", cookie, payload: { pin: "1234" } });
  assert.equal(disabled.status, 200);
  assert.deepEqual(disabled.body, { enabled: false, biometricEnabled: false, biometricLoginReady: false });
  assert.equal(database.appLocks.size, 0);
  assert.equal(database.challenges.size, 0);
});

test("issues an anonymous discoverable-passkey challenge and consumes it only once", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

  const options = await call(worker, database, "passkey/login/options", { method: "POST", payload: {} });
  assert.equal(options.status, 200);
  assert.deepEqual(options.body.allowCredentials, []);
  assert.equal(options.body.userVerification, "required");
  const setCookie = options.headers.get("set-cookie");
  assert.ok(setCookie?.includes("almadina_passkey_login="));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const ceremonyCookie = setCookie.split(";")[0];
  assert.equal(database.challenges.size, 1);

  const rejected = await call(worker, database, "passkey/login/verify", {
    method: "POST",
    cookie: ceremonyCookie,
    payload: { id: "unknown-credential" },
  });
  assert.equal(rejected.status, 401);
  assert.equal(database.challenges.size, 0);

  const replayed = await call(worker, database, "passkey/login/verify", {
    method: "POST",
    cookie: ceremonyCookie,
    payload: { id: "unknown-credential" },
  });
  assert.equal(replayed.status, 401);
  assert.equal(replayed.body.error, rejected.body.error);

  for (let attempt = 1; attempt < 60; attempt += 1) {
    const allowed = await call(worker, database, "passkey/login/options", { method: "POST", payload: {} });
    assert.equal(allowed.status, 200);
  }
  const limited = await call(worker, database, "passkey/login/options", { method: "POST", payload: {} });
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /محاولات كثيرة/);
  assert.equal(database.rateLimits.size, 2);

  const otherAddress = await call(worker, database, "passkey/login/options", {
    method: "POST",
    payload: {},
    headers: { "x-forwarded-for": "203.0.113.20", "cf-connecting-ip": "198.51.100.1" },
  });
  // Unauthenticated forwarding headers no longer create fresh rate buckets.
  assert.equal(otherAddress.status, 429);
  const spoofedCloudflareHeader = await call(worker, database, "passkey/login/options", {
    method: "POST",
    payload: {},
    headers: { "x-forwarded-for": "203.0.113.20", "cf-connecting-ip": "198.51.100.99" },
  });
  assert.equal(spoofedCloudflareHeader.status, 429);
  assert.equal(database.rateLimits.size, 2);
  for (const [keyHash, rateLimit] of database.rateLimits) {
    assert.match(keyHash, /^[a-f0-9]{64}$/);
    assert.match(rateLimit.action, /^passkey-login-(options|verify)$/);
  }
});

test("deletes only the authenticated eligible account and preserves every other hosted record", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const issuedCodes = await reserveCodes(worker, database, 2);

  const merchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("صاحب الحساب المحذوف", "delete-me@example.test", "0591111111"),
  });
  assert.equal(merchant.status, 201);
  const merchantCookie = sessionFrom(merchant);
  const merchantSecondDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "delete-me@example.test", password: "Customer@123" },
  });
  assert.equal(merchantSecondDevice.status, 200);
  const merchantSecondCookie = sessionFrom(merchantSecondDevice);

  const otherMerchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("الحساب المحفوظ", "keep-me@example.test", "0592222222"),
  });
  assert.equal(otherMerchant.status, 201);
  const otherMerchantCookie = sessionFrom(otherMerchant);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);

  const anonymousDeletion = await call(worker, database, "account/delete", {
    method: "POST",
    payload: { password: "Customer@123", confirmation: "حذف حسابي" },
  });
  assert.equal(anonymousDeletion.status, 401);

  const administratorDeletion = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: adminCookie,
    payload: { password: TEST_ADMIN_PASSWORD, confirmation: "حذف حسابي" },
  });
  assert.equal(administratorDeletion.status, 403);

  const now = new Date().toISOString();
  const ownedOrder = {
    id: "order-account-deletion",
    trackingNumber: issuedCodes[0],
    merchantId: merchant.body.userId,
    merchantName: "صاحب الحساب المحذوف",
    merchantStore: "متجر صاحب الحساب المحذوف",
    recipientName: "مستلم الحذف",
    recipientPhone: "0593333333",
    governorate: "الخليل",
    city: "الخليل",
    address: "عنوان الاختبار",
    pickupAddress: "عنوان الاستلام",
    amount: 180,
    deliveryFee: 25,
    content: "طرد اختبار",
    weight: "0 - 5 كغم",
    dimensions: "20 × 20 × 20 سم",
    notes: "",
    privateNotes: "",
    reference: "",
    type: "طرد عادي",
    status: "ready",
    courierName: "بانتظار تعيين المندوب",
    trackingEvents: [],
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  const ownedCollection = {
    id: "collection-account-deletion",
    merchantId: merchant.body.userId,
    merchantName: "صاحب الحساب المحذوف",
    invoiceNumber: "#DELETE-1",
    orderIds: [ownedOrder.id],
    grossAmount: 180,
    deliveryFees: 25,
    returnFees: 0,
    netAmount: 155,
    deliveredCount: 1,
    returnedCount: 0,
    status: "pending",
    verificationCode: "1234",
    authorizedRecipient: "",
    createdAt: now,
    updatedAt: now,
    scheduledAt: now,
  };
  const prepared = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        orders: [ownedOrder],
        recipients: [{ id: "recipient-account-deletion", merchantId: merchant.body.userId, name: "مستلم الحذف", phone: "0593333333", city: "الخليل", address: "عنوان الاختبار", favorite: true }],
        collections: [ownedCollection],
        notices: [
          { id: "notice-account-deletion", userId: merchant.body.userId, title: "إشعار خاص", message: "يجب حذف هذا الإشعار فقط.", icon: "bell", read: false, createdAt: now, orderId: ownedOrder.id },
          { id: "notice-admin-account-deletion", userId: administrator.body.userId, title: "ملاحظة عن طرد الحساب", message: "يجب حذف الإشعار المرتبط بالطرد من حساب المسؤول أيضًا.", icon: "bell", read: false, createdAt: now, orderId: ownedOrder.id },
        ],
        preferences: { ...administrator.body.database.preferences, [merchant.body.userId]: { theme: "dark", notifications: true, sounds: false, orderUpdates: true, biometric: false, pin: "", rating: 0, compact: false } },
      },
    },
  });
  assert.equal(prepared.status, 200);

  const blockedByOperations = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: merchantCookie,
    payload: { password: "Customer@123", confirmation: "حذف حسابي" },
  });
  assert.equal(blockedByOperations.status, 409);
  assert.equal(blockedByOperations.body.activeOrderCount, 1);
  assert.equal(blockedByOperations.body.unsettledCollectionCount, 1);

  const readyForDelivery = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: prepared.body.revision,
      database: {
        ...prepared.body.database,
        orders: prepared.body.database.orders.map((order) => order.id === ownedOrder.id ? { ...order, status: "delivered", updatedAt: now } : order),
        collections: prepared.body.database.collections.map((invoice) => invoice.id === ownedCollection.id ? { ...invoice, status: "ready", updatedAt: now } : invoice),
      },
    },
  });
  assert.equal(readyForDelivery.status, 200);

  const settled = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: adminCookie,
    payload: { invoiceId: ownedCollection.id, verificationCode: ownedCollection.verificationCode },
  });
  assert.equal(settled.status, 200);
  const settledInvoice = settled.body.database.collections.find((invoice) => invoice.id === ownedCollection.id);
  assert.equal(settledInvoice.status, "paid");
  assert.match(settledInvoice.paidAt, /^\d{4}-\d{2}-\d{2}T/);

  const wrongConfirmation = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: merchantCookie,
    payload: { password: "Customer@123", confirmation: "حذف الحساب" },
  });
  assert.equal(wrongConfirmation.status, 400);

  const wrongPassword = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: merchantCookie,
    payload: { password: "WrongPassword", confirmation: "حذف حسابي" },
  });
  assert.equal(wrongPassword.status, 403);

  const deleted = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: merchantCookie,
    payload: { password: "Customer@123", confirmation: "حذف حسابي" },
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.success, true);
  assert.equal(database.followupRevoked.has(merchant.body.userId), true);
  assert.equal(database.followupRevoked.has(otherMerchant.body.userId), false);
  assert.match(deleted.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal([...database.sessions.values()].some((session) => session.user_id === merchant.body.userId), false);
  assert.equal([...database.sessionDevices.values()].some((device) => device.user_id === merchant.body.userId), false);

  const deletedAccountSecondSession = await call(worker, database, "database", { cookie: merchantSecondCookie });
  assert.equal(deletedAccountSecondSession.status, 401);
  const preservedMerchantSession = await call(worker, database, "database", { cookie: otherMerchantCookie });
  assert.equal(preservedMerchantSession.status, 200);
  assert.equal(preservedMerchantSession.body.userId, otherMerchant.body.userId);

  const afterDeletion = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(afterDeletion.status, 200);
  assert.equal(afterDeletion.body.database.users.some((account) => account.id === merchant.body.userId), false);
  assert.equal(afterDeletion.body.database.users.some((account) => account.id === otherMerchant.body.userId), true);
  assert.equal(afterDeletion.body.database.orders.some((order) => order.merchantId === merchant.body.userId), false);
  assert.equal(afterDeletion.body.database.recipients.some((recipient) => recipient.merchantId === merchant.body.userId), false);
  assert.equal(afterDeletion.body.database.collections.some((invoice) => invoice.merchantId === merchant.body.userId), false);
  assert.equal(afterDeletion.body.database.notices.some((notice) => notice.userId === merchant.body.userId), false);
  assert.equal(afterDeletion.body.database.notices.some((notice) => notice.orderId === ownedOrder.id), false);
  assert.equal(Object.hasOwn(afterDeletion.body.database.preferences, merchant.body.userId), false);

  const courier = {
    id: "courier-delete-account",
    name: "مندوب سيحذف حسابه",
    email: "delete-courier@example.test",
    phone: "0564444444",
    store: "قسم التوصيل",
    password: "Courier@123",
    role: "courier",
    joinedAt: now,
    avatarColor: "#6655a6",
  };
  const courierOrder = {
    ...ownedOrder,
    id: "order-preserved-after-courier-deletion",
    trackingNumber: issuedCodes[1],
    merchantId: otherMerchant.body.userId,
    merchantName: "الحساب المحفوظ",
    merchantStore: "متجر الحساب المحفوظ",
    status: "shipped",
    courierId: courier.id,
    courierName: courier.name,
    trackingEvents: [{ id: "courier-event", status: "shipped", title: "مشحون", location: "مع المندوب", actor: courier.name, note: "تم الشحن.", createdAt: now }],
  };
  const courierPrepared = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: afterDeletion.body.revision,
      database: {
        ...afterDeletion.body.database,
        users: [...afterDeletion.body.database.users, courier],
        orders: [courierOrder, ...afterDeletion.body.database.orders],
      },
    },
  });
  assert.equal(courierPrepared.status, 200);

  const courierLogin = await call(worker, database, "login", {
    method: "POST",
    payload: { email: courier.email, password: "Courier@123" },
  });
  assert.equal(courierLogin.status, 200);
  const courierCookie = sessionFrom(courierLogin);

  const blockedCourier = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: courierCookie,
    payload: { password: "Courier@123", confirmation: "حذف حسابي" },
  });
  assert.equal(blockedCourier.status, 409);
  assert.equal(blockedCourier.body.activeOrderCount, 1);

  const completedCourierOrder = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: courierPrepared.body.revision,
      database: {
        ...courierPrepared.body.database,
        orders: courierPrepared.body.database.orders.map((order) => order.id === courierOrder.id ? { ...order, status: "delivered", updatedAt: now } : order),
      },
    },
  });
  assert.equal(completedCourierOrder.status, 200);

  const deletedCourier = await call(worker, database, "account/delete", {
    method: "POST",
    cookie: courierCookie,
    payload: { password: "Courier@123", confirmation: "حذف حسابي" },
  });
  assert.equal(deletedCourier.status, 200);
  assert.equal(database.followupRevoked.has(courier.id), true);

  const afterCourierDeletion = await call(worker, database, "database", { cookie: adminCookie });
  const preservedOrder = afterCourierDeletion.body.database.orders.find((order) => order.id === courierOrder.id);
  assert.ok(preservedOrder);
  assert.equal(preservedOrder.merchantId, otherMerchant.body.userId);
  assert.equal(preservedOrder.courierId, undefined);
  assert.equal(preservedOrder.courierName, "مندوب سابق");
  assert.equal(preservedOrder.trackingEvents[0].actor, "مندوب سابق");

  const recreatedMerchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("حساب جديد بنفس البيانات", "delete-me@example.test", "0591111111"),
  });
  assert.equal(recreatedMerchant.status, 201);
  assert.notEqual(recreatedMerchant.body.userId, merchant.body.userId);
  assert.equal(database.followupRevoked.has(recreatedMerchant.body.userId), false);
  assert.equal(recreatedMerchant.body.database.users.length, 1);
  assert.equal(recreatedMerchant.body.database.users[0].email, "delete-me@example.test");
  assert.equal(recreatedMerchant.body.database.users[0].phone, "0591111111");
  assert.equal(recreatedMerchant.body.database.orders.length, 0);
  assert.equal(recreatedMerchant.body.database.recipients.length, 0);
  assert.equal(recreatedMerchant.body.database.collections.length, 0);
  assert.equal(recreatedMerchant.body.database.notices.length, 0);
  assert.equal(database.registrationRequests.size, 0);
  assert.equal(database.registrationLocations.size, 0);
});

test("lists linked device names per account and revokes only a selected non-current session", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const iphoneAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const windowsAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36";
  const androidAgent = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36";

  const firstDevice = await call(worker, database, "register", {
    method: "POST",
    headers: { "User-Agent": iphoneAgent },
    payload: accountPayload("صاحب الأجهزة", "devices@example.test", "0593333333"),
  });
  assert.equal(firstDevice.status, 201);
  const firstCookie = sessionFrom(firstDevice);

  const secondDevice = await call(worker, database, "login", {
    method: "POST",
    headers: { "User-Agent": windowsAgent },
    payload: { email: "devices@example.test", password: "Customer@123" },
  });
  assert.equal(secondDevice.status, 200);
  const secondCookie = sessionFrom(secondDevice);

  const unrelated = await call(worker, database, "register", {
    method: "POST",
    headers: { "User-Agent": androidAgent },
    payload: accountPayload("حساب الأجهزة الآخر", "devices-other@example.test", "0594444444"),
  });
  assert.equal(unrelated.status, 201);
  const unrelatedCookie = sessionFrom(unrelated);
  database.sessions.set("expired-device-session", {
    token_hash: "expired-device-session",
    user_id: firstDevice.body.userId,
    expires_at: Math.floor(Date.now() / 1000) - 1,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  });
  database.sessionDevices.set("expired-device-session", {
    token_hash: "expired-device-session",
    user_id: firstDevice.body.userId,
    device_name: "Firefox على Linux",
    device_type: "desktop",
    browser_name: "Firefox",
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    last_active_at: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const initialRevision = database.state.revision;
  const initialPayload = database.state.payload;

  assert.equal((await call(worker, database, "security/devices")).status, 401);

  const firstList = await call(worker, database, "security/devices", {
    cookie: firstCookie,
    headers: { "User-Agent": iphoneAgent },
  });
  assert.equal(firstList.status, 200);
  assert.equal(firstList.body.count, 2);
  assert.equal(firstList.body.devices.length, 2);
  assert.equal(firstList.body.devices.filter((device) => device.current).length, 1);
  assert.ok(firstList.body.devices.some((device) => device.name === "Safari على iPhone" && device.current));
  assert.ok(firstList.body.devices.some((device) => device.name === "Chrome على Windows" && !device.current));
  assert.ok(firstList.body.devices.every((device) => /^[\da-f]{64}$/.test(device.id)));
  assert.ok(firstList.body.devices.every((device) => !Object.hasOwn(device, "token_hash")));
  assert.doesNotMatch(JSON.stringify(firstList.body), /Mozilla\/5\.0|Pixel 9/);

  const unrelatedList = await call(worker, database, "security/devices", {
    cookie: unrelatedCookie,
    headers: { "User-Agent": androidAgent },
  });
  assert.equal(unrelatedList.status, 200);
  assert.equal(unrelatedList.body.count, 1);
  assert.equal(unrelatedList.body.devices[0].name, "Chrome على هاتف Android");

  const currentDevice = firstList.body.devices.find((device) => device.current);
  const removableDevice = firstList.body.devices.find((device) => !device.current);
  assert.ok(currentDevice);
  assert.ok(removableDevice);

  const currentRejected = await call(worker, database, "security/devices/revoke", {
    method: "POST",
    cookie: firstCookie,
    origin: "http://almadina.test",
    headers: { "User-Agent": iphoneAgent },
    payload: { deviceId: currentDevice.id },
  });
  assert.equal(currentRejected.status, 409);

  const malformedRejected = await call(worker, database, "security/devices/revoke", {
    method: "POST",
    cookie: firstCookie,
    origin: "http://almadina.test",
    headers: { "User-Agent": iphoneAgent },
    payload: { deviceId: "not-a-device-id" },
  });
  assert.equal(malformedRejected.status, 400);

  const crossAccountRejected = await call(worker, database, "security/devices/revoke", {
    method: "POST",
    cookie: unrelatedCookie,
    origin: "http://almadina.test",
    headers: { "User-Agent": androidAgent },
    payload: { deviceId: removableDevice.id },
  });
  assert.equal(crossAccountRejected.status, 404);

  const forgedOrigin = await call(worker, database, "security/devices/revoke", {
    method: "POST",
    cookie: firstCookie,
    origin: "https://attacker.example",
    headers: { "User-Agent": iphoneAgent },
    payload: { deviceId: removableDevice.id },
  });
  assert.equal(forgedOrigin.status, 403);

  const revoked = await call(worker, database, "security/devices/revoke", {
    method: "POST",
    cookie: firstCookie,
    origin: "http://almadina.test",
    headers: { "User-Agent": iphoneAgent },
    payload: { deviceId: removableDevice.id },
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.success, true);
  assert.equal(revoked.body.count, 1);
  assert.equal(revoked.body.devices[0].current, true);
  assert.equal((await call(worker, database, "database", { cookie: secondCookie, headers: { "User-Agent": windowsAgent } })).status, 401);
  assert.equal((await call(worker, database, "database", { cookie: firstCookie, headers: { "User-Agent": iphoneAgent } })).status, 200);
  assert.equal((await call(worker, database, "database", { cookie: unrelatedCookie, headers: { "User-Agent": androidAgent } })).status, 200);
  assert.equal(database.state.revision, initialRevision);
  assert.equal(database.state.payload, initialPayload);
});

test("changes only the authenticated account password and optionally revokes every session and biometric credential", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

  const target = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("صاحب كلمة المرور", "password-owner@example.test", "0595555555"),
  });
  assert.equal(target.status, 201);
  const firstCookie = sessionFrom(target);

  const secondDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "password-owner@example.test", password: "Customer@123" },
  });
  assert.equal(secondDevice.status, 200);
  const secondCookie = sessionFrom(secondDevice);

  const unrelated = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("حساب غير مستهدف", "password-keep@example.test", "0596666666"),
  });
  assert.equal(unrelated.status, 201);
  const unrelatedCookie = sessionFrom(unrelated);
  const targetId = target.body.userId;
  const unrelatedId = unrelated.body.userId;

  database.appLocks.set(targetId, {
    user_id: targetId,
    pin_hash: "pbkdf2:test",
    enabled: 1,
    biometric_enabled: 1,
    failed_attempts: 0,
    locked_until: 0,
  });
  database.credentials.set("credential-target", { credential_id: "credential-target", user_id: targetId });
  database.passkeyLoginCredentials.set("credential-target", { credential_id: "credential-target", user_id: targetId });
  database.challenges.set("target:registration", { user_id: targetId });
  database.credentials.set("credential-unrelated", { credential_id: "credential-unrelated", user_id: unrelatedId });
  database.passkeyLoginCredentials.set("credential-unrelated", { credential_id: "credential-unrelated", user_id: unrelatedId });
  database.challenges.set("unrelated:registration", { user_id: unrelatedId });

  const anonymous = await call(worker, database, "account/password", {
    method: "POST",
    payload: {
      currentPassword: "Customer@123",
      newPassword: "كلمةNew!123",
      confirmPassword: "كلمةNew!123",
      signOutAllDevices: false,
    },
  });
  assert.equal(anonymous.status, 401);

  const forgedOrigin = await call(worker, database, "account/password", {
    method: "POST",
    cookie: firstCookie,
    origin: "https://attacker.example",
    payload: {
      currentPassword: "Customer@123",
      newPassword: "كلمةNew!123",
      confirmPassword: "كلمةNew!123",
      signOutAllDevices: false,
    },
  });
  assert.equal(forgedOrigin.status, 403);

  const initialRevision = database.state.revision;
  const initialState = JSON.parse(database.state.payload);
  const initialTarget = structuredClone(initialState.users.find((account) => account.id === targetId));
  const initialUnrelated = structuredClone(initialState.users.find((account) => account.id === unrelatedId));

  const mismatch = await call(worker, database, "account/password", {
    method: "POST",
    cookie: firstCookie,
    payload: {
      currentPassword: "Customer@123",
      newPassword: "كلمةNew!123",
      confirmPassword: "مختلفةNew!123",
      signOutAllDevices: false,
    },
  });
  assert.equal(mismatch.status, 400);

  const weak = await call(worker, database, "account/password", {
    method: "POST",
    cookie: firstCookie,
    payload: {
      currentPassword: "Customer@123",
      newPassword: "abcdefgh",
      confirmPassword: "abcdefgh",
      signOutAllDevices: false,
    },
  });
  assert.equal(weak.status, 400);

  const wrongCurrent = await call(worker, database, "account/password", {
    method: "POST",
    cookie: firstCookie,
    payload: {
      currentPassword: "Wrong@123",
      newPassword: "كلمةNew!123",
      confirmPassword: "كلمةNew!123",
      signOutAllDevices: false,
    },
  });
  assert.equal(wrongCurrent.status, 403);
  assert.equal(database.state.revision, initialRevision);
  assert.equal(JSON.parse(database.state.payload).users.find((account) => account.id === targetId).password, initialTarget.password);

  const changedWithoutRevocation = await call(worker, database, "account/password", {
    method: "POST",
    cookie: firstCookie,
    payload: {
      currentPassword: "Customer@123",
      newPassword: "كلمةNew!123",
      confirmPassword: "كلمةNew!123",
      signOutAllDevices: false,
      userId: unrelatedId,
    },
  });
  assert.equal(changedWithoutRevocation.status, 200);
  assert.equal(changedWithoutRevocation.body.success, true);
  assert.equal(changedWithoutRevocation.body.signedOut, false);
  assert.equal(changedWithoutRevocation.body.userId, targetId);
  assert.equal(changedWithoutRevocation.body.database.users[0].password, "");
  const rotatedCookie = sessionFrom(changedWithoutRevocation);
  assert.notEqual(rotatedCookie, firstCookie);
  assert.equal(database.state.revision, initialRevision + 1);

  const stateAfterFirstChange = JSON.parse(database.state.payload);
  const savedTarget = stateAfterFirstChange.users.find((account) => account.id === targetId);
  const savedUnrelated = stateAfterFirstChange.users.find((account) => account.id === unrelatedId);
  assert.match(savedTarget.password, /^pbkdf2:600000:/);
  assert.ok(!savedTarget.password.includes("كلمةNew!123"));
  assert.deepEqual({ ...savedTarget, password: initialTarget.password }, initialTarget);
  assert.deepEqual(savedUnrelated, initialUnrelated);
  assert.equal((await call(worker, database, "database", { cookie: firstCookie })).status, 401);
  assert.equal((await call(worker, database, "database", { cookie: rotatedCookie })).status, 200);
  assert.equal((await call(worker, database, "database", { cookie: secondCookie })).status, 200);
  assert.equal(database.credentials.has("credential-target"), true);
  assert.equal(database.passkeyLoginCredentials.has("credential-target"), true);
  assert.equal(database.challenges.has("target:registration"), true);
  assert.equal(database.appLocks.get(targetId).biometric_enabled, 1);

  const oldPasswordLogin = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "password-owner@example.test", password: "Customer@123" },
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "password-owner@example.test", password: "كلمةNew!123" },
  });
  assert.equal(newPasswordLogin.status, 200);
  assert.equal(newPasswordLogin.body.database.users[0].password, "");
  const newPasswordCookie = sessionFrom(newPasswordLogin);

  const changedEverywhere = await call(worker, database, "account/password", {
    method: "POST",
    cookie: newPasswordCookie,
    payload: {
      currentPassword: "كلمةNew!123",
      newPassword: "أمانFinal!456",
      confirmPassword: "أمانFinal!456",
      signOutAllDevices: true,
    },
  });
  assert.equal(changedEverywhere.status, 200);
  assert.deepEqual(changedEverywhere.body, { success: true, signedOut: true });
  const clearedCookies = changedEverywhere.headers.get("set-cookie") ?? "";
  assert.match(clearedCookies, /almadina_session=/);
  assert.match(clearedCookies, /almadina_passkey_login=/);
  assert.match(clearedCookies, /Max-Age=0/);
  assert.equal(database.state.revision, initialRevision + 2);
  assert.equal([...database.sessions.values()].some((session) => session.user_id === targetId), false);
  assert.equal([...database.sessionDevices.values()].some((device) => device.user_id === targetId), false);
  assert.equal([...database.sessionDevices.values()].some((device) => device.user_id === unrelatedId), true);
  assert.equal(database.credentials.has("credential-target"), false);
  assert.equal(database.passkeyLoginCredentials.has("credential-target"), false);
  assert.equal(database.challenges.has("target:registration"), false);
  assert.equal(database.appLocks.get(targetId).enabled, 1);
  assert.equal(database.appLocks.get(targetId).biometric_enabled, 0);

  assert.equal(database.credentials.has("credential-unrelated"), true);
  assert.equal(database.passkeyLoginCredentials.has("credential-unrelated"), true);
  assert.equal(database.challenges.has("unrelated:registration"), true);
  assert.equal((await call(worker, database, "database", { cookie: unrelatedCookie })).status, 200);
  assert.equal((await call(worker, database, "database", { cookie: firstCookie })).status, 401);
  assert.equal((await call(worker, database, "database", { cookie: rotatedCookie })).status, 401);
  assert.equal((await call(worker, database, "database", { cookie: secondCookie })).status, 401);
  assert.equal((await call(worker, database, "database", { cookie: newPasswordCookie })).status, 401);

  assert.equal((await call(worker, database, "login", {
    method: "POST",
    payload: { email: "password-owner@example.test", password: "كلمةNew!123" },
  })).status, 401);
  const finalLogin = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "password-owner@example.test", password: "أمانFinal!456" },
  });
  assert.equal(finalLogin.status, 200);
  assert.equal(finalLogin.body.userId, targetId);
});

test("rate limits repeated wrong current-password attempts without changing hosted data", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const registration = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("حساب تحديد المحاولات", "password-rate@example.test", "0597777777"),
  });
  assert.equal(registration.status, 201);
  const cookie = sessionFrom(registration);
  const revision = database.state.revision;
  const passwordHash = JSON.parse(database.state.payload).users.find((account) => account.id === registration.body.userId).password;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const rejected = await call(worker, database, "account/password", {
      method: "POST",
      cookie,
      payload: {
        currentPassword: `Wrong@12${attempt}`,
        newPassword: "قويةNew!123",
        confirmPassword: "قويةNew!123",
        signOutAllDevices: true,
      },
    });
    assert.equal(rejected.status, 403);
  }

  const limited = await call(worker, database, "account/password", {
    method: "POST",
    cookie,
    payload: {
      currentPassword: "Customer@123",
      newPassword: "قويةNew!123",
      confirmPassword: "قويةNew!123",
      signOutAllDevices: true,
    },
  });
  assert.equal(limited.status, 429);
  assert.equal(database.state.revision, revision);
  assert.equal(JSON.parse(database.state.payload).users.find((account) => account.id === registration.body.userId).password, passwordHash);
  assert.equal((await call(worker, database, "database", { cookie })).status, 200);
});

test("resets passwords through the email-only verification flow and consumes every security grant once", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const delivered = [];
  const environment = {
    PASSWORD_RESET_SENDER: async (message) => {
      delivered.push(structuredClone(message));
    },
  };

  const emailAccount = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("حساب استعادة البريد", "recovery-email@example.test", "0597000001"),
  });
  const secondaryAccount = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("حساب استعادة ثانٍ", "recovery-secondary@example.test", "0597000002"),
  });
  assert.equal(emailAccount.status, 201);
  assert.equal(secondaryAccount.status, 201);

  const emailFirstCookie = sessionFrom(emailAccount);
  const secondaryFirstCookie = sessionFrom(secondaryAccount);
  const emailSecond = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "recovery-email@example.test", password: "Customer@123" },
  });
  const secondarySecond = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "recovery-secondary@example.test", password: "Customer@123" },
  });
  assert.equal(emailSecond.status, 200);
  assert.equal(secondarySecond.status, 200);
  const emailSecondCookie = sessionFrom(emailSecond);
  const secondarySecondCookie = sessionFrom(secondarySecond);

  function addSecurityFixtures(userId, suffix) {
    database.appLocks.set(userId, {
      user_id: userId,
      pin_hash: `pbkdf2:${suffix}`,
      enabled: 1,
      biometric_enabled: 1,
      failed_attempts: 0,
      locked_until: 0,
    });
    database.credentials.set(`credential-${suffix}`, { credential_id: `credential-${suffix}`, user_id: userId });
    database.passkeyLoginCredentials.set(`credential-${suffix}`, { credential_id: `credential-${suffix}`, user_id: userId });
    database.challenges.set(`${suffix}:registration`, { user_id: userId, kind: "registration" });
  }

  addSecurityFixtures(emailAccount.body.userId, "recovery-email");
  addSecurityFixtures(secondaryAccount.body.userId, "recovery-secondary");

  const rejectedPhone = await call(worker, database, "password-reset/request", {
    method: "POST",
    payload: { identifier: "0597000002" },
    environment,
  });
  assert.equal(rejectedPhone.status, 400);
  assert.equal(delivered.length, 0);

  const unknown = await call(worker, database, "password-reset/request", {
    method: "POST",
    payload: { identifier: "unknown-recovery@example.test" },
    environment,
  });
  assert.equal(unknown.status, 202);
  assert.equal(unknown.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(unknown.body).sort(), ["expiresIn", "message", "resendAfter", "success"].sort());
  assert.equal(unknown.body.success, true);
  assert.equal(delivered.length, 0);
  assert.equal([...database.passwordResets.values()].filter((reset) => reset.user_id === "").length, 1);

  async function exerciseReset({
    userId,
    email,
    identifier,
    destination,
    newPassword,
    oldCookies,
    preservedCookie,
  }) {
    const revisionBeforeRequest = database.state.revision;
    const deliveryCount = delivered.length;
    const requested = await call(worker, database, "password-reset/request", {
      method: "POST",
      payload: { identifier },
      environment,
    });
    assert.equal(requested.status, 202);
    assert.deepEqual(requested.body, unknown.body);
    assert.equal(requested.headers.get("cache-control"), "no-store");
    assert.equal(database.state.revision, revisionBeforeRequest);
    assert.equal(delivered.length, deliveryCount + 1);

    const message = delivered.at(-1);
    assert.deepEqual(
      { destination: message.destination, expiresInMinutes: message.expiresInMinutes },
      { destination, expiresInMinutes: 10 },
    );
    assert.equal(Object.hasOwn(message, "channel"), false);
    assert.match(message.code, /^\d{6}$/);
    assert.equal(Object.hasOwn(requested.body, "code"), false);
    assert.equal(Object.hasOwn(requested.body, "userId"), false);

    const requestCookie = namedCookieFrom(requested, "almadina_password_reset");
    const requestToken = requestCookie.split("=")[1];
    assert.match(requestToken, /^[\da-f]{64}$/);
    assert.equal(database.passwordResets.has(requestToken), false);
    const resetBeforeVerification = [...database.passwordResets.values()].find((reset) => reset.user_id === userId);
    assert.ok(resetBeforeVerification);
    assert.equal(resetBeforeVerification.channel, "email");
    assert.notEqual(resetBeforeVerification.code_hash, message.code);
    assert.ok(!JSON.stringify(resetBeforeVerification).includes(message.code));

    const wrongCode = message.code === "000000" ? "000001" : "000000";
    const rejectedCode = await call(worker, database, "password-reset/verify", {
      method: "POST",
      cookie: requestCookie,
      payload: { code: wrongCode },
      environment,
    });
    assert.equal(rejectedCode.status, 422);
    assert.match(rejectedCode.body.error, /غير صحيح|انتهت/);
    assert.equal(resetBeforeVerification.failed_attempts, 1);
    assert.equal(database.state.revision, revisionBeforeRequest);

    const verified = await call(worker, database, "password-reset/verify", {
      method: "POST",
      cookie: requestCookie,
      payload: { code: message.code },
      environment,
    });
    assert.equal(verified.status, 200);
    assert.deepEqual(Object.keys(verified.body).sort(), ["expiresIn", "success"].sort());
    assert.equal(verified.body.success, true);
    const resetCookie = namedCookieFrom(verified, "almadina_password_reset");
    const resetToken = resetCookie.split("=")[1];
    const verifiedReset = [...database.passwordResets.values()].find((reset) => reset.user_id === userId);
    assert.ok(verifiedReset);
    assert.equal(verifiedReset.code_hash, "");
    assert.notEqual(verifiedReset.reset_token_hash, resetToken);
    assert.ok(verifiedReset.verified_at);

    const replayedCode = await call(worker, database, "password-reset/verify", {
      method: "POST",
      cookie: requestCookie,
      payload: { code: message.code },
      environment,
    });
    assert.equal(replayedCode.status, 422);

    const revisionBeforeComplete = database.state.revision;
    const completed = await call(worker, database, "password-reset/complete", {
      method: "POST",
      cookie: resetCookie,
      payload: { newPassword, confirmPassword: newPassword },
      environment,
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.success, true);
    assert.equal(completed.body.email, email);
    assert.equal(Object.hasOwn(completed.body, "database"), false);
    assert.equal(database.state.revision, revisionBeforeComplete + 1);
    assert.equal([...database.passwordResets.values()].some((reset) => reset.user_id === userId), false);
    assert.equal([...database.sessions.values()].some((session) => session.user_id === userId), false);
    assert.equal([...database.sessionDevices.values()].some((device) => device.user_id === userId), false);
    assert.equal([...database.credentials.values()].some((credential) => credential.user_id === userId), false);
    assert.equal([...database.passkeyLoginCredentials.values()].some((credential) => credential.user_id === userId), false);
    assert.equal([...database.challenges.values()].some((challenge) => challenge.user_id === userId), false);
    assert.equal(database.appLocks.has(userId), false);

    for (const staleCookie of oldCookies) {
      assert.equal((await call(worker, database, "database", { cookie: staleCookie })).status, 401);
    }
    if (preservedCookie) assert.equal((await call(worker, database, "database", { cookie: preservedCookie })).status, 200);

    assert.equal((await call(worker, database, "login", {
      method: "POST",
      payload: { email, password: "Customer@123" },
    })).status, 401);
    const newLogin = await call(worker, database, "login", {
      method: "POST",
      payload: { email, password: newPassword },
    });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.body.userId, userId);

    const replayedReset = await call(worker, database, "password-reset/complete", {
      method: "POST",
      cookie: resetCookie,
      payload: { newPassword: `${newPassword}x`, confirmPassword: `${newPassword}x` },
      environment,
    });
    assert.equal(replayedReset.status, 422);
    return sessionFrom(newLogin);
  }

  const emailNewCookie = await exerciseReset({
    userId: emailAccount.body.userId,
    email: "recovery-email@example.test",
    identifier: " RECOVERY-EMAIL@EXAMPLE.TEST ",
    destination: "recovery-email@example.test",
    newPassword: "بريدNew!123",
    oldCookies: [emailFirstCookie, emailSecondCookie],
    preservedCookie: secondaryFirstCookie,
  });
  assert.equal(database.credentials.has("credential-recovery-secondary"), true);
  assert.equal(database.passkeyLoginCredentials.has("credential-recovery-secondary"), true);
  assert.equal(database.challenges.has("recovery-secondary:registration"), true);
  assert.equal(database.appLocks.has(secondaryAccount.body.userId), true);

  await exerciseReset({
    userId: secondaryAccount.body.userId,
    email: "recovery-secondary@example.test",
    identifier: "recovery-secondary@example.test",
    destination: "recovery-secondary@example.test",
    newPassword: "ثانيNew!456",
    oldCookies: [secondaryFirstCookie, secondarySecondCookie],
    preservedCookie: emailNewCookie,
  });

  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered.map((message) => message.destination), [
    "recovery-email@example.test",
    "recovery-secondary@example.test",
  ]);

  const deliveryFailureAccount = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("حساب فشل الإرسال", "recovery-delivery-failure@example.test", "0597000003"),
  });
  assert.equal(deliveryFailureAccount.status, 201);
  const previousConsoleError = console.error;
  let failedDelivery;
  try {
    console.error = () => {};
    failedDelivery = await call(worker, database, "password-reset/request", {
      method: "POST",
      payload: { identifier: "recovery-delivery-failure@example.test" },
      environment: { PASSWORD_RESET_SENDER: async () => { throw new Error("simulated delivery failure"); } },
    });
  } finally {
    console.error = previousConsoleError;
  }
  assert.equal(failedDelivery.status, 202);
  assert.deepEqual(failedDelivery.body, unknown.body);
  const invalidatedDelivery = [...database.passwordResets.values()].at(-1);
  assert.ok(invalidatedDelivery);
  assert.equal(invalidatedDelivery.user_id, "");
  assert.equal(invalidatedDelivery.code_hash, "");
  assert.equal(invalidatedDelivery.failed_attempts, 5);
  assert.equal(invalidatedDelivery.reset_token_hash, null);
});

test("saves settings when an untouched legacy recipient has no governorate", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const merchant = await call(worker, database, "register", {
    method: "POST",
    payload: accountPayload("تاجر المستلم القديم", "legacy-recipient@example.test", "0597000011"),
  });
  assert.equal(merchant.status, 201);
  const merchantCookie = sessionFrom(merchant);

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD },
  });
  assert.equal(administrator.status, 200);
  const adminCookie = sessionFrom(administrator);
  const legacyRecipient = {
    id: "recipient-without-governorate",
    merchantId: merchant.body.userId,
    name: "مستلم قديم",
    phone: "0597123456",
    city: "نابلس",
    address: "العنوان القديم",
    favorite: true,
  };

  const seeded = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: administrator.body.revision,
      database: {
        ...administrator.body.database,
        recipients: [legacyRecipient, ...administrator.body.database.recipients],
      },
    },
  });
  assert.equal(seeded.status, 200);

  const synchronized = await call(worker, database, "database", { cookie: merchantCookie });
  assert.equal(synchronized.status, 200);
  assert.deepEqual(synchronized.body.database.recipients, [legacyRecipient]);

  const preferences = {
    ...synchronized.body.database.preferences,
    [merchant.body.userId]: {
      theme: "light",
      notifications: false,
      sounds: true,
      orderUpdates: true,
      biometric: false,
      pin: "",
      rating: 0,
      compact: false,
    },
  };
  const saved = await call(worker, database, "database", {
    method: "PUT",
    cookie: merchantCookie,
    payload: {
      revision: synchronized.body.revision,
      database: { ...synchronized.body.database, preferences },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.database.preferences[merchant.body.userId].notifications, false);
  assert.deepEqual(saved.body.database.recipients, [legacyRecipient]);

  const forgedLegacyChange = await call(worker, database, "database", {
    method: "PUT",
    cookie: merchantCookie,
    payload: {
      revision: saved.body.revision,
      database: {
        ...saved.body.database,
        recipients: saved.body.database.recipients.map((recipient) => ({ ...recipient, city: "مدينة غير مدعومة" })),
      },
    },
  });
  assert.equal(forgedLegacyChange.status, 400);
  assert.match(forgedLegacyChange.body.error, /بيانات المستلم المحفوظ غير صالحة/);
});

test("counts only failed sign-ins while keeping brute-force protection active", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const headers = { "X-Forwarded-For": "203.0.113.25" };
  const validPayload = { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const successful = await call(worker, database, "login", {
      method: "POST",
      payload: validPayload,
      headers,
    });
    assert.equal(successful.status, 200);
  }
  assert.equal([...database.rateLimits.values()].some((entry) => entry.action.startsWith("login-")), false);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rejected = await call(worker, database, "login", {
      method: "POST",
      payload: { ...validPayload, password: "WrongPassword!123" },
      headers,
    });
    assert.equal(rejected.status, 401);
  }

  const blocked = await call(worker, database, "login", {
    method: "POST",
    payload: validPayload,
    headers,
  });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /محاولات تسجيل دخول كثيرة/);
});


function printedParcel(merchantId, id, trackingNumber, extra = {}) {
  return {
    id, trackingNumber, merchantId, merchantName: "متجر", merchantStore: "متجر",
    recipientName: "المستلم", recipientPhone: "0597654321", governorate: "نابلس", city: "نابلس",
    address: "الشارع الرئيسي", pickupAddress: "متجر المرسل", amount: 100, deliveryFee: 999,
    content: "ملابس", weight: "0 - 5 كغم", dimensions: "غير محددة", notes: "", privateNotes: "",
    reference: "", type: "طرد عادي", status: "draft", courierName: "بانتظار تعيين المندوب",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false, ...extra,
  };
}

test("reserves disjoint printable batches atomically and retries the same batch without reallocating", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const codes = await reserveCodes(worker, database, 2);
  const admin = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  const cookie = sessionFrom(admin);
  const post = (payload) => call(worker, database, "parcel-code-batches", { method: "POST", cookie, payload });
  const revision = database.state.revision;
  const retry = await post({ requestId: "fixture-printed-labels", count: 2, label: "رموز الاختبار" });
  assert.equal(retry.status, 200);
  assert.equal(database.state.revision, revision);
  assert.equal((await post({ requestId: "fixture-printed-labels", count: 3, label: "رموز الاختبار" })).status, 409);
  for (const count of [0, 501, 1.5, "50"]) assert.equal((await post({ requestId: "invalid-quantity", count })).status, 400);
  const batches = await Promise.all([post({ requestId: "parallel-batch-one", count: 3 }), post({ requestId: "parallel-batch-two", count: 4 })]);
  batches.forEach((result) => assert.equal(result.status, 201, result.body.error));
  const state = JSON.parse(database.state.payload);
  const all = state.parcelCodeBatches.flatMap((batch) => Array.from({ length: batch.count }, (_, index) => `ALX-${batch.startNumber + index}`));
  assert.equal(all.length, 9);
  assert.equal(new Set(all).size, 9);
  assert.equal(codes[0], "ALX-20200001");
  assert.equal(state.orders.length, 0, "printing labels must not create parcels");
  const merchant = await call(worker, database, "register", { method: "POST", payload: accountPayload("تاجر الأكواد", "codes@example.test", "0591000021") });
  assert.equal(merchant.status, 201);
  assert.equal(merchant.body.database.parcelCodeBatches, undefined);
  assert.equal(merchant.body.database.parcelCodeClaims, undefined);
  assert.equal((await call(worker, database, "parcel-code-batches", { method: "POST", cookie: sessionFrom(merchant), payload: { requestId: "merchant-denied", count: 5 } })).status, 403);
});

test("unassigned parcel notes notify all administrators and cannot be redirected by the merchant", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  await reserveCodes(worker, database, 1);
  const merchant = await call(worker, database, "register", { method: "POST", payload: accountPayload("تاجر ملاحظة", "note-routing@example.test", "0591000092") });
  const cookie = sessionFrom(merchant);
  const created = await call(worker, database, "orders", { method: "POST", cookie, payload: {
    orders: [printedParcel(merchant.body.userId, "unassigned-note-parcel", "")],
  } });
  assert.equal(created.status, 201, created.body.error);
  // Additional recipients are fixtures in the in-memory database only.
  const raw = JSON.parse(database.state.payload);
  const template = raw.users.find((user) => user.role === "admin");
  raw.users.push({ ...template, id: "second-note-admin", email: "second-note-admin@example.test", name: "مسؤول آخر" });
  raw.users.push({ ...template, id: "unassigned-note-courier", role: "courier", email: "unassigned-note-courier@example.test", name: "مندوب آخر" });
  database.state.payload = JSON.stringify(raw);
  const current = await call(worker, database, "database", { cookie });
  const note = "ملاحظة الحالة لطرد دون مندوب";
  const result = await call(worker, database, "database", { method: "PUT", cookie, payload: {
    revision: current.body.revision,
    database: { ...current.body.database, orders: current.body.database.orders.map((order) => ({
      ...order, courierId: "unassigned-note-courier",
      trackingEvents: [...order.trackingEvents, { id: "new-unassigned-note", kind: "note", status: order.status, title: "ملاحظة", location: "مع المرسل", actor: "المرسل", note, createdAt: new Date().toISOString() }],
    })) },
  } });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.database.orders[0].courierId, undefined);
  const notices = JSON.parse(database.state.payload).notices.filter((notice) => notice.message.includes(note));
  assert.deepEqual(notices.map((notice) => notice.userId).sort(), raw.users.filter((user) => user.role === "admin").map((user) => user.id).sort());
  assert.ok(notices.every((notice) => notice.orderId === "unassigned-note-parcel" && !notice.read));
  // Saving the acknowledged snapshot again must not repeat either notification.
  const repeat = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: result.body.revision, database: result.body.database } });
  assert.equal(repeat.status, 200, repeat.body.error);
  assert.equal(JSON.parse(database.state.payload).notices.filter((notice) => notice.message.includes(note)).length, notices.length);
});

test("requires an issued code, normalizes printed digits, and rejects conflicting parcel retries", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const codes = await reserveCodes(worker, database, 3);
  const merchant = await call(worker, database, "register", { method: "POST", payload: accountPayload("تاجر يدوي", "manual@example.test", "0591000022") });
  const cookie = sessionFrom(merchant);
  const post = (orders) => call(worker, database, "orders", { method: "POST", cookie, payload: { orders } });
  for (const code of ["ALX-99999999", "TEMP-123", "invalid"]) {
    assert.equal((await post([printedParcel(merchant.body.userId, "bad-code", code)])).status, 400);
    assert.equal(JSON.parse(database.state.payload).orders.length, 0);
    assert.deepEqual(JSON.parse(database.state.payload).parcelCodeClaims, {});
  }
  const arabicCode = codes[0].slice(4).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
  const order = printedParcel(merchant.body.userId, "manual-code-parcel", ` ${arabicCode} `, { privateNotes: "ملاحظة إلى الإدارة", lengthCm: 61, widthCm: 40, heightCm: 40 });
  const created = await post([order]);
  assert.equal(created.status, 201, created.body.error);
  assert.equal(created.body.database.orders[0].trackingNumber, codes[0]);
  assert.equal(created.body.database.orders[0].oversizeFee, 14);
  assert.equal(created.body.database.orders[0].deliveryFee, 39);
  assert.ok(created.body.database.notices.some((notice) => notice.orderId === order.id && notice.title === "تم إنشاء الطرد"));
  assert.ok(JSON.parse(database.state.payload).notices.some((notice) => notice.title === "ملاحظة خاصة جديدة"));
  const revision = database.state.revision;
  const repeat = await post([{ ...order, trackingNumber: codes[0], createdAt: new Date().toISOString() }]);
  assert.equal(repeat.status, 200, repeat.body.error);
  assert.equal(database.state.revision, revision);
  assert.equal((await post([{ ...order, amount: 120 }])).status, 409);
  assert.equal((await post([printedParcel(merchant.body.userId, "used-code-parcel", codes[0])])).status, 409);
  assert.equal(JSON.parse(database.state.payload).orders.length, 1);
  const duplicateImport = await post([printedParcel(merchant.body.userId, "import-one", codes[1]), printedParcel(merchant.body.userId, "import-two", codes[1])]);
  assert.equal(duplicateImport.status, 409);
  assert.equal(JSON.parse(database.state.payload).parcelCodeClaims[codes[1]], undefined, "failed batch must not partially consume labels");
  assert.equal((await post([printedParcel(merchant.body.userId, "import-three", codes[1])])).status, 201);
});

test("allows only one account to claim a printed code concurrently and preserves claims after permanent removal", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const [code] = await reserveCodes(worker, database, 1);
  const first = await call(worker, database, "register", { method: "POST", payload: accountPayload("متجر أول", "race-one@example.test", "0591000023") });
  const second = await call(worker, database, "register", { method: "POST", payload: accountPayload("متجر ثان", "race-two@example.test", "0591000024") });
  const attempts = await Promise.all([first, second].map((merchant, index) => call(worker, database, "orders", { method: "POST", cookie: sessionFrom(merchant), payload: { orders: [printedParcel(merchant.body.userId, `race-parcel-${index}`, code)] } })));
  assert.deepEqual(attempts.map((entry) => entry.status).sort(), [201, 409]);
  const saved = JSON.parse(database.state.payload);
  assert.equal(saved.orders.length, 1);
  assert.equal(saved.parcelCodeClaims[code].orderId, saved.orders[0].id);
  const admin = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  const adminCookie = sessionFrom(admin);
  const removed = await call(worker, database, "database", { method: "PUT", cookie: adminCookie, payload: { revision: admin.body.revision, database: { ...admin.body.database, orders: [], parcelCodeBatches: [], parcelCodeClaims: {}, nextOrder: 1 } } });
  assert.equal(removed.status, 200, removed.body.error);
  assert.equal(removed.body.database.orders.length, 0);
  assert.equal(removed.body.database.parcelCodeBatches.length, 1);
  assert.equal(removed.body.database.parcelCodeClaims[code].orderId, saved.orders[0].id);
  assert.equal(removed.body.database.nextOrder, saved.nextOrder);
  const reused = await call(worker, database, "orders", { method: "POST", cookie: sessionFrom(first), payload: { orders: [printedParcel(first.body.userId, "after-permanent-delete", code)] } });
  assert.equal(reused.status, 409);
});


test("creates blank parcels and assigns printed codes from details without changing shipment data", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const codes = await reserveCodes(worker, database, 4);
  const merchant = await call(worker, database, "register", { method: "POST", payload: accountPayload("تاجر التفاصيل", "details@example.test", "0591000031") });
  const cookie = sessionFrom(merchant);
  const parcels = [printedParcel(merchant.body.userId, "blank-details-one", ""), printedParcel(merchant.body.userId, "blank-details-two", "")];
  const cursor = JSON.parse(database.state.payload).nextOrder;
  const created = await call(worker, database, "orders", { method: "POST", cookie, payload: { orders: parcels } });
  assert.equal(created.status, 201, created.body.error);
  assert.equal(created.body.database.orders.length, 2);
  assert.ok(created.body.database.orders.every((order) => order.trackingNumber === "" && order.status === "draft"));
  assert.equal(JSON.parse(database.state.payload).nextOrder, cursor);
  assert.deepEqual(JSON.parse(database.state.payload).parcelCodeClaims, {});
  const assign = (orderId, trackingNumber) => call(worker, database, "orders/assign-code", { method: "POST", cookie, payload: { orderId, trackingNumber } });
  for (const code of ["", "   ", "ALX-99999999", "invalid"]) assert.equal((await assign(parcels[0].id, code)).status, 400);
  const before = created.body.database.orders.find((order) => order.id === parcels[0].id);
  const arabicCode = codes[0].slice(4).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
  const assigned = await assign(parcels[0].id, ` ${arabicCode} `);
  assert.equal(assigned.status, 200, assigned.body.error);
  const after = assigned.body.database.orders.find((order) => order.id === parcels[0].id);
  assert.deepEqual({ ...after, trackingNumber: before.trackingNumber, updatedAt: before.updatedAt }, before);
  assert.equal(after.trackingNumber, codes[0]);
  const revision = database.state.revision;
  assert.equal((await assign(parcels[0].id, codes[0])).status, 200);
  assert.equal(database.state.revision, revision, "retry must not mutate state");
  assert.equal((await assign(parcels[0].id, codes[1])).status, 409);
  assert.equal((await assign(parcels[1].id, codes[0])).status, 409);
  const repeatCreation = await call(worker, database, "orders", { method: "POST", cookie, payload: { orders: parcels } });
  assert.equal(repeatCreation.status, 200, repeatCreation.body.error);
  assert.equal(repeatCreation.body.database.orders.find((order) => order.id === parcels[0].id).trackingNumber, codes[0]);
  assert.equal(database.state.revision, revision);
  const stalePut = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision, database: { ...repeatCreation.body.database, orders: created.body.database.orders } } });
  assert.equal(stalePut.status, 200, stalePut.body.error);
  assert.equal(stalePut.body.database.orders.find((order) => order.id === parcels[0].id).trackingNumber, codes[0]);
  assert.equal((await assign("missing-parcel", codes[1])).status, 404);
  assert.equal(JSON.parse(database.state.payload).parcelCodeClaims[codes[1]], undefined);
});

test("only the parcel owner or administrator can attach a code and deleted parcels consume no labels", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const codes = await reserveCodes(worker, database, 3);
  const merchant = await call(worker, database, "register", { method: "POST", payload: accountPayload("صاحب الطرد", "owner-details@example.test", "0591000032") });
  const other = await call(worker, database, "register", { method: "POST", payload: accountPayload("حساب آخر", "other-details@example.test", "0591000033") });
  const cookie = sessionFrom(merchant);
  const created = await call(worker, database, "orders", { method: "POST", cookie, payload: { orders: [printedParcel(merchant.body.userId, "owner-blank-parcel", ""), printedParcel(merchant.body.userId, "deleted-blank-parcel", "")] } });
  assert.equal(created.status, 201);
  const admin = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  const adminCookie = sessionFrom(admin);
  const employee = { id: "courier-code-details", name: "المندوب", email: "courier-details@example.test", phone: "0561000034", store: "الإدارة", password: "Employee@123", role: "courier", joinedAt: new Date().toISOString(), avatarColor: "#187a50" };
  const modified = await call(worker, database, "database", { method: "PUT", cookie: adminCookie, payload: { revision: admin.body.revision, database: { ...admin.body.database, users: [...admin.body.database.users, employee], orders: admin.body.database.orders.map((order) => ({ ...order, deleted: order.id === "deleted-blank-parcel", status: "ready" })) } } });
  assert.equal(modified.status, 200, modified.body.error);
  const courier = await call(worker, database, "login", { method: "POST", payload: { email: employee.email, password: employee.password } });
  const assign = (asCookie, orderId, trackingNumber) => call(worker, database, "orders/assign-code", { method: "POST", cookie: asCookie, payload: { orderId, trackingNumber } });
  assert.equal((await assign(undefined, "owner-blank-parcel", codes[0])).status, 401);
  assert.equal((await assign(sessionFrom(other), "owner-blank-parcel", codes[0])).status, 404);
  assert.equal((await assign(sessionFrom(courier), "owner-blank-parcel", codes[0])).status, 403);
  assert.equal((await assign(cookie, "deleted-blank-parcel", codes[1])).status, 409);
  assert.deepEqual(JSON.parse(database.state.payload).parcelCodeClaims, {});
  const assigned = await assign(adminCookie, "owner-blank-parcel", codes[0]);
  assert.equal(assigned.status, 200, assigned.body.error);
  assert.equal(assigned.body.database.orders.find((order) => order.id === "owner-blank-parcel").status, "ready", "assignment preserves current status");
  assert.equal(JSON.parse(database.state.payload).parcelCodeClaims[codes[1]], undefined);
});

test("concurrent detail assignments never consume the same label twice or consume a losing label", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const codes = await reserveCodes(worker, database, 3);
  const first = await call(worker, database, "register", { method: "POST", payload: accountPayload("أول متزامن", "detail-race-one@example.test", "0591000035") });
  const second = await call(worker, database, "register", { method: "POST", payload: accountPayload("ثان متزامن", "detail-race-two@example.test", "0591000036") });
  const cookies = [sessionFrom(first), sessionFrom(second)];
  for (const [index, merchant] of [first, second].entries()) {
    const created = await call(worker, database, "orders", { method: "POST", cookie: cookies[index], payload: { orders: [printedParcel(merchant.body.userId, `detail-race-${index}`, "")] } });
    assert.equal(created.status, 201);
  }
  const assign = (index, code) => call(worker, database, "orders/assign-code", { method: "POST", cookie: cookies[index], payload: { orderId: `detail-race-${index}`, trackingNumber: code } });
  const race = await Promise.all([assign(0, codes[0]), assign(1, codes[0])]);
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  const loser = race.findIndex((result) => result.status === 409);
  const state = JSON.parse(database.state.payload);
  assert.equal(state.orders.find((order) => order.id === `detail-race-${loser}`).trackingNumber, "");
  assert.equal(Object.keys(state.parcelCodeClaims).length, 1);
  const competingLabels = await Promise.all([assign(loser, codes[1]), assign(loser, codes[2])]);
  assert.deepEqual(competingLabels.map((result) => result.status).sort(), [200, 409]);
  const latest = JSON.parse(database.state.payload);
  assert.equal(Object.keys(latest.parcelCodeClaims).length, 2, "losing label stays unused");
  assert.equal(new Set(latest.orders.map((order) => order.trackingNumber)).size, 2);
});

test("links a QR from an administrator's printed batch to the selected blank parcel", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const [code] = await reserveCodes(worker, database, 1);
  const [{ createQrMatrix }, { BitMatrix }, decoderModule] = await Promise.all([
    import(new URL("../app/lib/qr-code.ts", import.meta.url)),
    import("@zxing/library"),
    import("@zxing/library/cjs/core/qrcode/decoder/Decoder.js"),
  ]);
  const matrix = createQrMatrix(code);
  const bits = new BitMatrix(matrix.length);
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) bits.set(x, y); }));
  const Decoder = decoderModule.default.default ?? decoderModule.default;
  const scanned = new Decoder().decodeBitMatrix(bits).getText();
  const merchant = await call(worker, database, "register", { method: "POST", payload: accountPayload("زبون QR", "camera-label@example.test", "0591000041") });
  const cookie = sessionFrom(merchant);
  const create = await call(worker, database, "orders", { method: "POST", cookie, payload: { orders: [printedParcel(merchant.body.userId, "qr-unselected", ""), printedParcel(merchant.body.userId, "qr-selected", "")] } });
  assert.equal(create.status, 201);
  const result = await call(worker, database, "orders/assign-code", { method: "POST", cookie, payload: { orderId: "qr-selected", trackingNumber: scanned } });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(result.body.database.orders.find((order) => order.id === "qr-selected").trackingNumber, code);
  assert.equal(result.body.database.orders.find((order) => order.id === "qr-unselected").trackingNumber, "");
  const revision = database.state.revision;
  const repeatedFrame = await call(worker, database, "orders/assign-code", { method: "POST", cookie, payload: { orderId: "qr-selected", trackingNumber: scanned } });
  assert.equal(repeatedFrame.status, 200);
  assert.equal(database.state.revision, revision);
  const anotherParcel = await call(worker, database, "orders/assign-code", { method: "POST", cookie, payload: { orderId: "qr-unselected", trackingNumber: scanned } });
  assert.equal(anotherParcel.status, 409);
});

// These integration fixtures use FakeD1Database and never change customer data.
async function trashFixture() {
  const worker = await loadWorker(), database = new FakeD1Database();
  const owner = await call(worker, database, "register", { method: "POST", payload: accountPayload("صاحب السلة", "trash-owner@example.test", "0596633210") });
  const other = await call(worker, database, "register", { method: "POST", payload: accountPayload("حساب آخر", "trash-other@example.test", "0596633211") });
  const admin = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  assert.equal(owner.status, 201); assert.equal(other.status, 201); assert.equal(admin.status, 200);
  const seed = JSON.parse(database.state.payload), time = new Date().toISOString();
  const order = (id, merchantId = owner.body.userId, deleted = true) => ({
    id, merchantId, merchantName: "صاحب السلة", merchantStore: "متجر", trackingNumber: "", recipientName: "مستلم", recipientPhone: "0591122334",
    governorate: "نابلس", city: "نابلس", address: "رفيديا", pickupAddress: "نابلس", amount: 100, deliveryFee: 25, content: "ملابس",
    weight: "0 - 5 كغم", dimensions: "20 × 20 × 20 سم", notes: "", privateNotes: "", reference: "", type: "طرد عادي", status: "delivered",
    courierName: "بانتظار تعيين المندوب", createdAt: time, updatedAt: time, deleted, deletedAt: deleted ? time : undefined,
  });
  const invoice = (id, status = "paid", orderIds = [], merchantId = owner.body.userId) => ({
    id, merchantId, merchantName: "صاحب السلة", invoiceNumber: "#" + id, orderIds, grossAmount: 100, deliveryFees: 25, returnFees: 0, netAmount: 75,
    deliveredCount: 1, returnedCount: 0, status, verificationCode: "1234", authorizedRecipient: "", createdAt: time, updatedAt: time, scheduledAt: time,
    ...(status === "paid" ? { paidAt: time } : {}), returnPricingVersion: 1, returnPricingMembership: "standard", returnFeeDetails: [],
  });
  seed.orders = [order("remove"), order("keep"), order("linked"), order("active", owner.body.userId, false), order("foreign", other.body.userId)];
  seed.orders[0].trackingNumber = "ALX-20880111";
  seed.parcelCodeClaims = { ...seed.parcelCodeClaims, "ALX-20880111": { orderId: "remove", claimedAt: time } };
  seed.collections = [invoice("paid-selected", "paid", ["remove"]), invoice("paid-keep"), invoice("paid-visible"), invoice("due", "pending", ["linked"]), invoice("foreign-invoice", "paid", [], other.body.userId)];
  seed.preferences[owner.body.userId] = { ...seed.preferences[owner.body.userId], hiddenCollectionIds: ["paid-selected", "paid-keep"] };
  seed.preferences[other.body.userId] = { ...seed.preferences[other.body.userId], hiddenCollectionIds: ["foreign-invoice"] };
  database.state.payload = JSON.stringify(seed);
  const cookie = sessionFrom(owner), current = await call(worker, database, "database", { cookie });
  return { worker, database, owner, other, admin, cookie, current };
}

test("purging selected trash removes only selected records, retains ledger/codes and syncs per account", async () => {
  const { worker, database, owner, other, cookie, current } = await trashFixture();
  const before = structuredClone(current.body.database);
  const beforeClaims = JSON.parse(database.state.payload).parcelCodeClaims;
  const result = await call(worker, database, "trash/purge", { method: "POST", cookie, payload: { revision: current.body.revision, orderIds: ["remove", "remove"], invoiceIds: ["paid-selected"] } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const db = result.body.database;
  assert.equal(db.orders.some((order) => order.id === "remove"), false);
  assert.equal(db.orders.some((order) => order.id === "keep"), true);
  assert.deepEqual(db.collections, before.collections);
  assert.deepEqual(JSON.parse(database.state.payload).parcelCodeClaims, beforeClaims);
  assert.deepEqual([...purgedCollectionIds(db, owner.body.userId)], ["paid-selected"]);
  const trashInvoices = [...hiddenCollectionIds(db, owner.body.userId)].filter((id) => !purgedCollectionIds(db, owner.body.userId).has(id));
  assert.deepEqual(trashInvoices, ["paid-keep"]);
  assert.strictEqual(setCollectionHidden(db, owner.body.userId, "paid-selected", false), db);
  const otherView = await call(worker, database, "database", { cookie: sessionFrom(other) });
  assert.deepEqual(otherView.body.database.preferences[other.body.userId].hiddenCollectionIds, ["foreign-invoice"]);
  const device2 = await call(worker, database, "login", { method: "POST", payload: { email: "trash-owner@example.test", password: "Customer@123" } });
  assert.equal(purgedCollectionIds(device2.body.database, owner.body.userId).has("paid-selected"), true);
  assert.deepEqual(device2.body.database.collections, before.collections);
  // An older client does not know the new preference and tries to restore all invoices.
  const oldClient = structuredClone(device2.body.database);
  delete oldClient.preferences[owner.body.userId].purgedCollectionIds;
  oldClient.preferences[owner.body.userId].hiddenCollectionIds = [];
  const saved = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: device2.body.revision, database: oldClient } });
  assert.equal(saved.status, 200);
  assert.equal(hiddenCollectionIds(saved.body.database, owner.body.userId).has("paid-selected"), true);
  assert.equal(purgedCollectionIds(saved.body.database, owner.body.userId).has("paid-selected"), true);
  assert.deepEqual(saved.body.database.collections.filter((invoice) => invoice.status === "paid"), before.collections.filter((invoice) => invoice.status === "paid"));
  const financialRecords = (invoices) => invoices.map(({ updatedAt, ...record }) => record);
  assert.deepEqual(financialRecords(saved.body.database.collections), financialRecords(before.collections));
  assert.deepEqual(JSON.parse(database.state.payload).parcelCodeClaims, beforeClaims);
});

test("trash purge rejects empty, missing, active, foreign, outstanding and mixed invalid selections atomically", async () => {
  const { worker, database, owner, cookie, current } = await trashFixture();
  const revision = current.body.revision;
  for (const [orderIds, invoiceIds, status] of [
    [[], [], 400], [["missing"], [], 403], [["active"], [], 403], [["foreign"], [], 403], [["linked"], [], 403],
    [[], ["due"], 403], [[], ["foreign-invoice"], 403], [[], ["paid-visible"], 403], [["remove", "active"], ["paid-selected"], 403],
    [["remove"], ["paid-selected", "due"], 403], [[" "], [], 400], [null, [], 400],
  ]) {
    const result = await call(worker, database, "trash/purge", { method: "POST", cookie, payload: { revision, orderIds, invoiceIds } });
    assert.equal(result.status, status, JSON.stringify({ orderIds, invoiceIds, result }));
    assert.equal(database.state.revision, revision);
    assert.equal(JSON.parse(database.state.payload).orders.some((order) => order.id === "remove"), true);
    assert.deepEqual(purgedCollectionIds(JSON.parse(database.state.payload), owner.body.userId).size, 0);
  }
  const seed = JSON.parse(database.state.payload);
  seed.users.find((entry) => entry.id === owner.body.userId).role = "courier";
  database.state.payload = JSON.stringify(seed);
  const courier = await call(worker, database, "trash/purge", { method: "POST", cookie, payload: { revision, orderIds: ["remove"], invoiceIds: [] } });
  assert.equal(courier.status, 403);
  const unsigned = await call(worker, database, "trash/purge", { method: "POST", payload: { revision, orderIds: ["remove"], invoiceIds: [] } });
  assert.equal(unsigned.status, 401);
});

test("a restore from another device invalidates a pending purge and returns a fresh snapshot", async () => {
  const { worker, database, cookie, current } = await trashFixture();
  const db = structuredClone(current.body.database);
  db.orders.find((order) => order.id === "remove").deleted = false;
  const restored = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: current.body.revision, database: db } });
  assert.equal(restored.status, 200);
  const result = await call(worker, database, "trash/purge", { method: "POST", cookie, payload: { revision: current.body.revision, orderIds: ["remove"], invoiceIds: ["paid-selected"] } });
  assert.equal(result.status, 409);
  assert.equal(result.body.revision, restored.body.revision);
  assert.equal(result.body.database.orders.find((order) => order.id === "remove").deleted, false);
  assert.equal(result.body.database.preferences[current.body.userId].purgedCollectionIds?.length ?? 0, 0);
});

test("purge preferences cannot be forged through general saves and admins can purge authorized trash", async () => {
  const { worker, database, admin, cookie, current } = await trashFixture();
  const db = structuredClone(current.body.database);
  db.preferences[current.body.userId].purgedCollectionIds = ["paid-visible", "due"];
  const saved = await call(worker, database, "database", { method: "PUT", cookie, payload: { revision: current.body.revision, database: db } });
  assert.equal(saved.status, 200);
  assert.equal(purgedCollectionIds(saved.body.database, current.body.userId).size, 0);
  const adminCookie = sessionFrom(admin);
  const latest = await call(worker, database, "database", { cookie: adminCookie });
  const result = await call(worker, database, "trash/purge", { method: "POST", cookie: adminCookie, payload: { revision: latest.body.revision, orderIds: ["foreign"], invoiceIds: [] } });
  assert.equal(result.status, 200);
  assert.equal(result.body.database.orders.some((order) => order.id === "foreign"), false);
});

test("purged invoices retain billing protection and become visible if payment is reopened", () => {
  const db = createSeedDatabase(); db.users = [{ id: "owner", role: "merchant" }];
  db.orders = [{ id: "o", merchantId: "owner", status: "delivered", deleted: true }];
  db.collections = [{ id: "i", merchantId: "owner", status: "paid", orderIds: ["o"], netAmount: 75 }];
  db.preferences = { owner: { hiddenCollectionIds: ["i"] } };
  const purged = purgeSelectedTrash(db, "owner", [], ["i"]);
  assert.equal(isOrderInvoicedForCurrentShipment(db.orders[0], purged.collections), true);
  assert.equal(canPurgeOrder(purged, db.users[0], db.orders[0]), true);
  purged.collections = [{ ...purged.collections[0], status: "pending" }];
  const reopened = normalizeCollectionVisibility(purged);
  assert.equal(canPurgeOrder(reopened, db.users[0], db.orders[0]), false);
  assert.equal(hiddenCollectionIds(reopened, "owner").size, 0);
  assert.equal(purgedCollectionIds(reopened, "owner").size, 0);
});

test("account deletion requests preserve obligations, prevent spoofing, and complete with a private expiring receipt", async () => {
  const worker = await loadWorker();
  const db = new FakeD1Database();
  const merchant = await call(worker, db, "register", { method: "POST", payload: accountPayload("صاحب طلب الحذف", "request-delete@example.test", "0591231234") });
  assert.equal(merchant.status, 201);
  const cookie = sessionFrom(merchant), id = merchant.body.userId;
  const other = await call(worker, db, "register", { method: "POST", payload: accountPayload("حساب مستقل", "request-other@example.test", "0591231235") });
  const otherCookie = sessionFrom(other);
  const admin = await call(worker, db, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  const adminCookie = sessionFrom(admin);
  const now = new Date().toISOString();
  const seed = JSON.parse(db.state.payload);
  seed.orders.push({ id: "deletion-request-order", address: "عنوان", pickupAddress: "عنوان استلام", content: "اختبار", dimensions: "20 × 20 × 20 سم", notes: "", privateNotes: "", reference: "", type: "طرد عادي", weight: "0 - 5 كغم", merchantId: id, status: "ready", trackingNumber: "ALX-1000001", createdAt: now, updatedAt: now, courierName: "", amount: 100, deliveryFee: 20, returnFee: 0, merchantName: "صاحب طلب الحذف", merchantStore: "متجر", recipientName: "مستلم", recipientPhone: "0591231234", city: "نابلس", deleted: true });
  seed.collections.push({ id: "deletion-request-invoice", authorizedRecipient: "", merchantId: id, merchantName: "صاحب طلب الحذف", invoiceNumber: "#800001", orderIds: ["deletion-request-order"], status: "pending", netAmount: 80, grossAmount: 100, deliveryFees: 20, returnFees: 0, createdAt: now, updatedAt: now, scheduledAt: now, verificationCode: "4728", deliveredCount: 0, returnedCount: 0 });
  db.state.payload = JSON.stringify(seed);
  const credentials = { password: "Customer@123", confirmation: "حذف حسابي" };
  assert.equal((await call(worker, db, "account/deletion-request", { method: "POST", payload: credentials })).status, 401);
  assert.equal((await call(worker, db, "account/deletion-request", { method: "POST", cookie, payload: { ...credentials, password: "invalid" } })).status, 403);
  assert.equal((await call(worker, db, "account/deletion-request", { method: "POST", cookie, payload: { ...credentials, confirmation: "نعم" } })).status, 400);
  const created = await call(worker, db, "account/deletion-request", { method: "POST", cookie, payload: { ...credentials, userId: other.body.userId, status: "completed", eligible: true } });
  assert.equal(created.status, 201, created.body.error);
  assert.equal(created.body.request.status, "pending");
  assert.equal(created.body.eligibility.activeOrderCount, 1, "soft-deleting a parcel must not bypass settlement");
  assert.equal(created.body.eligibility.unsettledCollectionCount, 1);
  assert.equal(created.body.eligibility.eligible, false);
  assert.equal(Date.parse(created.body.request.reviewDueAt) - Date.parse(created.body.request.createdAt), 7 * 86400_000);
  const receiptUrl = new URL(created.body.request.receiptUrl);
  assert.equal(receiptUrl.pathname, "/delete-account");
  assert.equal(receiptUrl.search, "");
  const receiptToken = new URLSearchParams(receiptUrl.hash.slice(1)).get("receipt");
  assert.match(receiptToken, /^[a-f0-9]{64}$/);
  assert.equal(created.body.request.receiptToken, undefined);
  const stored = JSON.parse(db.state.payload);
  assert.equal(stored.accountDeletionRequests.length, 1);
  assert.equal(stored.accountDeletionRequests[0].userId, id);
  assert.deepEqual(stored.orders.map((order) => order.id), seed.orders.map((order) => order.id));
  assert.equal(stored.collections[0].status, "pending");
  assert.equal((await call(worker, db, "database", { cookie })).status, 200, "submitting a request keeps the account session active");
  const duplicate = await call(worker, db, "account/deletion-request", { method: "POST", cookie, payload: credentials });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body.request, created.body.request);
  assert.equal(JSON.parse(db.state.payload).notices.length, stored.notices.length);
  assert.equal((await call(worker, db, "account/deletion-request", { cookie: otherCookie })).body.request, null);
  assert.equal((await call(worker, db, "admin/deletion-requests", { cookie })).status, 403);
  const adminSnapshot = await call(worker, db, "database", { cookie: adminCookie });
  assert.equal(adminSnapshot.body.database.accountDeletionRequests, undefined);
  assert.equal(JSON.stringify(adminSnapshot.body).includes(receiptToken), false);
  const changed = await call(worker, db, "database", { method: "PUT", cookie: adminCookie, payload: { revision: adminSnapshot.body.revision, database: { ...adminSnapshot.body.database, accountDeletionRequests: [] } } });
  assert.equal(changed.status, 200, changed.body.error);
  assert.equal((await call(worker, db, "account/deletion-request", { cookie })).body.request.id, created.body.request.id);
  const userSnapshot = await call(worker, db, "database", { cookie });
  const forged = await call(worker, db, "database", { method: "PUT", cookie, payload: { revision: userSnapshot.body.revision, database: { ...userSnapshot.body.database, accountDeletionRequests: [{ ...stored.accountDeletionRequests[0], status: "completed" }] } } });
  assert.equal(forged.status, 200, forged.body.error);
  assert.equal((await call(worker, db, "account/deletion-request", { cookie })).body.request.status, "pending");
  const queue = await call(worker, db, "admin/deletion-requests", { cookie: adminCookie });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.requests[0].account.id, id);
  assert.equal(JSON.stringify(queue.body).includes(receiptToken), false);
  const action = { id: created.body.request.id, action: "complete", confirmation: "إتمام الحذف" };
  assert.equal((await call(worker, db, "admin/deletion-requests", { method: "POST", cookie: otherCookie, payload: action })).status, 403);
  assert.equal((await call(worker, db, "admin/deletion-requests", { method: "POST", cookie: adminCookie, payload: action })).status, 409);
  assert.equal((await call(worker, db, "account/delete", { method: "POST", cookie, payload: credentials })).status, 409);
  const reviewDueAt = new Date(Date.now() + 2 * 86400_000).toISOString();
  const reviewed = await call(worker, db, "admin/deletion-requests", { method: "POST", cookie: adminCookie, payload: { id: action.id, action: "review", message: "تسليم الطرد ثم إدراجه في فاتورة وتسوية قيمتها.", reviewDueAt } });
  assert.equal(reviewed.status, 200, reviewed.body.error);
  const status = await call(worker, db, "account/deletion-request", { cookie });
  assert.equal(status.body.request.status, "processing");
  assert.equal(status.body.request.reviewDueAt, reviewDueAt);
  assert.match(status.body.request.message, /تسليم الطرد/);
  const receipt = await call(worker, db, "account/deletion-receipt", { method: "POST", payload: { receiptToken } });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.request.status, "processing");
  for (const secret of ["request-delete@example.test", "0591231234", "userId", "receiptToken", "eligibility"]) assert.equal(JSON.stringify(receipt.body).includes(secret), false);
  assert.equal((await call(worker, db, "account/deletion-receipt", { method: "POST", payload: { receiptToken: "a".repeat(64) } })).status, 404);
  const settled = JSON.parse(db.state.payload);
  settled.orders[0].status = "delivered";
  settled.collections[0].status = "paid"; settled.collections[0].paidAt = now;
  db.state.payload = JSON.stringify(settled);
  assert.equal((await call(worker, db, "account/deletion-request", { cookie })).body.eligibility.eligible, true);
  assert.equal((await call(worker, db, "admin/deletion-requests", { method: "POST", cookie: adminCookie, payload: { ...action, confirmation: "" } })).status, 400);
  const completed = await call(worker, db, "admin/deletion-requests", { method: "POST", cookie: adminCookie, payload: action });
  assert.equal(completed.status, 200, completed.body.error);
  assert.equal(completed.body.request.status, "completed");
  assert.equal((await call(worker, db, "database", { cookie })).status, 401);
  assert.equal((await call(worker, db, "database", { cookie: otherCookie })).status, 200);
  const finished = JSON.parse(db.state.payload);
  assert.equal(finished.users.some((user) => user.id === id), false);
  assert.equal(finished.orders.some((order) => order.merchantId === id), false);
  assert.equal(finished.collections.some((invoice) => invoice.merchantId === id), false);
  assert.equal(finished.accountDeletionRequests[0].userId, "");
  assert.equal(finished.notices.some((notice) => notice.deletionRequestId === action.id), false);
  assert.equal([...db.sessions.values()].some((entry) => entry.user_id === id), false);
  const receiptAfter = await call(worker, db, "account/deletion-receipt", { method: "POST", payload: { receiptToken } });
  assert.equal(receiptAfter.status, 200);
  assert.equal(receiptAfter.body.request.status, "completed");
  finished.accountDeletionRequests[0].completedAt = new Date(Date.now() - 31 * 86400_000).toISOString();
  db.state.payload = JSON.stringify(finished);
  assert.equal((await call(worker, db, "account/deletion-receipt", { method: "POST", payload: { receiptToken } })).status, 404);
});

test("public service configuration exposes only explicitly configured contacts and deletion URLs", async () => {
  const worker = await loadWorker(), db = new FakeD1Database();
  const empty = await call(worker, db, "public/config");
  assert.equal(empty.status, 200);
  assert.equal(empty.body.supportPhone, "");
  assert.equal(empty.body.supportEmail, "");
  assert.equal(empty.body.privacyUrl, "http://almadina.test/privacy");
  assert.equal(empty.body.deletionUrl, "http://almadina.test/delete-account");
  const configured = await call(worker, db, "public/config", { environment: { ALMADINA_SUPPORT_PHONE: "+970 59 123 4567", ALMADINA_SUPPORT_EMAIL: "support@example.test" } });
  assert.equal(configured.body.supportPhone, "+970591234567");
  assert.equal(configured.body.supportEmail, "support@example.test");
  assert.equal(Object.hasOwn(configured.body, "bootstrapAdminEmail"), false);
});

test("rejects malformed, scalar and excessively nested JSON without touching accounts", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const account = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  const original = structuredClone(database.state);
  for (const rawBody of ["{broken", "null", "[]", '"text"', "123", '{"x":'.repeat(70) + "{}" + "}".repeat(70)]) {
    const result = await rawCall(worker, database, "database", { method: "PUT", cookie: sessionFrom(account), rawBody, headers: { "Content-Type": "application/json" } });
    assert.equal(result.status, 400, rawBody.slice(0, 30));
    assert.match(result.headers.get("X-Request-ID"), /^[a-f0-9-]{36}$/);
    assert.deepEqual(database.state, original);
  }
});

test("unverified Render clients use short shared public budgets rather than ten-minute per-IP lockouts", async () => {
  const worker = await loadWorker();
  const db = new FakeD1Database();
  for (let i = 0; i < 35; i++) {
    const tracking = await call(worker, db, `track?tracking=ALX-${10000000 + i}`);
    assert.equal(tracking.status, 404);
    const receipt = await call(worker, db, "account/deletion-receipt", { method: "POST", payload: { receiptToken: "a".repeat(64) } });
    assert.equal(receipt.status, 404);
    const location = await call(worker, db, "geocode/reverse", { method: "POST", payload: { latitude: 32.2211, longitude: 35.2544 }, environment: { REVERSE_GEOCODER: async () => ({ city: "نابلس", state: "محافظة نابلس", street: "الشارع" }) } });
    assert.equal(location.status, 200);
  }
  const now = Math.floor(Date.now() / 1000);
  for (const bucket of db.rateLimits.values()) if (["public-tracking-ip", "deletion-receipt", "reverse-geocode"].includes(bucket.action)) {
    assert.ok(bucket.reset_at <= now + 60);
  }
});

test("account write limits block excess mutations while preserving read and logout access", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const account = await call(worker, database, "login", { method: "POST", payload: { email: "admin@almadinaexpress.com", password: TEST_ADMIN_PASSWORD } });
  const cookie = sessionFrom(account);
  const before = structuredClone(database.state);
  await call(worker, database, "notices/clear", { method: "POST", cookie, payload: { noticeIds: [] } });
  const budget = [...database.rateLimits.values()].find((row) => row.action === "account-write");
  assert.ok(budget);
  budget.request_count = 120;
  const blocked = await rawCall(worker, database, "orders", { method: "POST", cookie, payload: { orders: [] } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("Retry-After")) >= 1);
  assert.ok(Number(blocked.headers.get("Retry-After")) <= 60);
  assert.deepEqual(database.state, before);
  assert.equal((await call(worker, database, "session", { cookie })).status, 200);
  assert.equal((await call(worker, database, "logout", { method: "POST", cookie })).status, 200);
  assert.equal((await call(worker, database, "session", { cookie })).status, 401);
});
