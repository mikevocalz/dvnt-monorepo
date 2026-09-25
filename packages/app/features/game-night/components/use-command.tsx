"use client";

/**
 * One user-intended command at a time.
 *
 * Every actionable button in the room shares the same needs: it must not
 * double-fire while its RPC is in flight, it must show the server's
 * error.message (with the cryptic codes translated), and the message should
 * not linger forever. `run` wraps the RPC; `pending`/`error` feed the button.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  room_full: "Room is full — you can still watch",
  players_not_ready: "Waiting on everyone to ready up",
  phase_not_submitting: "Submissions closed",
  not_member: "Join the room first",
  not_host: "Only the host can do that",
  not_judge: "Only the judge picks the winner",
  not_seated: "Take a seat first",
  already_ready: "Already marked ready",
  match_active: "A match is already running",
  room_closed: "This room has ended",
  rate_limited: "Slow down — try again in a moment",
};

export function friendlyError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : "Something went wrong";
  // RPCs raise `raise exception 'code'` which surfaces inside a longer message;
  // match the code anywhere in the string rather than requiring equality.
  for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
    if (raw.includes(code)) return text;
  }
  return raw;
}

export function useCommand() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(friendlyError(err));
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setError(null), 6000);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, run, clearError: () => setError(null) };
}

export function CommandError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-[#F0A2A2]">
      {message}
    </p>
  );
}
