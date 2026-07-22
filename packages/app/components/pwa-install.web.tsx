"use client";

import { useEffect, useState } from "react";
import { Share, MoreVertical, MonitorDown, Smartphone } from "lucide-react";
import { Dialog } from "@dvnt/ui";

/**
 * PWA install prompt + instructions (web only).
 *
 * <PwaInstallPrompt /> — auto-opens once per browser for every signed-in
 * user (current and future). Dismissing sets a localStorage flag; the same
 * content stays reachable from Settings → "Install the app".
 */

const DISMISS_KEY = "dvnt-pwa-install-dismissed";

// Chrome's install prompt event — captured so our Install button can fire it.
let deferredPrompt: any = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function Step({
  n,
  icon,
  children,
}: {
  n: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-white">
        {n}
      </span>
      <span className="flex items-center gap-1.5 text-sm leading-6 text-white/75">
        {children}
        {icon}
      </span>
    </li>
  );
}

/** Platform-aware add-to-home-screen instructions. Reused by the popup and settings. */
export function PwaInstallContent({ onDone }: { onDone?: () => void }) {
  const [installed, setInstalled] = useState(false);
  const ios = isIOS();

  const nativeInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      setInstalled(true);
      onDone?.();
    }
    deferredPrompt = null;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* App-icon tile — the thing you're about to put on your home screen. */}
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/12 bg-gradient-to-br from-[#34A2DF]/40 via-[#8A40CF]/30 to-[#FF5BFC]/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dvnt-logo.svg" alt="" className="h-8 w-8" />
        </span>
        <p className="text-sm leading-6 text-white/60">
          Add DVNT to your home screen and it opens full-screen like an app —
          no browser bars, one tap from your phone.
        </p>
      </div>

      {deferredPrompt && !installed ? (
        <button
          onClick={nativeInstall}
          className="rounded-xl bg-white py-3 font-semibold text-[#1f1f1f]"
        >
          Install DVNT
        </button>
      ) : null}

      {ios ? (
        <ol className="flex flex-col gap-3">
          <Step n={1} icon={<Share size={16} color="#3FDCFF" />}>
            In Safari, tap the Share button
          </Step>
          <Step n={2} icon={<Smartphone size={16} color="#3FDCFF" />}>
            Scroll down and tap “Add to Home Screen”
          </Step>
          <Step n={3}>Tap “Add” — DVNT appears with your apps</Step>
        </ol>
      ) : (
        <ol className="flex flex-col gap-3">
          <Step n={1} icon={<MoreVertical size={16} color="#3FDCFF" />}>
            In Chrome, tap the menu button
          </Step>
          <Step n={2} icon={<MonitorDown size={16} color="#3FDCFF" />}>
            Tap “Add to Home screen” (or “Install app”)
          </Step>
          <Step n={3}>Confirm — DVNT appears with your apps</Step>
        </ol>
      )}

      <p className="text-xs leading-5 text-white/40">
        You can come back to this anytime in Settings → Install the app.
      </p>
    </div>
  );
}

/** Auto popup — mount once inside the signed-in shell. */
export function PwaInstallPrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    // Small delay so it doesn't collide with the first paint.
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={dismiss} title="Use DVNT like an app">
      <PwaInstallContent onDone={dismiss} />
      <button
        onClick={dismiss}
        className="mt-4 w-full py-2 text-center text-sm font-semibold text-white/55"
      >
        Not now
      </button>
    </Dialog>
  );
}
