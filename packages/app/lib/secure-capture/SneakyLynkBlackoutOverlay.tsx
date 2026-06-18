"use client";

import { ShieldAlert } from "lucide-react";
import Logo from "@dvnt/app/components/logo.web";
import type { SecureCaptureBlackoutReason } from "./useSecureCaptureGuard";

export function SneakyLynkBlackoutOverlay({
  reason,
}: {
  reason: SecureCaptureBlackoutReason;
}) {
  if (!reason) return null;

  return (
    <div
      aria-live="polite"
      className="absolute inset-0 z-[80] flex items-center justify-center overflow-hidden bg-[#05060b]/96 px-6 text-center backdrop-blur-xl"
    >
      <div aria-hidden="true" className="absolute -inset-24 rotate-[-24deg] opacity-[0.07]">
        <div className="grid grid-cols-3 gap-16">
          {Array.from({ length: 18 }).map((_, index) => (
            <Logo
              key={index}
              width={220}
              height={84}
              className="drop-shadow-[0_0_18px_rgba(63,220,255,0.35)]"
            />
          ))}
        </div>
      </div>

      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(63,220,255,0.12),transparent_34%),linear-gradient(135deg,rgba(138,64,207,0.14),transparent_42%,rgba(252,37,58,0.08))]" />

      <div className="relative max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl">
        <Logo
          width={148}
          height={57}
          className="mx-auto mb-5 opacity-90 drop-shadow-[0_0_18px_rgba(63,220,255,0.45)]"
        />
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FC253A]/20 text-[#FC253A]">
          <ShieldAlert size={24} />
        </span>
        <h2 className="text-lg font-bold text-white">Sneaky Lynk is protected.</h2>
        <p className="mt-2 text-sm leading-5 text-white/65">
          Return to the room to continue.
        </p>
      </div>
    </div>
  );
}
