/* DVNT web push service worker. Payload shape mirrors send_notification:
   { title, body, data: { url? , type?, entityType?, entityId? } } */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'DVNT', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'DVNT';
  const options = {
    body: payload.body || '',
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
    data: payload.data || {},
    tag: payload.data && payload.data.tag ? payload.data.tag : undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/feed/activity';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
