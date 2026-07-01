"use client";

import { create } from "zustand";

/**
 * PWA install-funnel state. Zustand only — per the project rule that app
 * state never lives in useState. The captured `beforeinstallprompt` event
 * is held here as an opaque ref so any component can call `.prompt()`
 * without re-listening for the (one-shot) browser event.
 */

export type PwaPlatform = "android" | "ios" | "other";

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type PwaState = {
  platform: PwaPlatform;
  isStandalone: boolean;
  // Android only — set when beforeinstallprompt fires.
  deferredPrompt: BeforeInstallPromptEvent | null;
  hydrated: boolean;

  hydrate(): void;
  // Returns true if the user accepted, false otherwise (incl. iOS where we
  // can't programmatically install — caller should show the guided overlay).
  promptInstall(): Promise<boolean>;
};

function detectPlatform(): PwaPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  // iOS Safari + iPadOS-as-desktop UA.
  if (/iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Android/.test(ua)) return "android";
  return "other";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari pre-16.4 only exposes navigator.standalone.
  if ((window.navigator as any).standalone === true) return true;
  return false;
}

export const usePwaStore = create<PwaState>((set, get) => ({
  platform: "other",
  isStandalone: false,
  deferredPrompt: null,
  hydrated: false,

  hydrate(): void {
    if (typeof window === "undefined" || get().hydrated) return;
    set({
      platform: detectPlatform(),
      isStandalone: detectStandalone(),
      hydrated: true,
    });

    // Capture the Android install prompt so the UI can fire it on demand.
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      set({ deferredPrompt: e as BeforeInstallPromptEvent });
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    const onInstalled = () => {
      set({ deferredPrompt: null, isStandalone: true });
    };
    window.addEventListener("appinstalled", onInstalled);

    // Display-mode flips when the user opens the installed PWA from the
    // home screen mid-session (rare but real).
    const mql = window.matchMedia("(display-mode: standalone)");
    const onModeChange = (ev: MediaQueryListEvent) => {
      set({ isStandalone: ev.matches });
    };
    if (mql.addEventListener) mql.addEventListener("change", onModeChange);
    else mql.addListener(onModeChange);
  },

  async promptInstall(): Promise<boolean> {
    const evt = get().deferredPrompt;
    if (!evt) return false;
    await evt.prompt();
    const choice = await evt.userChoice;
    set({ deferredPrompt: null });
    return choice.outcome === "accepted";
  },
}));
