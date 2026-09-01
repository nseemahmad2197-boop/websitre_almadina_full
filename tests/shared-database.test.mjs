import assert from "node:assert/strict";
import test from "node:test";

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
    if (this.sql.startsWith("SELECT revision FROM almadina_state")) {
      return this.database.state ? { revision: this.database.state.revision } : null;
    }

    if (this.sql.startsWith("SELECT payload, revision FROM almadina_state")) {
      return this.database.state ? { payload: this.database.state.payload, revision: this.database.state.revision } : null;
    }

    if (this.sql.startsWith("SELECT user_id, expires_at FROM almadina_sessions")) {
      const session = this.database.sessions.get(this.values[0]);
      return session ? { user_id: session.user_id, expires_at: session.expires_at } : null;
    }

    if (this.sql.startsWith("SELECT user_id, pin_hash, enabled, biometric_enabled, failed_attempts, locked_until FROM almadina_app_locks")) {
      return this.database.appLocks.get(this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT credential_id FROM almadina_webauthn_credentials WHERE user_id")) {
      return [...this.database.credentials.values()].find((credential) => credential.user_id === this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT challenge, origin, rp_id, expires_at FROM almadina_webauthn_challenges")) {
      return this.database.challenges.get(`${this.values[0]}:${this.values[2]}`) ?? null;
    }

    if (this.sql.startsWith("SELECT user_id FROM almadina_webauthn_credentials WHERE credential_id")) {
      return this.database.credentials.get(this.values[0]) ?? null;
    }

    if (this.sql.startsWith("SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM almadina_webauthn_credentials WHERE credential_id")) {
      const credential = this.database.credentials.get(this.values[0]);
      return credential?.user_id === this.values[1] ? credential : null;
    }

    throw new Error(`Unsupported mock D1 first() query: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith("SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM almadina_webauthn_credentials WHERE user_id")) {
      return { results: [...this.database.credentials.values()].filter((credential) => credential.user_id === this.values[0]), success: true, meta: { changes: 0 } };
    }
    throw new Error(`Unsupported mock D1 all() query: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("CREATE TABLE") || this.sql.startsWith("CREATE INDEX")) return { success: true, meta: { changes: 0 } };

    if (this.sql.startsWith("INSERT INTO almadina_state") && this.sql.includes("ON CONFLICT (id) DO NOTHING")) {
      if (this.database.state) return { success: true, meta: { changes: 0 } };
      this.database.state = { id: this.values[0], payload: this.values[1], revision: this.values[2], updated_at: this.values[3] };
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE almadina_state SET payload")) {
      if (!this.database.state || this.database.state.id !== this.values[2] || this.database.state.revision !== this.values[3]) {
        return { success: true, meta: { changes: 0 } };
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

    if (this.sql.startsWith("DELETE FROM almadina_sessions WHERE user_id")) {
      let changes = 0;
      for (const [tokenHash, session] of this.database.sessions) {
        if (session.user_id !== this.values[0]) continue;
        this.database.sessions.delete(tokenHash);
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (this.sql.startsWith("DELETE FROM almadina_sessions WHERE token_hash")) {
      return { success: true, meta: { changes: Number(this.database.sessions.delete(this.values[0])) } };
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

    throw new Error(`Unsupported mock D1 run() query: ${this.sql}`);
  }
}

class FakeD1Database {
  state = null;
  sessions = new Map();
  appLocks = new Map();
  credentials = new Map();
  challenges = new Map();

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
    return { fetch: (request, environment) => handleAlmadinaApi(request, environment.DB) };
  }

  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("shared-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function call(worker, database, path, { method = "GET", payload, cookie, origin } = {}) {
  const headers = new Headers();
  if (payload) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  if (origin) headers.set("Origin", origin);

  const response = await worker.fetch(
    new Request(`http://almadina.test/api/almadina/${path}`, {
      method,
      headers,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),
    {
      DB: database,
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  return { status: response.status, headers: response.headers, body: await response.json() };
}

function accountPayload(name, email, phone) {
  return { name, email, phone, store: `متجر ${name}`, password: "Customer@123" };
}

function sessionFrom(result) {
  const value = result.headers.get("set-cookie");
  assert.ok(value);
  assert.match(value, /HttpOnly/);
  return value.split(";")[0];
}

test("shares accounts and orders across devices while isolating customers and protecting sessions", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

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
    trackingNumber: "ALX-20200001",
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
  assert.equal(createdOrder.body.database.orders[0].deliveryFee, 42);
  assert.equal(createdOrder.body.database.orders[0].weightFee, 0);
  assert.equal(createdOrder.body.database.orders[0].oversizeFee, 7);
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
    payload: { email: "admin@almadinaexpress.com", password: "Admin@123" },
  });

  assert.equal(administrator.status, 200);
  assert.equal(administrator.body.database.users.length, 3);
  assert.equal(administrator.body.database.orders.length, 1);
  assert.equal(administrator.body.database.orders[0].notes, "");
  assert.equal(administrator.body.database.orders[0].privateNotes, adminOnlyNote);
  assert.ok(!JSON.stringify(administrator.body).includes(courierInstructions));
  assert.ok(JSON.stringify(administrator.body).includes(adminOnlyNote));
  assert.ok(administrator.body.database.users.every((account) => account.password === ""));
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
    membership: "standard",
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
  assert.deepEqual(employeeDevice.body.database.orders, []);
  assert.deepEqual(employeeDevice.body.database.collections, []);
  const employeeCookie = sessionFrom(employeeDevice);

  const sameNameEmployeeDevice = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "employee-same-name@example.test", password: "Employee@123" },
  });
  assert.equal(sameNameEmployeeDevice.status, 200);
  assert.deepEqual(sameNameEmployeeDevice.body.database.orders, []);
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

  const [premiumOnlyBroadcast, standardOnlyBroadcast] = await Promise.all([
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
        requestId: "release-standard-2026-09-01",
        audience: "standard",
        title: "تحديث خاص بالحسابات العادية",
        message: "هذا الإشعار مخصص للتجار أصحاب الحسابات العادية فقط.",
      },
    }),
  ]);
  assert.equal(premiumOnlyBroadcast.status, 200);
  assert.equal(standardOnlyBroadcast.status, 200);
  assert.equal(premiumOnlyBroadcast.body.recipientCount, 1);
  assert.equal(standardOnlyBroadcast.body.recipientCount, 2);

  const premiumMerchantAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: secondCookie });
  const standardMerchantAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: otherCookie });
  const managedStandardAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: managedCookie });
  const courierAfterMembershipBroadcasts = await call(worker, database, "database", { cookie: employeeCookie });
  assert.equal(premiumMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم" && notice.audience === "premium").length, 1);
  assert.equal(premiumMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات العادية").length, 0);
  assert.equal(standardMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم").length, 0);
  assert.equal(standardMerchantAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات العادية" && notice.audience === "standard").length, 1);
  assert.equal(managedStandardAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بالحسابات العادية" && notice.audience === "standard").length, 1);
  assert.equal(courierAfterMembershipBroadcasts.body.database.notices.filter((notice) => notice.title === "تحديث خاص بحسابات البريميوم" || notice.title === "تحديث خاص بالحسابات العادية").length, 0);

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
  assert.deepEqual(scannedParcel.body.database.recipients, []);
  assert.deepEqual(scannedParcel.body.database.collections, []);

  const sameNameAfterScan = await call(worker, database, "database", { cookie: sameNameEmployeeCookie });
  assert.equal(sameNameAfterScan.status, 200);
  assert.deepEqual(sameNameAfterScan.body.database.orders, []);

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

  const deliveredAfterScan = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: unchangedAfterRepeatedScan.body.revision,
      database: {
        ...unchangedAfterRepeatedScan.body.database,
        orders: unchangedAfterRepeatedScan.body.database.orders.map((item) => item.id === order.id ? { ...item, status: "delivered", updatedAt: new Date().toISOString() } : item),
      },
    },
  });
  assert.equal(deliveredAfterScan.status, 200);

  const premiumCustomer = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(premiumCustomer.body.database.users[0].membership, "premium");
  assert.equal(premiumCustomer.body.database.orders[0].status, "delivered");

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
      revision: premiumCustomer.body.revision,
      database: {
        ...premiumCustomer.body.database,
        collections: [collectionDraft],
        nextCollection: premiumCustomer.body.database.nextCollection + 1,
      },
    },
  });

  assert.equal(createdCollection.status, 200);
  assert.equal(createdCollection.body.database.collections.length, 1);
  assert.equal(createdCollection.body.database.collections[0].invoiceNumber, "#618000");
  assert.equal(createdCollection.body.database.collections[0].grossAmount, 100);
  assert.equal(createdCollection.body.database.collections[0].deliveryFees, 42);
  assert.equal(createdCollection.body.database.collections[0].netAmount, 58);
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
  assert.equal(pendingVerificationUpdate.body.database.collections[0].netAmount, 58);
  assert.equal(pendingVerificationUpdate.body.database.collections[0].status, "pending");
  assert.equal(pendingVerificationUpdate.body.database.collections[0].verificationCode, "2468");
  assert.equal(pendingVerificationUpdate.body.database.collections[0].authorizedRecipient, "مستلم أثناء التجهيز");

  const isolatedCollections = await call(worker, database, "database", { cookie: otherCookie });
  assert.deepEqual(isolatedCollections.body.database.collections, []);

  const adminAfterCollection = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(adminAfterCollection.body.database.collections.length, 1);
  const readyCollection = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: adminAfterCollection.body.revision,
      database: {
        ...adminAfterCollection.body.database,
        collections: adminAfterCollection.body.database.collections.map((invoice) => ({ ...invoice, status: "ready", updatedAt: new Date().toISOString() })),
      },
    },
  });
  assert.equal(readyCollection.status, 200);

  const readyForMerchant = await call(worker, database, "database", { cookie: firstCookie });
  assert.equal(readyForMerchant.body.database.collections[0].status, "ready");
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
  assert.equal(securedMerchantUpdate.body.database.collections[0].netAmount, 58);
  assert.equal(securedMerchantUpdate.body.database.collections[0].status, "ready");
  assert.equal(securedMerchantUpdate.body.database.collections[0].verificationCode, "4321");
  assert.equal(securedMerchantUpdate.body.database.collections[0].authorizedRecipient, "المستلم المفوض");

  const invoiceId = securedMerchantUpdate.body.database.collections[0].id;
  const merchantVerification = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: secondCookie,
    payload: { invoiceId, verificationCode: "4321" },
  });
  assert.equal(merchantVerification.status, 403);

  const incorrectVerification = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: adminCookie,
    payload: { invoiceId, verificationCode: "9999" },
  });
  assert.equal(incorrectVerification.status, 422);

  const unchangedAfterIncorrectCode = await call(worker, database, "database", { cookie: adminCookie });
  const stillReady = unchangedAfterIncorrectCode.body.database.collections.find((invoice) => invoice.id === invoiceId);
  const noticeCountBeforeVerification = unchangedAfterIncorrectCode.body.database.notices.length;
  assert.equal(stillReady.status, "ready");
  assert.equal(stillReady.verifiedAt, undefined);
  assert.equal(stillReady.verifiedById, undefined);
  assert.equal(stillReady.verifiedByName, undefined);
  assert.equal(stillReady.shippedAt, undefined);

  const verifiedCollection = await call(worker, database, "collections/verify", {
    method: "POST",
    cookie: adminCookie,
    payload: { invoiceId, verificationCode: "4321" },
  });
  assert.equal(verifiedCollection.status, 200);
  const shippedInvoice = verifiedCollection.body.database.collections.find((invoice) => invoice.id === invoiceId);
  const verifyingAdmin = administrator.body.database.users.find((account) => account.id === administrator.body.userId);
  assert.equal(shippedInvoice.status, "shipped");
  assert.equal(shippedInvoice.verifiedById, administrator.body.userId);
  assert.equal(shippedInvoice.verifiedByName, verifyingAdmin.name);
  assert.match(shippedInvoice.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(shippedInvoice.shippedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(verifiedCollection.body.database.notices.length, noticeCountBeforeVerification + 1);
  assert.ok(verifiedCollection.body.database.notices.some((notice) => notice.userId === firstDevice.body.userId));

  const shippedForMerchant = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(shippedForMerchant.body.database.collections[0].status, "shipped");
  assert.equal(shippedForMerchant.body.database.collections[0].netAmount, 58);
  assert.ok(shippedForMerchant.body.database.notices.some((notice) => notice.userId === firstDevice.body.userId));

  const merchantNoteText = "يرجى الاتصال بالمستلم قبل التوصيل.";
  const merchantNote = await call(worker, database, "database", {
    method: "PUT",
    cookie: secondCookie,
    payload: {
      revision: shippedForMerchant.body.revision,
      database: {
        ...shippedForMerchant.body.database,
        orders: shippedForMerchant.body.database.orders.map((item) => item.id === order.id ? {
          ...item,
          status: "returned",
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
  assert.equal(savedMerchantNote.kind, "note");
  assert.equal(savedMerchantNote.status, "delivered");
  assert.equal(savedMerchantNote.actor, "التاجر الأول");
  assert.equal(savedMerchantNote.note, merchantNoteText);
  assert.notEqual(savedMerchantNote.id, "forged-note-id");
  assert.notEqual(savedMerchantNote.createdAt, new Date(0).toISOString());

  const adminSeesMerchantNote = await call(worker, database, "database", { cookie: adminCookie });
  assert.equal(adminSeesMerchantNote.body.database.orders.find((item) => item.id === order.id).trackingEvents.at(-1).note, merchantNoteText);

  const courierDoesNotSeeMerchantNote = await call(worker, database, "database", { cookie: employeeCookie });
  assert.equal(courierDoesNotSeeMerchantNote.status, 200);
  const courierOrderAfterNote = courierDoesNotSeeMerchantNote.body.database.orders.find((item) => item.id === order.id);
  assert.equal(courierOrderAfterNote.notes, courierInstructions);
  assert.ok(courierOrderAfterNote.trackingEvents.every((event) => event.kind !== "note"));
  assert.ok(!JSON.stringify(courierDoesNotSeeMerchantNote.body).includes(merchantNoteText));

  const outdatedWrite = await call(worker, database, "database", {
    method: "PUT",
    cookie: firstCookie,
    payload: { revision: firstDevice.body.revision, database: firstDevice.body.database },
  });
  assert.equal(outdatedWrite.status, 409);
  assert.equal(outdatedWrite.body.database.users.length, 1);

  const tracked = await call(worker, database, "track?tracking=ALX-20200001");
  assert.equal(tracked.status, 200);
  assert.equal(tracked.body.order.recipientName, "المستلم");
  assert.ok(tracked.body.order.trackingEvents.length >= 2);
  assert.equal(tracked.body.order.trackingEvents.at(-1).status, "delivered");
  assert.ok(tracked.body.order.trackingEvents.every((event) => event.actor === "فريق المدينة إكسبرس"));
  assert.ok(tracked.body.order.trackingEvents.every((event) => event.kind !== "note"));
  assert.ok(tracked.body.order.trackingEvents.every((event) => event.note !== merchantNoteText));
  assert.equal(tracked.body.order.recipientPhone, undefined);
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
  assert.ok(persisted.users.every((account) => account.password.startsWith("pbkdf2:100000:")));
  assert.equal(persisted.orders.find((item) => item.id === order.id).notes, courierInstructions);
  assert.equal(persisted.orders.find((item) => item.id === order.id).privateNotes, adminOnlyNote);
  assert.doesNotMatch(database.state.payload, /Customer@123|Admin@123|Managed@123|Employee@123/);

  const loggedOut = await call(worker, database, "logout", { method: "POST", cookie: secondCookie });
  assert.equal(loggedOut.status, 200);
  const revoked = await call(worker, database, "database", { cookie: secondCookie });
  assert.equal(revoked.status, 401);
  const stillSignedIn = await call(worker, database, "database", { cookie: firstCookie });
  assert.equal(stillSignedIn.status, 200);
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
    payload: { email: "admin@almadinaexpress.com", password: "Admin@123" },
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
    { id: "parcel-all-over", weight: "0 - 5 كغم", dimensions: [50, 50, 50], expectedWeightFee: 0, expectedOversizeFee: 7, expectedFee: 42 },
    { id: "parcel-partial-width", weight: undefined, dimensions: [undefined, 50, undefined], dimensionText: "50 سم", expectedDimensions: [0, 50, 0], expectedWeight: "0 - 5 كغم", expectedWeightFee: 0, expectedOversizeFee: 7, expectedFee: 42 },
    { id: "parcel-arabic-digits", weight: "5 - 10 كغم", dimensions: [undefined, undefined, undefined], dimensionText: "٨١ × ٢٠ × ٢٠ سم", expectedDimensions: [81, 20, 20], expectedWeightFee: 5, expectedOversizeFee: 21, expectedFee: 61 },
  ];

  for (const [index, entry] of cases.entries()) {
    const [lengthCm, widthCm, heightCm] = entry.dimensions;
    const now = new Date().toISOString();
    const candidate = {
      id: entry.id,
      trackingNumber: `FORGED-${index}`,
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

    assert.equal(response.status, 200);
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

  const administrator = await call(worker, database, "login", {
    method: "POST",
    payload: { email: "admin@almadinaexpress.com", password: "Admin@123" },
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
    trackingNumber: "FORGED-PREMIUM",
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
  assert.deepEqual(initialStatus.body, { enabled: false, biometricEnabled: false });

  const invalidPin = await call(worker, database, "security/pin", { method: "POST", cookie, payload: { pin: "12" } });
  assert.equal(invalidPin.status, 400);

  const enabled = await call(worker, database, "security/pin", { method: "POST", cookie, payload: { pin: "١٢٣٤" } });
  assert.equal(enabled.status, 200);
  assert.deepEqual(enabled.body, { enabled: true, biometricEnabled: false });
  const storedLock = database.appLocks.get(registration.body.userId);
  assert.ok(storedLock.pin_hash.startsWith("pbkdf2:"));
  assert.ok(!storedLock.pin_hash.includes("1234"));
  assert.ok(!database.state.payload.includes('"pin":"1234"'));

  const rejected = await call(worker, database, "security/pin/verify", { method: "POST", cookie, payload: { pin: "0000" } });
  assert.equal(rejected.status, 403);
  const verified = await call(worker, database, "security/pin/verify", { method: "POST", cookie, payload: { pin: "1234" } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.verified, true);

  const registrationOptions = await call(worker, database, "security/webauthn/register/options", { method: "POST", cookie });
  assert.equal(registrationOptions.status, 200);
  assert.equal(registrationOptions.body.rp.id, "almadina.test");
  assert.equal(registrationOptions.body.authenticatorSelection.authenticatorAttachment, "platform");
  assert.equal(registrationOptions.body.authenticatorSelection.userVerification, "required");
  assert.equal(database.challenges.size, 1);

  const disabled = await call(worker, database, "security/disable", { method: "POST", cookie, payload: { pin: "1234" } });
  assert.equal(disabled.status, 200);
  assert.deepEqual(disabled.body, { enabled: false, biometricEnabled: false });
  assert.equal(database.appLocks.size, 0);
  assert.equal(database.challenges.size, 0);
});

test("deletes only the authenticated eligible account and preserves every other hosted record", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();

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
    payload: { email: "admin@almadinaexpress.com", password: "Admin@123" },
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
    payload: { password: "Admin@123", confirmation: "حذف حسابي" },
  });
  assert.equal(administratorDeletion.status, 403);

  const now = new Date().toISOString();
  const ownedOrder = {
    id: "order-account-deletion",
    trackingNumber: "ALX-DELETE-1",
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
        notices: [{ id: "notice-account-deletion", userId: merchant.body.userId, title: "إشعار خاص", message: "يجب حذف هذا الإشعار فقط.", icon: "bell", read: false, createdAt: now }],
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

  const settled = await call(worker, database, "database", {
    method: "PUT",
    cookie: adminCookie,
    payload: {
      revision: prepared.body.revision,
      database: {
        ...prepared.body.database,
        orders: prepared.body.database.orders.map((order) => order.id === ownedOrder.id ? { ...order, status: "delivered", updatedAt: now } : order),
        collections: prepared.body.database.collections.map((invoice) => invoice.id === ownedCollection.id ? { ...invoice, status: "paid", paidAt: now, updatedAt: now } : invoice),
      },
    },
  });
  assert.equal(settled.status, 200);

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
  assert.match(deleted.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal([...database.sessions.values()].some((session) => session.user_id === merchant.body.userId), false);

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
    trackingNumber: "ALX-KEEP-COURIER-1",
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

  const afterCourierDeletion = await call(worker, database, "database", { cookie: adminCookie });
  const preservedOrder = afterCourierDeletion.body.database.orders.find((order) => order.id === courierOrder.id);
  assert.ok(preservedOrder);
  assert.equal(preservedOrder.merchantId, otherMerchant.body.userId);
  assert.equal(preservedOrder.courierId, undefined);
  assert.equal(preservedOrder.courierName, "مندوب سابق");
  assert.equal(preservedOrder.trackingEvents[0].actor, "مندوب سابق");
});
