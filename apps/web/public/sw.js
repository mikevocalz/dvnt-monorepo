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
  // call_signals.id is a positive integer. Accept its JSON number/string forms,
  // never an arbitrary PostgREST filter from push data.
  if (typeof signalId === "number") {
    if (!Number.isSafeInteger(signalId) || signalId <= 0) return;
    signalId = String(signalId);
  }
  if (typeof signalId !== "string" || !/^[1-9]\d{0,18}$/.test(signalId)) return;
  try {
    // Static public assets do not receive Next environment substitution. Get
    // the validated public pair from this deployment, with no fallback/cache.
    const response = await fetch("/api/pwa/backend", {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return;
    const { supabaseUrl, supabaseAnonKey } = await response.json();
    const backend = new URL(supabaseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname);
    if (backend.origin !== supabaseUrl ||
        (backend.protocol !== "https:" && !(backend.protocol === "http:" && local)) ||
        typeof supabaseAnonKey !== "string" || !supabaseAnonKey ||
        supabaseAnonKey !== supabaseAnonKey.trim()) return;
    await fetch(`${backend.origin}/rest/v1/call_signals?id=eq.${encodeURIComponent(signalId)}`, {
      method: "PATCH",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ status: "declined" }),
    });
  } catch { /* Missing/invalid configuration must never fall back to production. */ }
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
