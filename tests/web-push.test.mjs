import assert from "node:assert/strict";
import test from "node:test";
import { generateVapidKeyPair, sendWebPushNotification } from "../app/lib/web-push.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64Url(value) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function hmac(key, data) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

async function expand(key, info, length) {
  const blocks = [];
  let previous = new Uint8Array();
  for (let counter = 1; blocks.reduce((size, block) => size + block.byteLength, 0) < length; counter += 1) {
    previous = await hmac(key, concat(previous, info, new Uint8Array([counter])));
    blocks.push(previous);
  }
  return concat(...blocks).slice(0, length);
}

test("encrypts a standards-compatible Web Push payload and signs it with VAPID", async () => {
  const recipient = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const recipientPublic = new Uint8Array(await crypto.subtle.exportKey("raw", recipient.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const subscription = {
    endpoint: "https://push.example.test/send/test-subscription",
    p256dh: base64Url(recipientPublic),
    auth: base64Url(authSecret),
  };
  const message = {
    noticeId: "notice-test",
    title: "اختبار الإشعارات",
    message: "وصل إشعار المدينة إكسبرس.",
    url: "/?openNotifications=1",
    createdAt: "2026-09-03T12:00:00.000Z",
  };
  const vapidKeys = await generateVapidKeyPair();
  assert.equal(decodeBase64Url(vapidKeys.publicKey).byteLength, 65);
  assert.equal(decodeBase64Url(vapidKeys.privateKey).byteLength, 32);

  const originalFetch = globalThis.fetch;
  let captured;
  try {
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return new Response(null, { status: 201 });
    };
    await sendWebPushNotification(subscription, message, vapidKeys, "https://almadina-express.onrender.com");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(captured.url, subscription.endpoint);
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(captured.init.headers.TTL, "86400");
  assert.match(captured.init.headers.Authorization, /^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);

  const authorization = captured.init.headers.Authorization;
  const token = authorization.match(/^vapid t=([^,]+), k=(.+)$/)[1];
  const advertisedKey = authorization.match(/^vapid t=([^,]+), k=(.+)$/)[2];
  assert.equal(advertisedKey, vapidKeys.publicKey);
  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  assert.deepEqual(JSON.parse(decoder.decode(decodeBase64Url(encodedHeader))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(decoder.decode(decodeBase64Url(encodedClaims)));
  assert.equal(claims.aud, "https://push.example.test");
  assert.equal(claims.sub, "https://almadina-express.onrender.com");
  const vapidPublic = await crypto.subtle.importKey(
    "raw",
    decodeBase64Url(vapidKeys.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  assert.equal(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    vapidPublic,
    decodeBase64Url(encodedSignature),
    encoder.encode(`${encodedHeader}.${encodedClaims}`),
  ), true);

  const body = new Uint8Array(captured.init.body);
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(16, false), 4096);
  const senderKeyLength = body[20];
  assert.equal(senderKeyLength, 65);
  const senderPublic = body.slice(21, 21 + senderKeyLength);
  const ciphertext = body.slice(21 + senderKeyLength);
  const importedSender = await crypto.subtle.importKey(
    "raw",
    senderPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: importedSender },
    recipient.privateKey,
    256,
  ));
  const authPrk = await hmac(authSecret, sharedSecret);
  const inputKeyMaterial = await expand(
    authPrk,
    concat(encoder.encode("WebPush: info\0"), recipientPublic, senderPublic),
    32,
  );
  const contentPrk = await hmac(salt, inputKeyMaterial);
  const contentEncryptionKey = await expand(contentPrk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await expand(contentPrk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const decryptionKey = await crypto.subtle.importKey("raw", contentEncryptionKey, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    decryptionKey,
    ciphertext,
  ));
  assert.equal(plaintext.at(-1), 2);
  assert.deepEqual(JSON.parse(decoder.decode(plaintext.slice(0, -1))), message);
});
