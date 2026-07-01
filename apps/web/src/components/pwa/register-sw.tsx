"use client";

import { useEffect } from "react";
import { usePwaStore } from "./pwa-store";

/**
 * Register /sw.js + hydrate the PWA store. Mount once near the root.
 *
 * No-op outside a browser; safe in App Router during prerender.
 */
export function RegisterSW(): null {
  const hydrate = usePwaStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Production-only — dev SW registration interferes with Next's HMR.
    if (process.env.NODE_ENV !== "production") return;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.warn("[pwa] sw register failed", err);
      });
  }, [hydrate]);

  return null;
}
