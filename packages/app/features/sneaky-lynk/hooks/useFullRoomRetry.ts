import { useCallback, useEffect, useRef, useState } from "react";

export type FullRoomRetryResult = "joined" | "full" | "stopped";
export interface FullRoomRetryAttempt {
  /** Check again before applying admission or enabling capture, not just before HTTP. */
  isCurrent: () => boolean;
}

interface Options {
  /** Include account identity when the screen is not keyed by account. */
  roomKey: string;
  /** True only while the full-room surface is open and admission is still allowed. */
  eligible: boolean;
  /** App foreground + screen focused on native; visible document on web. */
  active: boolean;
  /** The real reviewed join, never an admission probe followed by a second join. */
  onAttempt: (attempt: FullRoomRetryAttempt) => Promise<FullRoomRetryResult>;
  onCancelAttempt?: () => void;
}

const MIN_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30_000;

/**
 * Explicit, foreground-only admission retries. This is not a queue or seat
 * reservation. Background/close stops opt-in; returning never resumes it.
 * The caller owns admission cancellation and must await stale-result cleanup
 * before resolving onAttempt. The lock survives Stop until that promise settles.
 */
export function useFullRoomRetry(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const generation = useRef(0);
  const enabledRef = useRef(false);
  const inFlight = useRef<Promise<FullRoomRetryResult> | null>(null);
  const nextAt = useRef<number | null>(null);
  const cooldownUntil = useRef(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<() => Promise<FullRoomRetryResult>>(async () => "stopped");
  const [enabled, setEnabled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [secondsUntilRetry, setSecondsUntilRetry] = useState(0);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const showCooldown = useCallback(() => {
    if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current);
    const tick = () => {
      if (!mounted.current) return;
      const remaining = Math.max(0, cooldownUntil.current - Date.now());
      setCooldownSeconds(Math.ceil(remaining / 1_000));
      cooldownTimer.current = remaining > 0 ? setTimeout(tick, Math.min(1_000, remaining)) : null;
    };
    tick();
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    enabledRef.current = false;
    nextAt.current = null;
    clearTimer();
    if (inFlight.current) latest.current.onCancelAttempt?.();
    if (mounted.current) {
      setEnabled(false);
      setSecondsUntilRetry(0);
    }
  }, [clearTimer]);

  const schedule = useCallback((delay: number) => {
    clearTimer();
    nextAt.current = Date.now() + delay;
    const tick = () => {
      if (!mounted.current || !enabledRef.current || !latest.current.eligible || !latest.current.active) {
        stop();
        return;
      }
      const remaining = Math.max(0, (nextAt.current ?? Date.now()) - Date.now());
      setSecondsUntilRetry(Math.ceil(remaining / 1_000));
      if (remaining === 0) {
        timer.current = null;
        void runRef.current();
      } else {
        timer.current = setTimeout(tick, Math.min(1_000, remaining));
      }
    };
    tick();
  }, [clearTimer, stop]);

  const retryNow = useCallback((): Promise<FullRoomRetryResult> => {
    if (inFlight.current) return inFlight.current;
    if (!mounted.current || !latest.current.eligible || !latest.current.active) return Promise.resolve("stopped");
    if (Date.now() < cooldownUntil.current) return Promise.resolve("stopped");
    clearTimer();
    nextAt.current = null;
    const epoch = generation.current;
    const key = latest.current.roomKey;
    const isCurrent = () => mounted.current && generation.current === epoch && latest.current.roomKey === key && latest.current.eligible && latest.current.active;
    setRetrying(true);
    setSecondsUntilRetry(0);
    // Begin in a microtask so even a synchronous callback cannot beat the lock.
    const pending = Promise.resolve().then(async (): Promise<FullRoomRetryResult> => {
      let result: FullRoomRetryResult = "stopped";
      try {
        if (isCurrent()) result = await latest.current.onAttempt({ isCurrent });
      } catch {
        // Unexpected/device/network failures need a deliberate retry. Only a
        // fresh full verdict is permission to continue automatic attempts.
      }
      if (!isCurrent()) return "stopped";
      if (result === "full") {
        failures.current += 1;
      } else {
        enabledRef.current = false;
        setEnabled(false);
      }
      return result;
    }).finally(() => {
      if (inFlight.current !== pending) return;
      inFlight.current = null;
      cooldownUntil.current = Date.now() + MIN_DELAY_MS;
      if (!mounted.current) return;
      setRetrying(false);
      showCooldown();
      if (isCurrent() && enabledRef.current) {
        schedule(Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** Math.min(failures.current, 3)));
      }
    });
    inFlight.current = pending;
    return pending;
  }, [clearTimer, schedule, showCooldown]);
  runRef.current = retryNow;

  const start = useCallback(() => {
    if (!mounted.current || !latest.current.eligible || !latest.current.active || inFlight.current || enabledRef.current) return;
    generation.current += 1;
    failures.current = 0;
    enabledRef.current = true;
    setEnabled(true);
    schedule(Math.max(MIN_DELAY_MS, cooldownUntil.current - Date.now()));
  }, [schedule]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
      if (cooldownTimer.current !== null) clearTimeout(cooldownTimer.current);
    };
  }, [stop]);

  useEffect(() => {
    // Reset on room/account changes, and never resume automatically on focus.
    stop();
  }, [options.roomKey, options.active, options.eligible, stop]);

  return { enabled, retrying, secondsUntilRetry, cooldownSeconds, start, stop, retryNow };
}
