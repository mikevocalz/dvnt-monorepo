"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";

const VIDEO_RE = /post-video|flyer-video|\.(mp4|mov|webm)(\?|$)/i;

/**
 * Fullscreen media lightbox (web). Mount once per screen; it reads the shared
 * lightbox store. Esc / arrow keys, click-away, prev/next, video with controls.
 *
 * Portaled to <body> (like the story viewer overlay) so the `fixed inset-0`
 * cover escapes the app shell's stacking context — the shell uses
 * backdrop-filter / transforms, which would otherwise make `fixed` resolve
 * against the shell column instead of the viewport and stop the viewer from
 * covering the whole screen.
 */
export function Lightbox() {
  const open = useLightboxStore((s) => s.open);
  const items = useLightboxStore((s) => s.items);
  const index = useLightboxStore((s) => s.index);
  const close = useLightboxStore((s) => s.close);
  const next = useLightboxStore((s) => s.next);
  const prev = useLightboxStore((s) => s.prev);

  // Portal target only exists on the client; gate the portal until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
      else if (ev.key === "ArrowRight") next();
      else if (ev.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, next, prev]);

  if (!mounted || !open || items.length === 0) return null;
  const item = items[Math.min(index, items.length - 1)];
  if (!item) return null;
  const isVideo = item.type === "video" || VIDEO_RE.test(item.url);
  const multi = items.length > 1;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // Portal to <body> so the overlay sits above the entire app and the
  // full-screen cover is measured against the viewport, not the app shell.
  return createPortal(
    <div
      className="fixed inset-0 z-[2000] bg-black flex items-center justify-center"
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      {/* Liquid glass close button — mirrors the story viewer overlay. */}
      <button
        onClick={(e) => {
          stop(e);
          close();
        }}
        aria-label="Close"
        className="absolute right-4 z-10 w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 border border-white/20"
        style={{
          top: "calc(env(safe-area-inset-top) + 14px)",
          background: "rgba(255,255,255,0.12)",
          backdropFilter: "saturate(160%) blur(18px)",
          WebkitBackdropFilter: "saturate(160%) blur(18px)",
        }}
      >
        <X size={20} color="#fff" />
      </button>
      {multi ? (
        <span
          className="absolute left-1/2 -translate-x-1/2 text-white/80 text-sm font-medium"
          style={{ top: "calc(env(safe-area-inset-top) + 22px)" }}
        >
          {index + 1} / {items.length}
        </span>
      ) : null}

      {isVideo ? (
        <video
          key={item.url}
          src={item.url}
          poster={item.poster}
          controls
          autoPlay
          playsInline
          onClick={stop}
          className="max-w-[100vw] max-h-dvh bg-black"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt=""
          onClick={stop}
          className="w-screen h-dvh object-contain"
        />
      )}

      {multi ? (
        <>
          <button
            onClick={(e) => {
              stop(e);
              prev();
            }}
            disabled={index === 0}
            aria-label="Previous"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center disabled:opacity-30"
          >
            <ChevronLeft size={24} color="#fff" />
          </button>
          <button
            onClick={(e) => {
              stop(e);
              next();
            }}
            disabled={index === items.length - 1}
            aria-label="Next"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center disabled:opacity-30"
          >
            <ChevronRight size={24} color="#fff" />
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
