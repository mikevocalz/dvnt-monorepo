"use client";
/**
 * BottomSheet (web) — a real draggable bottom sheet, the Law-3 web translation
 * of the native detachable sheet. Centered and width-capped (max-w-3xl by
 * default), it slides up on open and is dismissable by dragging the grab handle
 * down past a threshold (snaps back open otherwise). Closes on scrim tap, the ✕,
 * or Escape; body scroll locks while open.
 *
 * Rendered through a PORTAL to <body> with a z-index above the floating tab bar
 * (z-1000) so it always covers the whole screen — otherwise a transformed/
 * fixed ancestor traps it and the tab bar paints on top.
 *
 * The open/slide effect keys only on `open` (onClose is read through a ref) so
 * an unstable inline onClose from the parent can't re-fire the animation on
 * every render — that was the "closes too fast" flicker.
 *
 * Drag is imperative (refs + direct transform) so it never re-renders per
 * pointer move; open/close is driven by the parent's Zustand flag, no useState.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Position the panel off-screen BEFORE the browser paints (a plain useEffect
// runs after the first paint, so the panel flashes at its resting spot for one
// frame — you'd see the dimmed page through it — before sliding up). Falls back
// to useEffect during SSR to avoid the layout-effect warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind max-width for the centered panel. Default "max-w-3xl". */
  maxWidthClass?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidthClass = "max-w-3xl",
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ startY: 0, dy: 0, dragging: false });
  // Read onClose through a ref so the open effect can depend on `open` alone —
  // an inline onClose changes identity every parent render and would otherwise
  // re-run the slide animation (the "closes too fast" flicker).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const apply = (translatePx: number, animate: boolean) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = animate
      ? "transform .34s cubic-bezier(0.22,1,0.36,1)"
      : "none";
    el.style.transform = `translateY(${translatePx}px)`;
  };

  // Slide up from fully-below on open; lock scroll + Esc-to-close. Keyed on
  // `open` only. Layout effect so the off-screen start applies pre-paint.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const h = panelRef.current?.offsetHeight || window.innerHeight;
    apply(h, false);
    const raf = requestAnimationFrame(() => apply(0, true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const close = () => onCloseRef.current();

  const dismiss = () => {
    const h = panelRef.current?.offsetHeight || window.innerHeight;
    apply(h, true);
    window.setTimeout(close, 300);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, dy: 0, dragging: true };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.dragging) return;
    let dy = e.clientY - drag.current.startY;
    if (dy < 0) dy = dy * 0.25; // rubber-band when dragged above the snap
    drag.current.dy = dy;
    apply(dy, false);
  };
  const onPointerUp = () => {
    if (!drag.current.dragging) return;
    drag.current.dragging = false;
    const h = panelRef.current?.offsetHeight || window.innerHeight;
    // Dragged down past ~30% of the sheet → dismiss; otherwise snap back open.
    if (drag.current.dy > h * 0.3) dismiss();
    else apply(0, true);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] bg-black/70"
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 left-0 right-0 mx-auto flex max-h-[92vh] w-full ${maxWidthClass} flex-col rounded-t-3xl border border-white/10 bg-[#101321] text-white shadow-2xl`}
        style={{ willChange: "transform" }}
      >
        {/* Grab handle — the drag target. touch-action:none so vertical drags
            don't get eaten by the browser's scroll gesture. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="shrink-0 cursor-grab pt-3 pb-1 active:cursor-grabbing"
          style={{ touchAction: "none" }}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" />
        </div>
        {title ? (
          <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-5 pb-3">
            <h2 className="text-base font-bold text-white">{title}</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
            >
              <X size={18} color="#fff" />
            </button>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-white/8 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
