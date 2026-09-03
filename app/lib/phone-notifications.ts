"use client";

export type PhoneNotificationState = {
  ready: boolean;
  supported: boolean;
  configured: boolean;
  subscribed: boolean;
  requiresHomeScreen: boolean;
  permission: NotificationPermission | "unsupported";
  error?: string;
};

export const initialPhoneNotificationState: PhoneNotificationState = {
  ready: false,
  supported: false,
  configured: false,
  subscribed: false,
  requiresHomeScreen: false,
  permission: "unsupported",
};

export class PhoneNotificationError extends Error {
  constructor(readonly code: "unsupported" | "home-screen" | "denied" | "unconfigured" | "failed", message: string) {
    super(message);
    this.name = "PhoneNotificationError";
  }
}

type PushConfiguration = { configured: boolean; publicKey: string; error?: string };

function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp(): boolean {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true;
}

function capabilities(): Pick<PhoneNotificationState, "supported" | "requiresHomeScreen" | "permission"> {
  const requiresHomeScreen = isIosDevice() && !isStandaloneApp();
  const supported = window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && !requiresHomeScreen;
  return {
    supported,
    requiresHomeScreen,
    permission: "Notification" in window ? Notification.permission : "unsupported",
  };
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function subscriptionPayload(subscription: PushSubscription) {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) throw new PhoneNotificationError("failed", "تعذّر قراءة مفاتيح إشعارات هذا الهاتف.");
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: encodeBase64Url(p256dh),
      auth: encodeBase64Url(auth),
    },
  };
}

function subscriptionUsesKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = decodeBase64Url(publicKey);
  const actual = new Uint8Array(current);
  return actual.byteLength === expected.byteLength && actual.every((value, index) => value === expected[index]);
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(`/api/almadina/${path}`, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...options.headers },
    });
    let payload: T & { error?: string };
    try {
      payload = await response.json() as T & { error?: string };
    } catch {
      throw new PhoneNotificationError("failed", "أعاد خادم الإشعارات استجابة غير صالحة. أعد نشر آخر نسخة من الموقع ثم حاول مجددًا.");
    }
    if (!response.ok) throw new PhoneNotificationError("failed", payload.error || "تعذّر الاتصال بخدمة إشعارات الهاتف.");
    return payload;
  } catch (error) {
    if (error instanceof PhoneNotificationError) throw error;
    throw new PhoneNotificationError("failed", "تعذّر الاتصال بخدمة إشعارات الهاتف. تحقق من الإنترنت ثم حاول مجددًا.");
  }
}

function notificationFailure(error: unknown, fallback: string): PhoneNotificationError {
  if (error instanceof PhoneNotificationError) return error;
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return new PhoneNotificationError("denied", "لم يسمح iPhone بالإشعارات. افتح إعدادات الهاتف ← الإشعارات ← المدينة إكسبرس وفعّل السماح بالإشعارات.");
    }
    if (error.name === "SecurityError") {
      return new PhoneNotificationError("unsupported", "لا يمكن تشغيل إشعارات الهاتف إلا من النسخة الآمنة المضافة إلى الشاشة الرئيسية.");
    }
    if (error.name === "AbortError" || error.name === "InvalidStateError") {
      return new PhoneNotificationError("failed", "لم يكتمل تشغيل خدمة الإشعارات على هذا الهاتف. أغلق التطبيق وافتحه من أيقونة الشاشة الرئيسية ثم حاول مجددًا.");
    }
  }
  return new PhoneNotificationError("failed", fallback);
}

