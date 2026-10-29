'use client';

import { Clock } from 'lucide-react';

export type { RoomTimerProps } from './RoomTimer.types';
import type { RoomTimerProps } from './RoomTimer.types';
import { FREE_ROOM_DURATION_MS, useRoomCountdown } from './RoomTimer.countdown';

export function RoomTimer({
  startedAt,
  endsAt,
  durationMs = FREE_ROOM_DURATION_MS,
  onTimeUp,
  className,
}: RoomTimerProps) {
  const { display, visible, warning, expired } = useRoomCountdown(startedAt, durationMs, onTimeUp, endsAt);
  if (!visible) return null;

  return (
    <span data-room-countdown data-warning={warning ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2.5 py-1.5 text-xs ${warning || expired ? 'bg-[#FC253A]/20 text-red-100' : 'bg-white/8 text-white/90'} ${className ?? ''}`}>
      <Clock size={14} aria-hidden="true" />
      <span role="timer" aria-live="off" aria-label={expired ? 'Session ended' : `${display} left in this room`} className="whitespace-nowrap font-mono font-bold tabular-nums">
        {expired ? 'Session ended' : `Time left ${display}`}
      </span>
      <span role="status" aria-live="polite" aria-atomic="true" className="font-medium">
        {expired ? 'This room has ended.' : warning ? 'Ending in 30 seconds or less' : ''}
      </span>
    </span>
  );
}
