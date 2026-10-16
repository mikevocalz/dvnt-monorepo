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
      // AntiCapture also renders a notice sibling. Let it reserve space rather
      // than adding its height on top of a full-height room and clipping the dock.
      className="fixed inset-x-0 top-[var(--lynk-visible-top,0px)] isolate flex h-[var(--lynk-visible-height,100dvh)] flex-col overflow-hidden bg-[#06070d] [&>#anticapture-wrapper]:min-h-0 [&>#anticapture-wrapper]:flex-1 [&>[class*='alert-anticapture'][style*='block']~#anticapture-wrapper]:[--lynk-safe-top:0px] [&>[class*='alert-anticapture']]:shrink-0 [&>[class*='alert-anticapture']]:bg-amber-950 [&>[class*='alert-anticapture']]:pb-1 [&>[class*='alert-anticapture']]:pt-[max(4px,env(safe-area-inset-top))] [&>[class*='alert-anticapture']]:pl-[max(8px,env(safe-area-inset-left))] [&>[class*='alert-anticapture']]:pr-[max(8px,env(safe-area-inset-right))] [&>[class*='alert-anticapture']]:text-xs [&>[class*='alert-anticapture']>p]:text-amber-100"
    >
      {children}
    </div>
  );
}
