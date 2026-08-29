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

    throw new Error(`Unsupported mock D1 first() query: ${this.sql}`);
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

    if (this.sql.startsWith("DELETE FROM almadina_sessions")) {
      return { success: true, meta: { changes: Number(this.database.sessions.delete(this.values[0])) } };
    }

    throw new Error(`Unsupported mock D1 run() query: ${this.sql}`);
  }
}

class FakeD1Database {
  state = null;
  sessions = new Map();

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

test("recalculates one ₪7 oversize fee when any dimension exceeds 40 cm", async () => {
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
    { id: "parcel-at-limit", dimensions: [40, 40, 40], expectedFee: 35 },
    { id: "parcel-one-over", dimensions: [41, 20, 20], expectedFee: 42 },
    { id: "parcel-height-over", dimensions: [20, 20, 41], expectedFee: 42 },
    { id: "parcel-all-over", dimensions: [50, 50, 50], expectedFee: 42 },
    { id: "parcel-partial-width", dimensions: [undefined, 50, undefined], dimensionText: "50 سم", expectedDimensions: [0, 50, 0], expectedFee: 42 },
    { id: "parcel-arabic-digits", dimensions: [undefined, undefined, undefined], dimensionText: "٥٠ × ٢٠ × ٢٠ سم", expectedDimensions: [50, 20, 20], expectedFee: 42 },
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
      weight: "0 - 5 كغم",
      dimensions: entry.dimensionText ?? `${lengthCm} × ${widthCm} × ${heightCm} سم`,
      lengthCm,
      widthCm,
      heightCm,
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
    assert.equal(saved.oversizeFee, entry.expectedFee - 35);
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
    weight: "0 - 5 كغم",
    dimensions: "41 × 20 × 20 سم",
    lengthCm: 41,
    widthCm: 20,
    heightCm: 20,
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
  assert.equal(savedPremium.deliveryFee, 37);
  assert.equal(savedPremium.oversizeFee, 7);
});
