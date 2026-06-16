"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Which edge the panel anchors to. Default "right". */
  side?: "right" | "left" | "bottom";
  /** Panel width (right/left) or height (bottom), px. Default 420 / 70vh. */
  size?: number;
  hideClose?: boolean;
}

/**
 * Edge-anchored drawer (web) — the Law-3 translation of a native detachable /
 * side sheet (e.g. filters, edit popovers). For a centered modal use `Dialog`.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = "right",
  size,
  hideClose,
}: DrawerProps) {
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

  const isBottom = side === "bottom";
  const panelStyle: React.CSSProperties = isBottom
    ? { left: 0, right: 0, bottom: 0, height: size ?? undefined, maxHeight: "85vh" }
    : side === "left"
      ? { left: 0, top: 0, bottom: 0, width: size ?? 420, maxWidth: "92vw" }
      : { right: 0, top: 0, bottom: 0, width: size ?? 420, maxWidth: "92vw" };

  const radius = isBottom
    ? "rounded-t-3xl"
    : side === "left"
      ? "rounded-r-3xl"
      : "rounded-l-3xl";

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`absolute flex flex-col ${radius} border border-white/10 bg-[#101321] shadow-2xl`}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {title || !hideClose ? (
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
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
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="px-5 py-4 border-t border-white/8 shrink-0 flex items-center justify-end gap-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
