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
import { useCallback, useEffect, useRef, useState } from 'react';

export const FREE_ROOM_DURATION_MS = 5 * 60 * 1000;
/** Warn before expiry; limited rooms show their countdown from the start. */
export const COUNTDOWN_THRESHOLD_MS = 30 * 1000;

export interface Countdown {
  remainingMs: number;
  /** `m:ss`, e.g. `0:07`. */
  display: string;
  /** Whether the badge should render at all. */
  visible: boolean;
  expired: boolean;
  warning: boolean;
}

/** Pure — no clock of its own, so a test can drive `now` directly. */
export function countdownAt(
  startedAt: number,
  durationMs: number,
  now: number,
  threshold: number = COUNTDOWN_THRESHOLD_MS,
): Countdown {
  const valid = Number.isFinite(startedAt) && Number.isFinite(durationMs);
  const remainingMs = valid ? Math.max(0, durationMs - (now - startedAt)) : 0;
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    remainingMs,
    display: `${minutes}:${seconds.toString().padStart(2, '0')}`,
    visible: valid,
    expired: valid && remainingMs <= 0,
    warning: valid && remainingMs > 0 && remainingMs <= threshold,
  };
}

/**
 * Ticks once a second and fires `onTimeUp` exactly once. `onTimeUp` is held in
 * a ref so a caller passing an inline arrow does not restart the interval on
 * every render — which would drift the countdown a little on each re-render.
 */
export function useRoomCountdown(
  startedAt: number | undefined,
  durationMs: number = FREE_ROOM_DURATION_MS,
  onTimeUp?: () => void,
  endsAt?: string | null,
): Countdown & { refresh: () => void } {
  const deadline = endsAt === undefined ? (startedAt ?? NaN) + durationMs : endsAt === null ? NaN : Date.parse(endsAt);
  const [now, setNow] = useState(() => Date.now());
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  const firedRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    const current = Date.now();
    setNow(current);
    if (Number.isFinite(deadline) && current >= deadline && firedRef.current !== deadline) {
      firedRef.current = deadline;
      onTimeUpRef.current?.();
    }
  }, [deadline]);

  useEffect(() => {
    const tick = refresh;
    const interval = setInterval(tick, 1000);
    tick();
    // Browsers throttle timers in the background. Recompute from the server
    // instant immediately on return, never restart a local five-minute budget.
    const browserDocument = typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof document.removeEventListener === 'function' ? document : null;
    const browserWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof window.removeEventListener === 'function' ? window : null;
    const onVisible = () => { if (browserDocument?.visibilityState === 'visible') tick(); };
    browserDocument?.addEventListener('visibilitychange', onVisible);
    browserWindow?.addEventListener('pageshow', tick);
    return () => {
      clearInterval(interval);
      browserDocument?.removeEventListener('visibilitychange', onVisible);
      browserWindow?.removeEventListener('pageshow', tick);
    };
  }, [refresh]);

  return { ...countdownAt(0, deadline, now), refresh };
}
