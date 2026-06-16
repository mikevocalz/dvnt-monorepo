"use client";

import { useEffect, type ReactNode } from "react";
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
}

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
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
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
