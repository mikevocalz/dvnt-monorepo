"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { GameNightRiveButtonKind } from "../motion/rive-hud-contract";
import {
  GAME_NIGHT_RIVE_HUD,
  riveButtonKindValue,
} from "../motion/rive-hud-contract";

const variants: Record<GameNightRiveButtonKind, string> = {
  primary:
    "border-white/10 bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,.12)] hover:bg-[#F3E8FF]",
  secondary:
    "border-[#8A40CF]/45 bg-[#8A40CF]/18 text-white hover:bg-[#8A40CF]/28",
  danger:
    "border-[#F0A2A2]/35 bg-[#F0A2A2]/10 text-[#FFD1D1] hover:bg-[#F0A2A2]/16",
  ghost:
    "border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white",
};

export function GameNightButton({
  kind = "primary",
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: GameNightRiveButtonKind;
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      data-rive-artboard={GAME_NIGHT_RIVE_HUD.artboards.button}
      data-rive-state-machine={GAME_NIGHT_RIVE_HUD.stateMachine}
      data-rive-cta-kind={riveButtonKindValue(kind)}
      className={`group relative isolate inline-flex min-h-12 items-center justify-center overflow-hidden rounded-xl border px-5 py-3 text-sm font-black tracking-[-0.01em] transition duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${variants[kind]} ${className}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/20 opacity-0 blur-sm transition-all duration-500 group-hover:left-[120%] group-hover:opacity-100 motion-reduce:hidden"
      />
      <span className="relative">{children}</span>
    </button>
  );
}
