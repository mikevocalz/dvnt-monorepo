/**
 * Web push registration (PWA/browser) — the web counterpart of
 * lib/notifications.ts. Subscriptions land in the SAME push_tokens table
 * (platform 'web', token = JSON-encoded PushSubscription) that
 * send_notification already reads; the edge fn sends via Web Push.
 * Web-only module: guarded, safe to import anywhere.
 */
import { supabase } from "@dvnt/app/lib/supabase/client";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";

// VAPID public key — public by design (it's sent to the push service).
export const VAPID_PUBLIC_KEY =
  "BDVF8GWeLW5VQG-ydqNH_cailCDC_Vvb0GNK4HOol95ZpqmGQFc9IAUSa0MB0EgzU_fmwsDNwgzwc4HGH33YjFA";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function webPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function webPushPermission(): NotificationPermission | "unsupported" {
  return webPushSupported() ? Notification.permission : "unsupported";
}

async function saveSubscription(sub: PushSubscription): Promise<boolean> {
  const intId = getCurrentUserIdSync();
  if (!intId) return false;
  const { error } = await supabase.from("push_tokens").upsert(
    {
      user_id: intId,
      token: JSON.stringify(sub.toJSON()),
      platform: "web",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,token" },
  );
  if (error) console.warn("[WebPush] save failed:", error.message);
  return !error;
}

async function subscribe(): Promise<boolean> {
  const reg = await navigator.serviceWorker.register("/push-sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));
  return saveSubscription(sub);
}

/** Silent path: (re)registers on app load when permission is ALREADY granted. */
export async function registerWebPushIfGranted(): Promise<void> {
  try {
    if (!webPushSupported() || Notification.permission !== "granted") return;
    await subscribe();
  } catch (error) {
    console.warn("[WebPush] silent register failed:", error);
  }
}

/** User-gesture path: settings button — prompts, subscribes, saves. */
export async function enableWebPush(): Promise<
  "granted" | "denied" | "unsupported" | "error"
> {
  if (!webPushSupported()) return "unsupported";
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
    const ok = await subscribe();
    return ok ? "granted" : "error";
  } catch (error) {
    console.warn("[WebPush] enable failed:", error);
    return "error";
  }
}
