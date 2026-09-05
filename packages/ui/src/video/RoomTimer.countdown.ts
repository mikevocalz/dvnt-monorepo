/**
 * The free-room countdown, shared by both platform legs.
 *
 * Lives in a non-split file for the same reason `*.types.ts` does: a platform
 * file importing `./RoomTimer` would resolve back to a platform sibling under
 * platform-suffix module resolution. The reason it is shared at all is that
 * "when does this room end" was implemented twice — once in the native
 * component, once inline in the web screen — with the same arithmetic written
 * two different ways. Two copies of an expiry rule is one copy too many.
 *
 * The client is a DISPLAY of a server fact. Free-tier limits are enforced
 * server-side; this never decides anything, it only counts down to what the
 * server already knows and calls `onTimeUp` so the UI can react.
 */
import { useEffect, useRef, useState } from 'react';

export const FREE_ROOM_DURATION_MS = 5 * 60 * 1000;
/** The countdown only appears in the last minute — before that it is noise. */
export const COUNTDOWN_THRESHOLD_MS = 60 * 1000;

export interface Countdown {
  remainingMs: number;
  /** `m:ss`, e.g. `0:07`. */
  display: string;
  /** Whether the badge should render at all. */
  visible: boolean;
  expired: boolean;
}

/** Pure — no clock of its own, so a test can drive `now` directly. */
export function countdownAt(
  startedAt: number,
  durationMs: number,
  now: number,
  threshold: number = COUNTDOWN_THRESHOLD_MS,
): Countdown {
  const remainingMs = Math.max(0, durationMs - (now - startedAt));
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    remainingMs,
    display: `${minutes}:${seconds.toString().padStart(2, '0')}`,
    visible: remainingMs <= threshold && remainingMs > 0,
    expired: remainingMs <= 0,
  };
}

/**
 * Ticks once a second and fires `onTimeUp` exactly once. `onTimeUp` is held in
 * a ref so a caller passing an inline arrow does not restart the interval on
 * every render — which would drift the countdown a little on each re-render.
 */
export function useRoomCountdown(
  startedAt: number,
  durationMs: number = FREE_ROOM_DURATION_MS,
  onTimeUp?: () => void,
): Countdown {
  const [now, setNow] = useState(() => Date.now());
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current - startedAt >= durationMs && !firedRef.current) {
        firedRef.current = true;
        clearInterval(interval);
        onTimeUpRef.current?.();
      }
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, durationMs]);

  return countdownAt(startedAt, durationMs, now);
}
