'use client';

/**
 * "Sale starts" card — web counterpart of
 * features/events/ui/TicketsOpeningSoonCard.tsx.
 *
 * A paid event with no ticket tiers yet showed the web visitor nothing at all:
 * no tiers, no CTA, no explanation — the ticket area was simply absent, so the
 * page read as if the event had no tickets rather than tickets that had not
 * opened. Native has told people "SALE STARTS · 3d 4h 12m" with a notify
 * toggle since launch; this brings web to parity.
 *
 * Same copy, same states and the same `toggle-sale-notify` edge function as
 * native, so a reminder set on one surface is the same subscription on the
 * other. No calendar button: expo-calendar is native-only, and a dead control
 * is worse than an absent one.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, BellOff } from 'lucide-react';

type Countdown =
  | { kind: 'future'; days: number; hours: number; minutes: number; seconds: number }
  | { kind: 'open' }
  | { kind: 'unknown' };

function computeCountdown(saleStart: string | null): Countdown {
  if (!saleStart) return { kind: 'unknown' };
  const target = Date.parse(saleStart);
  if (!Number.isFinite(target)) return { kind: 'unknown' };
  const diff = target - Date.now();
  if (diff <= 0) return { kind: 'open' };
  const seconds = Math.floor(diff / 1000);
  return {
    kind: 'future',
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function formatSaleDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface TicketsOpeningSoonCardProps {
  /** ISO string for when ticket sales open. If null, no countdown is shown. */
  saleStart: string | null;
  /** True if the current user has opted in to be notified when sales open. */
  notifyEnabled: boolean;
  /** Toggle the notify subscription. */
  onToggleNotify: () => void;
}

export function TicketsOpeningSoonCard({
  saleStart,
  notifyEnabled,
  onToggleNotify,
}: TicketsOpeningSoonCardProps) {
  const [countdown, setCountdown] = useState<Countdown>(() =>
    computeCountdown(saleStart),
  );

  useEffect(() => {
    setCountdown(computeCountdown(saleStart));
    // Only tick while there is something to count down to — an open or unknown
    // sale never changes, and a 1s interval on every event page would keep the
    // tab busy for nothing.
    if (!saleStart || Date.parse(saleStart) <= Date.now()) return;
    const id = setInterval(() => setCountdown(computeCountdown(saleStart)), 1000);
    return () => clearInterval(id);
  }, [saleStart]);

  const countdownText = useMemo(() => {
    if (countdown.kind === 'open') return 'Sales open now';
    if (countdown.kind === 'unknown') return 'Tickets coming soon';
    const { days: d, hours: h, minutes: m, seconds: s } = countdown;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }, [countdown]);

  const subline = useMemo(() => {
    if (countdown.kind === 'open') return 'Tap Get Tickets to grab yours';
    if (countdown.kind === 'unknown')
      return "We'll let you know the moment sales open";
    return saleStart ? formatSaleDate(saleStart) : '';
  }, [countdown.kind, saleStart]);

  return (
    <div className="rounded-2xl border border-[#8A40CF]/25 bg-[#8A40CF]/[0.08] p-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0">
          {notifyEnabled ? (
            <BellRing size={18} color="#8A40CF" />
          ) : (
            <BellOff size={18} color="rgba(255,255,255,0.7)" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-extrabold tracking-[0.08em] text-white/50">
            SALE STARTS
          </p>
          {/* tabular-nums so the countdown does not jitter as digits change */}
          <p className="text-xl font-bold text-white tabular-nums">
            {countdownText}
          </p>
          {subline ? (
            <p className="text-sm text-white/60 truncate">{subline}</p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleNotify}
        aria-pressed={notifyEnabled}
        aria-label={
          notifyEnabled ? 'Turn off sale reminder' : 'Notify me when sales open'
        }
        className={`mt-4 w-full h-11 rounded-xl inline-flex items-center justify-center gap-2 text-sm font-bold transition-colors ${
          notifyEnabled
            ? 'bg-[#22c55e]/[0.18] border border-[#22c55e]/45 text-[#22c55e]'
            : 'bg-[#8A40CF] text-black'
        }`}
      >
        <BellRing size={16} color={notifyEnabled ? '#22c55e' : '#000'} />
        {notifyEnabled ? "We'll remind you" : 'Notify me'}
      </button>
    </div>
  );
}