function readyRegistration(timeoutMs = 15_000): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new PhoneNotificationError("failed", "استغرق تشغيل خدمة الإشعارات وقتًا طويلًا. أغلق التطبيق وافتحه من أيقونة الشاشة الرئيسية ثم حاول مجددًا."));
    }, timeoutMs);
    void navigator.serviceWorker.ready.then((worker) => {
      window.clearTimeout(timer);
      resolve(worker);
    }, (error: unknown) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

async function registration(): Promise<ServiceWorkerRegistration> {
  try {
    await navigator.serviceWorker.register("/almadina-sw.js?v=31", {
      scope: "/",
      updateViaCache: "none",
    });
    return await readyRegistration();
  } catch (error) {
    throw notificationFailure(error, "تعذّر تشغيل ملف إشعارات الهاتف. أعد نشر آخر نسخة من الموقع ثم افتح التطبيق من جديد.");
  }
}

async function configuration(): Promise<PushConfiguration> {
  const config = await api<PushConfiguration>("push/config");
  if (!config.configured || !config.publicKey) {
    throw new PhoneNotificationError("unconfigured", "خدمة إشعارات الهاتف غير مفعّلة على الخادم.");
  }
  return config;
}

function requireCapabilities(): Pick<PhoneNotificationState, "supported" | "requiresHomeScreen" | "permission"> {
  const current = capabilities();
  if (current.requiresHomeScreen) {
    throw new PhoneNotificationError("home-screen", "على iPhone: أضف الموقع إلى الشاشة الرئيسية، ثم افتحه من الأيقونة وفعّل الإشعارات.");
  }
  if (!current.supported) {
    throw new PhoneNotificationError("unsupported", "هذا المتصفح لا يدعم إشعارات الهاتف. استخدم Safari على iPhone أو Chrome على Android.");
  }
  return current;
}

export async function inspectPhoneNotifications(syncCurrentAccount = true): Promise<PhoneNotificationState> {
  const current = capabilities();
  if (!current.supported) return { ...initialPhoneNotificationState, ...current, ready: true };

  try {
    const worker = await registration();
    const config = await configuration();
    let subscription = await worker.pushManager.getSubscription();
    if (subscription && !subscriptionUsesKey(subscription, config.publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (syncCurrentAccount && current.permission === "granted" && subscription) {
      await api("push/subscribe", { method: "POST", body: JSON.stringify(subscriptionPayload(subscription)) });
    }
    return {
      ready: true,
      supported: true,
      configured: true,
      subscribed: Boolean(subscription && current.permission === "granted"),
      requiresHomeScreen: false,
      permission: Notification.permission,
    };
  } catch (error) {
    const failure = notificationFailure(error, "تعذّر التحقق من خدمة إشعارات الهاتف.");
    return {
      ready: true,
      supported: true,
      configured: false,
      subscribed: false,
      requiresHomeScreen: false,
      permission: Notification.permission,
      error: failure.message,
    };
  }
}

export async function enablePhoneNotifications(): Promise<PhoneNotificationState> {
  requireCapabilities();
  // iOS requires the permission prompt to be opened directly from the user's
  // tap. Do this before any network or service-worker await so WebKit keeps the
  // transient user activation for the prompt.
  let permission: NotificationPermission;
  try {
    permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
  } catch (error) {
    throw notificationFailure(error, "تعذّر فتح طلب إذن الإشعارات على هذا الهاتف. افتح التطبيق من أيقونة الشاشة الرئيسية ثم حاول مجددًا.");
  }
  if (permission !== "granted") {
    throw new PhoneNotificationError("denied", "لم يتم السماح بالإشعارات. فعّل الإذن من إعدادات الهاتف أو المتصفح ثم حاول مجددًا.");
  }

  try {
    const [worker, config] = await Promise.all([registration(), configuration()]);
    let subscription = await worker.pushManager.getSubscription();
    if (subscription && !subscriptionUsesKey(subscription, config.publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toArrayBuffer(decodeBase64Url(config.publicKey)),
    });
    await api("push/subscribe", { method: "POST", body: JSON.stringify(subscriptionPayload(subscription)) });
  } catch (error) {
    throw notificationFailure(error, "تعذّر ربط هذا الهاتف بخدمة الإشعارات. أغلق التطبيق وافتحه من أيقونة الشاشة الرئيسية ثم حاول مجددًا.");
  }
  return {
    ready: true,
    supported: true,
    configured: true,
    subscribed: true,
    requiresHomeScreen: false,
    permission: "granted",
  };
}

export async function disablePhoneNotifications(): Promise<PhoneNotificationState> {
  const current = requireCapabilities();
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription();
  await api("push/unsubscribe", {
    method: "POST",
    body: JSON.stringify(subscription ? { endpoint: subscription.endpoint } : {}),
  });
  if (subscription) await subscription.unsubscribe();
  return {
    ready: true,
    supported: true,
    configured: true,
    subscribed: false,
    requiresHomeScreen: false,
    permission: current.permission,
  };
}

export async function sendPhoneNotificationTest(): Promise<void> {
  requireCapabilities();
  await api("push/test", { method: "POST", body: "{}" });
}
