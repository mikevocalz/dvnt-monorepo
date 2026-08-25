'use client';

import { Clock } from 'lucide-react';

export type { RoomTimerProps } from './RoomTimer.types';
import type { RoomTimerProps } from './RoomTimer.types';
import { FREE_ROOM_DURATION_MS, useRoomCountdown } from './RoomTimer.countdown';

export function RoomTimer({
  startedAt,
  durationMs = FREE_ROOM_DURATION_MS,
  onTimeUp,
  className,
}: RoomTimerProps) {
  const { display, visible, remainingMs } = useRoomCountdown(startedAt, durationMs, onTimeUp);
  if (!visible) return null;

  return (
    <span
      role="timer"
      aria-live={remainingMs <= 10_000 ? 'assertive' : 'polite'}
      aria-label={`${display} left in this room`}
      // motion-safe: the pulse is decoration; the number is the information.
      className={`flex items-center gap-1.5 rounded-[10px] bg-[#FC253A]/90 px-2.5 py-1.5 font-mono text-[13px] font-bold text-white motion-safe:animate-pulse ${className ?? ''}`}
    >
      <Clock size={14} aria-hidden="true" /> {display}
    </span>
  );
}
