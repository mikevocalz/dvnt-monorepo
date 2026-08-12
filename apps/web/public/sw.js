// DVNT service worker — PWA install criteria + Web Push (generic +
// incoming-call ringing while the tab is backgrounded/closed).
//
// This is the ONLY service worker file the app registers. It replaces the
// former split between sw.js (PWA shell) and push-sw.js (push handling) —
// two registrations at the same scope ("/") fight over which script
// controls the page, so they're merged here.
//
// What this does:
//   - Take control of clients ASAP so the very first visit after install
//     is already SW-managed.
//   - Pass-through fetch — no caching strategy yet.
//   - Forward `push` events to the Notifications API. For call pushes
//     (data.type === "call"), show Accept/Decline actions.
//   - notificationclick: call pushes route to the call room (or PATCH
//     call_signals to "declined" for the decline action); everything else
//     focuses/opens data.url.

const SUPABASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";
// Public anon key, RLS-protected — same key already shipped in the client
// bundle (packages/supabase/src/client.web.ts). call_signals RLS grants
// anon full read/write (Better Auth never uses Supabase Auth sessions), so
// this SW can PATCH a decline without a user JWT.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmphbnh0dXJ2bWp5ZXZveWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MjA0MjMsImV4cCI6MjA4Mzk5NjQyM30.v88MMGqv2db8hn8llr5aToKbKUDOHz-AxZbZYA5RLGM";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no-op — the SW only exists to satisfy the PWA install
  // criterion + carry push. Precaching is separate, unstarted work.
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "DVNT", body: event.data ? event.data.text() : "" };
  }
  const data = payload.data || {};
  const isCall = data.type === "call";

  const title = payload.title || "DVNT";
  const options = {
    body: payload.body || "",
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    tag: data.tag || (isCall ? `call-${data.roomId}` : undefined),
    data,
    requireInteraction: isCall,
    actions: isCall
      ? [
          { action: "accept", title: "Accept" },
          { action: "decline", title: "Decline" },
        ]
      : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

async function declineCallSignal(signalId) {
  if (!signalId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/call_signals?id=eq.${signalId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ status: "declined" }),
  }).catch(() => {});
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (event.action === "decline") {
    event.waitUntil(declineCallSignal(data.signalId));
    return;
  }

  const target =
    data.type === "call" && data.roomId ? `/feed/call/${data.roomId}` : data.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if ("navigate" in client) client.navigate(target);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      }),
  );
});
