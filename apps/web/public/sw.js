// DVNT service worker — minimum surface required for iOS PWA install
// criteria + a future Web Push subscription.
//
// Failure mode defended against: shipping a "smart" SW too early (offline
// shells, aggressive precache) makes the install-to-camera funnel break in
// ways nobody can diagnose mid-Lynk session. Keep it dumb until the funnel
// is verified end-to-end on a real iOS device.
//
// What this does:
//   - Take control of clients ASAP so the very first visit after install
//     is already SW-managed.
//   - Pass-through fetch — no caching strategy yet. The PWA shell still
//     installs because iOS only checks for SW registration, not behavior.
//   - Forward `push` events to the Notifications API. The push payload
//     shape is owned by the server (D6/D7); this side is permissive.

self.addEventListener("install", (event) => {
  // Activate immediately on first install; subsequent updates use the
  // standard waitUntil/skipWaiting chain so the user keeps the current
  // version until the tab closes.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Intentionally no-op. Adding precache here is D5+ work; the SW only
  // exists today to satisfy the install criterion + carry push.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: "DVNT", body: event.data?.text?.() ?? "" };
  }
  const title = data.title ?? "DVNT";
  const opts = {
    body: data.body ?? "",
    icon: data.icon ?? "/dvnt-email-glyph.png",
    badge: data.badge ?? "/dvnt-email-glyph.png",
    tag: data.tag,
    data: { url: data.url ?? "/" },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // Focus an existing tab on the same origin if we have one.
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      }),
  );
});
