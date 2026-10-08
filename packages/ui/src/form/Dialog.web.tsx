"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Header title. */
  title?: string;
  /** Body content. */
  children: ReactNode;
  /** Optional footer (actions). */
  footer?: ReactNode;
  /** Max width of the panel (px). Default 520. */
  maxWidth?: number;
  /** Hide the default close (X) button. */
  hideClose?: boolean;
  /** id of the element that names the dialog, when there is no `title`. */
  labelledBy?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Centered modal dialog (web) — the Law-3 translation of a native bottom sheet
 * used for confirmations / compact forms. Esc + backdrop close, scroll-lock,
 * safe-area aware. For an edge-anchored panel use `Drawer`.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 520,
  hideClose,
  labelledBy,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Held in a ref so a parent passing a fresh onClose each render does not
  // re-run the effect and bounce focus.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    // Focus moves into the dialog ([data-autofocus] first, else the first
    // control), Tab stays inside it, and focus returns to the opener on close.
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const initial =
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0];
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : title}
    >
      <div
        ref={panelRef}
        className="w-full max-h-[88vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#101321] shadow-2xl"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {title || !hideClose ? (
          <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-white/8 bg-[#101321]/95 backdrop-blur">
            <h2 className="text-base font-bold text-white">{title}</h2>
            {!hideClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
              >
                <X size={18} color="#fff" />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="sticky bottom-0 px-5 py-4 border-t border-white/8 bg-[#101321]/95 backdrop-blur flex items-center justify-end gap-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
