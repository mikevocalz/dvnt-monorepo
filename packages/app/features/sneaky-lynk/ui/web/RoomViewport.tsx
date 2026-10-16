"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A room owns the visible viewport, including when the software keyboard pans
 * or shrinks it without resizing the layout viewport (mobile Safari/Chrome).
 * Updating the wrapper, rather than room state, preserves the media session.
 * Keep native browser zoom: pinch-zoom must not shrink/reflow the call itself.
 */
export function RoomViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const root = ref.current;
      if (!root || (viewport && viewport.scale !== 1)) return;
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty("--lynk-visible-height", `${height}px`);
      root.style.setProperty("--lynk-visible-top", `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-room-viewport
      className="fixed inset-x-0 top-[var(--lynk-visible-top,0px)] isolate h-[var(--lynk-visible-height,100dvh)] overflow-hidden bg-[#06070d] [&>#anticapture-wrapper]:h-full [&>#anticapture-wrapper]:min-h-0"
    >
      {children}
    </div>
  );
}
