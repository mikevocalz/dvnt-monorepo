"use client";

/**
 * The black prompt card plus the round countdown.
 *
 * The timer is display-only: deadline_at is the server's truth, the client
 * just counts down to it. No action is gated on this number hitting zero.
 */

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

export function Countdown({ deadlineAt }: { deadlineAt: string | null }) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!deadlineAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  if (!deadlineAt) return null;
  const left = Math.max(
    0,
    Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 1000),
  );
  const urgent = left <= 10;

  return (
    <span
      role="timer"
      aria-label={`${left} seconds left`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums ${
        urgent
          ? "border-[#F0A2A2]/50 text-[#F0A2A2]"
          : "border-white/15 text-white/70"
      }`}
    >
      <Timer aria-hidden className="h-3.5 w-3.5" />
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

export function PromptCard({
  text,
  pick,
  label,
}: {
  text: string;
  pick: number;
  label?: string;
}) {
  return (
    <div className="w-full max-w-xs rounded-2xl border border-[#8A40CF]/50 bg-[#0c0e18] p-5 shadow-[0_8px_30px_rgba(138,64,207,0.15)]">
      {label ? (
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#C9A2F0]">
          {label}
        </p>
      ) : null}
      <p className="mt-2 text-lg font-semibold leading-snug text-white">
        {text}
      </p>
      {pick > 1 ? (
        <p className="mt-3 text-xs font-medium text-white/50">
          Pick {pick} cards
        </p>
      ) : null}
    </div>
  );
}
