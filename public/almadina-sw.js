/* Almadina Express Web Push service worker. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title
    ? payload.title
    : "المدينة إكسبرس";
  const body = typeof payload.message === "string" && payload.message
    ? payload.message
    : "لديك إشعار جديد.";
  const noticeId = typeof payload.noticeId === "string" && payload.noticeId
    ? payload.noticeId
    : `almadina-${Date.now()}`;
  const url = typeof payload.url === "string" && payload.url.startsWith("/")
    ? payload.url
    : "/?openNotifications=1";

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ type: "almadina-push-received", noticeId });
    }
    if (windows.some((client) => client.visibilityState === "visible")) return;

    await self.registration.showNotification(title, {
      body,
      icon: "/almadina-mark.svg",
      badge: "/almadina-mark.svg",
      tag: noticeId,
      renotify: true,
      dir: "rtl",
      lang: "ar",
      vibrate: [180, 90, 180],
      timestamp: Date.parse(payload.createdAt) || Date.now(),
      data: { url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedPath = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : "/?openNotifications=1";
  const destination = new URL(requestedPath, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client) await client.navigate(destination);
      await client.focus();
      return;
    }
    await self.clients.openWindow(destination);
  })());
});
