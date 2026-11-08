"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import Logo from "@dvnt/app/components/logo.web";
import type { SecureCaptureBlackoutReason } from "./useSecureCaptureGuard";

export function SneakyLynkBlackoutOverlay({
  reason,
  onReturn,
}: {
  reason: SecureCaptureBlackoutReason;
  onReturn: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const active = reason !== null;

  useLayoutEffect(() => {
    if (!active) return;
    const content = hostRef.current?.parentElement?.querySelector<HTMLElement>("[data-secure-capture-content]");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const wasInert = content?.inert ?? false;
    if (content) content.inert = true;
    const focusReturn = () => returnRef.current?.focus({ preventScroll: true });
    focusReturn();
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !hostRef.current?.contains(event.target)) focusReturn();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Tab") focusReturn();
    };
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (content) content.inert = wasInert;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [active]);

  // Keep this host outside the content's inert subtree and present before any
  // SidePanel opens. Its dialog remains above the panel without remounting media.
  return (
    <div ref={hostRef} data-secure-capture-overlay-root className="contents">
      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-secure-capture-blackout={reason}
          className="absolute inset-0 z-[80] overflow-hidden bg-[#05060b] text-center"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -inset-24 rotate-[-24deg] opacity-[0.07]">
              <div className="grid grid-cols-3 gap-16">
                {Array.from({ length: 18 }).map((_, index) => (
                  <Logo key={index} width={220} height={84} className="drop-shadow-[0_0_18px_rgba(63,220,255,0.35)]" />
                ))}
              </div>
            </div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(63,220,255,0.12),transparent_34%),linear-gradient(135deg,rgba(138,64,207,0.14),transparent_42%,rgba(252,37,58,0.08))]" />
          </div>
          <div data-secure-capture-blackout-scroll className="absolute inset-0 overflow-y-auto overscroll-contain">
            <div className="flex min-h-full flex-col items-center pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pt-[max(16px,env(safe-area-inset-top))]">
              <div className="relative my-auto w-full max-w-sm shrink-0 rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl">
                <Logo width={148} height={57} className="mx-auto mb-5 opacity-90 drop-shadow-[0_0_18px_rgba(63,220,255,0.45)]" />
                <span aria-hidden="true" className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FC253A]/20 text-[#FC253A]">
                  <ShieldAlert size={24} />
                </span>
                <h2 id={titleId} className="text-lg font-bold text-white">Sneaky Lynk is protected.</h2>
                <p id={descriptionId} className="mt-2 text-sm leading-5 text-white/65">Return to the room to continue.</p>
                <button
                  ref={returnRef}
                  type="button"
                  onClick={onReturn}
                  className="mt-5 min-h-11 w-full rounded-xl bg-[#3FDCFF] px-4 py-3 text-sm font-semibold text-black hover:bg-[#73e6ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Return to room
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
