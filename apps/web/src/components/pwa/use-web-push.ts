"use client";

import { useCallback, useState } from "react";
import { usePwaStore } from "./pwa-store";

/**
 * Web Push subscription — gated on installed PWA per iOS 16.4+ rules.
 *
 *   On iOS, `Notification.requestPermission()` from a Safari tab silently
 *   resolves "denied" — the permission only exists once the app runs in
 *   standalone (display-mode). Calling this without the install gate is
 *   the #1 cause of a "I clicked yes but nothing happened" bug report
 *   that we won't reproduce on Android.
 *
 *   We DO NOT POST the subscription to a server here — that endpoint
 *   lands with D6/D7 (notification token sync). Caller decides when to
 *   actually subscribe by reading `canSubscribe`.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

export type WebPushState = {
  canSubscribe: boolean;
  subscription: PushSubscription | null;
  subscribing: boolean;
  error: string | null;
  subscribe(): Promise<PushSubscription | null>;
};

export function useWebPush(): WebPushState {
  const isStandalone = usePwaStore((s) => s.isStandalone);
  const platform = usePwaStore((s) => s.platform);

  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // canSubscribe is false on iOS Safari (non-standalone) — the OS will not
  // grant permission and we don't want to surface a button that does nothing.
  const canSubscribe = (() => {
    if (typeof window === "undefined") return false;
    if (!("Notification" in window)) return false;
    if (!("serviceWorker" in navigator)) return false;
    if (!("PushManager" in window)) return false;
    if (platform === "ios" && !isStandalone) return false;
    if (!VAPID_PUBLIC_KEY) return false;
    return true;
  })();

  const subscribe = useCallback(async (): Promise<PushSubscription | null> => {
    if (!canSubscribe) return null;
    setSubscribing(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setError(`permission-${perm}`);
        return null;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      setSubscription(sub);
      return sub;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSubscribing(false);
    }
  }, [canSubscribe]);

  return { canSubscribe, subscription, subscribing, error, subscribe };
}
