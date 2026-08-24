'use client';

import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';

export type { ConnectionPhase, ConnectionBannerProps } from './ConnectionBanner.types';
import type { ConnectionBannerProps, ConnectionPhase } from './ConnectionBanner.types';

const GOLD = '#F5C518';
const SIGNAL = '#FC253A';
const DIM = 'rgba(255,255,255,0.60)';

const PHASE = {
  connecting: { label: 'Connecting', color: DIM, Icon: Wifi },
  degraded: { label: 'Weak connection', color: GOLD, Icon: AlertTriangle },
  reconnecting: { label: 'Reconnecting', color: GOLD, Icon: WifiOff },
  disconnected: { label: 'Disconnected', color: SIGNAL, Icon: WifiOff },
} as const satisfies Record<Exclude<ConnectionPhase, 'connected' | 'idle'>, unknown>;

export function ConnectionBanner({
  phase,
  attempt,
  detail,
  action,
  className,
}: ConnectionBannerProps) {
  // `idle` means nothing has been attempted yet — also not a banner.
  if (phase === 'connected' || phase === 'idle') return null;
  const { label, color, Icon } = PHASE[phase];

  return (
    // role=status + aria-live: a connection change is exactly the case screen
    // readers should hear without being yanked out of the room.
    <div
      role="status"
      aria-live={phase === 'disconnected' ? 'assertive' : 'polite'}
      className={`mx-4 my-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 ${className ?? ''}`}
    >
      <Icon size={16} color={color} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span style={{ color }} className="text-sm font-medium">
            {label}
          </span>
          {attempt ? (
            <span style={{ color }} className="font-mono text-xs opacity-80">
              {attempt.current}/{attempt.max}
            </span>
          ) : null}
        </span>
        {detail ? (
          <p className="mt-0.5 truncate text-xs text-white/40">{detail}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
