export type WebPushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type VapidKeyPair = {
  publicKey: string;
  privateKey: string;
};

export type WebPushMessage = {
  noticeId: string;
  title: string;
  message: string;
  url: string;
  createdAt: string;
};

export class WebPushDeliveryError extends Error {
  readonly status: number;

  constructor(status: number, message = `Web Push delivery failed with status ${status}.`) {
    super(message);
    this.name = "WebPushDeliveryError";
    this.status = status;
  }
}

const encoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, toArrayBuffer(data)));
}

async function hkdfExtract(salt: Uint8Array, inputKeyMaterial: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, inputKeyMaterial);
}

async function hkdfExpand(pseudoRandomKey: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(0);
  let generated = 0;
  for (let counter = 1; generated < length; counter += 1) {
    previous = await hmacSha256(pseudoRandomKey, concatBytes(previous, info, new Uint8Array([counter])));
    blocks.push(previous);
    generated += previous.byteLength;
  }
  return concatBytes(...blocks).slice(0, length);
}

function vapidPublicCoordinates(publicKey: Uint8Array): { x: string; y: string } {
  if (publicKey.byteLength !== 65 || publicKey[0] !== 4) throw new Error("Invalid VAPID public key.");
  return {
    x: bytesToBase64Url(publicKey.slice(1, 33)),
    y: bytesToBase64Url(publicKey.slice(33, 65)),
  };
}

async function createVapidAuthorization(endpoint: string, keys: VapidKeyPair, subject: string): Promise<string> {
  const endpointOrigin = new URL(endpoint).origin;
  const publicKey = base64UrlToBytes(keys.publicKey);
  const coordinates = vapidPublicCoordinates(publicKey);
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: coordinates.x,
      y: coordinates.y,
      d: keys.privateKey,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(encoder.encode(JSON.stringify({
    aud: endpointOrigin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));
  const unsignedToken = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    encoder.encode(unsignedToken),
  ));
  return `vapid t=${unsignedToken}.${bytesToBase64Url(signature)}, k=${keys.publicKey}`;
}

async function encryptWebPushPayload(
  subscription: WebPushSubscriptionRecord,
  message: WebPushMessage,
): Promise<Uint8Array> {
  const recipientPublicKey = base64UrlToBytes(subscription.p256dh);
  const authenticationSecret = base64UrlToBytes(subscription.auth);
  if (recipientPublicKey.byteLength !== 65 || recipientPublicKey[0] !== 4) throw new Error("Invalid subscription public key.");
  if (authenticationSecret.byteLength < 16) throw new Error("Invalid subscription authentication secret.");

  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const recipientKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(recipientPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientKey },
    serverKeys.privateKey,
    256,
  ));
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));

  const authenticationPrk = await hkdfExtract(authenticationSecret, sharedSecret);
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info\0"),
    recipientPublicKey,
    serverPublicKey,
  );
  const inputKeyMaterial = await hkdfExpand(authenticationPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentPrk = await hkdfExtract(salt, inputKeyMaterial);
  const contentEncryptionKey = await hkdfExpand(contentPrk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(contentPrk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const plaintext = concatBytes(encoder.encode(JSON.stringify(message)), new Uint8Array([2]));
  const recordSize = 4096;
  if (plaintext.byteLength + 16 > recordSize) throw new Error("Web Push message is too large.");

  const encryptionKey = await crypto.subtle.importKey("raw", toArrayBuffer(contentEncryptionKey), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
    encryptionKey,
    toArrayBuffer(plaintext),
  ));

  const header = new Uint8Array(21 + serverPublicKey.byteLength);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = serverPublicKey.byteLength;
  header.set(serverPublicKey, 21);
  return concatBytes(header, ciphertext);
}

export async function generateVapidKeyPair(): Promise<VapidKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  if (!privateKey.d) throw new Error("Could not export the VAPID private key.");
  return { publicKey: bytesToBase64Url(publicKey), privateKey: privateKey.d };
}

export async function sendWebPushNotification(
  subscription: WebPushSubscriptionRecord,
  message: WebPushMessage,
  keys: VapidKeyPair,
  subject: string,
): Promise<void> {
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Web Push endpoint must use HTTPS.");
  const body = await encryptWebPushPayload(subscription, message);
  const authorization = await createVapidAuthorization(endpoint.href, keys, subject);
  const response = await fetch(endpoint.href, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body: toArrayBuffer(body),
  });
  if (!response.ok) throw new WebPushDeliveryError(response.status);
}
