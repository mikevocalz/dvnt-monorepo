"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** The browser top layer sits above sticky app chrome and transformed parents. */
export function AvatarLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const closeForNavigation = () => closeRef.current();
    window.addEventListener("popstate", closeForNavigation);
    return () => {
      window.removeEventListener("popstate", closeForNavigation);
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={dialogRef} aria-label="Profile picture" aria-modal="true"
      onKeyDown={(event) => {
        // The close button is the only interactive element. Keep keyboard focus
        // in the modal rather than cycling into the browser chrome.
        if (event.key === "Tab") {
          event.preventDefault();
          dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
      onClick={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none border-0 bg-black/95 text-white outline-none backdrop:bg-black/95"
      style={{ padding: "max(64px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left))" }}>
      <div className="pointer-events-none flex h-full w-full items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Profile picture" className="pointer-events-auto max-h-full max-w-full object-contain" />
      </div>
      <button type="button" autoFocus onClick={() => closeRef.current()} aria-label="Close profile picture"
        className="absolute flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        style={{ top: "calc(env(safe-area-inset-top) + 12px)", right: "calc(env(safe-area-inset-right) + 12px)" }}>
        <X size={22} aria-hidden="true" />
      </button>
    </dialog>, document.body,
  );
}
