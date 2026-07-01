"use client";

import { usePwaStore } from "./pwa-store";

/**
 * Install funnel — gates iOS Web Push + camera + WebRTC (C2).
 *
 *   - Android (Chromium): renders an Install button that fires the
 *     captured `beforeinstallprompt` event.
 *   - iOS Safari: there is no install API. We render guided
 *     Share→Add-to-Home-Screen instructions instead.
 *   - Anywhere already installed (standalone display-mode): renders
 *     nothing.
 *   - Desktop / other: renders nothing.
 *
 * Drop into the routes that gate first-Lynk-session entry. The component
 * does NOT decide WHEN to show — the caller does. (Verification flow
 * mounts it post-onboarding per the funnel order C2 names.)
 */
export function InstallFunnel(): React.JSX.Element | null {
  const platform = usePwaStore((s) => s.platform);
  const isStandalone = usePwaStore((s) => s.isStandalone);
  const deferredPrompt = usePwaStore((s) => s.deferredPrompt);
  const promptInstall = usePwaStore((s) => s.promptInstall);
  const hydrated = usePwaStore((s) => s.hydrated);

  if (!hydrated) return null;
  if (isStandalone) return null;

  if (platform === "android" && deferredPrompt) {
    return (
      <button
        type="button"
        onClick={() => {
          void promptInstall();
        }}
        className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-900/30 hover:bg-rose-500"
      >
        Install DVNT
      </button>
    );
  }

  if (platform === "ios") {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/60 p-5 text-sm text-white/90 backdrop-blur">
        <div className="font-semibold text-white">Add DVNT to your Home Screen</div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-white/80">
          <li>
            Tap the <span aria-label="Share" className="inline-block">Share</span>{" "}
            button in Safari (square with an arrow).
          </li>
          <li>
            Scroll and choose <span className="font-semibold">Add to Home Screen</span>.
          </li>
          <li>
            Open <span className="font-semibold">DVNT</span> from your Home Screen — then
            verification + Lynk will be available.
          </li>
        </ol>
        <p className="mt-3 text-xs text-white/60">
          iOS requires this once. Camera, notifications, and Lynk video chat won&rsquo;t
          turn on in Safari proper.
        </p>
      </div>
    );
  }

  return null;
}
