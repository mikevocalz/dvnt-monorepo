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

/**
 * The prompt card in the printed Cookout anatomy: white face, navy header
 * stack ("KEEP IT 100 / THE COOKOUT / section"), PROMPT: label over a navy
 * rule, and the deck's navy footer band.
 */
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
    <div className="w-full max-w-xs overflow-hidden rounded-xl bg-white shadow-[0_10px_34px_rgba(40,60,129,0.28)]">
      <div className="px-5 pb-4 pt-4 text-center">
        <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#283C81]">
          Keep It 100
        </p>
        <p className="text-[15px] font-bold uppercase tracking-[0.08em] text-[#283C81]">
          The Cookout
        </p>
        {label ? (
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#283C81]/80">
            {label}
          </p>
        ) : null}
        <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-[#283C81]">
          Prompt:
        </p>
        <div aria-hidden className="mx-auto mt-1 h-0.75 w-2/3 bg-[#283C81]" />
        <p className="mt-3 text-[15px] font-semibold leading-snug text-[#141414]">
          {text}
        </p>
        {pick > 1 ? (
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-[#283C81]">
            Pick {pick} cards
          </p>
        ) : null}
      </div>
      <div aria-hidden className="h-3 bg-[#283C81]" />
    </div>
  );
}
