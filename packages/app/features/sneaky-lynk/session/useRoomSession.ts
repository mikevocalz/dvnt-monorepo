/**
 * Drives the room session machine from a transport's status, and hangs the
 * observability seam off it.
 *
 * The machine (./machine) stays pure and platform-free so its transitions can
 * be tested without a device; this is the thin adapter that feeds it real
 * events and acts on the result. Both room legs use it, so "when is a room
 * actually live" is answered in one place instead of by whichever effect
 * happened to be nearby.
 *
 * What it deliberately does NOT do yet: reconnect. The machine knows the
 * budget, the backoff and when to give up, but acting on that changes what
 * happens to a live call and cannot be trusted until it has run on two real
 * devices in one room. This wires the machine in as the source of truth for
 * session lifecycle; WS-3 turns on the recovery it already describes.
 */
import { useEffect, useRef, useState } from "react";

import type { ConnectionPhase } from "@dvnt/ui";

import {
  createSession,
  isActive,
  reconnectDelayMs,
  shouldAttemptReconnect,
  transition,
  type LynkSession,
  type LynkSessionEvent,
} from "./machine";
import {
  enterRoomObservability,
  exitRoomObservability,
} from "../observability";

/** The union both legs already produce, plus Fishjam's `error`/`idle`. */
export type RoomTransportStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

/**
 * Fold a transport status into the machine's vocabulary. Returns null when the
 * status implies no transition from where we are — the machine ignores unknown
 * pairs anyway, but not emitting is cheaper and keeps the intent readable.
 */
function eventFor(
  status: RoomTransportStatus,
  session: LynkSession,
): LynkSessionEvent | null {
  switch (status) {
    case "idle":
      return null;
    case "connecting":
      return session.state === "idle" ? { type: "JOIN" } : null;
    case "connected":
      if (session.state === "joining") return { type: "JOIN_GRANTED" };
      if (session.state === "reconnecting") return { type: "RECONNECT_SUCCEEDED" };
      if (session.state === "degraded") return { type: "TRANSPORT_RECOVERED" };
      return null;
    case "reconnecting":
    case "disconnected":
    case "error":
      return session.state === "connected" || session.state === "degraded"
        ? { type: "TRANSPORT_LOST" }
        : null;
  }
}

export interface RoomSessionOptions {
  /**
   * Re-establish the transport. Resolve true when back, false when the attempt
   * failed — the machine spends a budget on the false path and gives up when
   * it runs out, rather than retrying forever against a room that has gone.
   *
   * Omit it and the machine still tracks `reconnecting`; it just never acts,
   * which is the behaviour before this existed.
   */
  onReconnect?: () => Promise<boolean>;
}

export function useRoomSession(
  status: RoomTransportStatus,
  { onReconnect }: RoomSessionOptions = {},
): LynkSession {
  const [session, setSession] = useState<LynkSession>(createSession);
  const send = (event: LynkSessionEvent) =>
    setSession((current) => transition(current, event));

  useEffect(() => {
    setSession((current) => {
      const event = eventFor(status, current);
      return event ? transition(current, event) : current;
    });
  }, [status]);

  // Observability follows the session, not a mount: a room that is joining is
  // not yet a room, and one that has ended should not still be suppressing
  // app-hang tracking.
  const wasActive = useRef(false);
  const active = isActive(session) && session.state !== "joining";
  useEffect(() => {
    if (active === wasActive.current) return;
    wasActive.current = active;
    if (active) enterRoomObservability();
    else exitRoomObservability();
  }, [active]);

  // ── Recovery ──────────────────────────────────────────────────────────────
  // The machine already knows the budget, the backoff and when to give up.
  // This is the part that acts on it: wait the backoff, attempt, report the
  // outcome back in. A successful attach refunds the budget (machine.ts), so a
  // long session on a flaky connection cannot exhaust it on unrelated blips.
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const attemptingRef = useRef(false);

  useEffect(() => {
    if (!onReconnectRef.current) return;
    if (!shouldAttemptReconnect(session)) return;
    if (attemptingRef.current) return;

    let cancelled = false;
    attemptingRef.current = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const ok = await onReconnectRef.current!();
          if (cancelled) return;
          send({ type: ok ? "RECONNECT_SUCCEEDED" : "RECONNECT_FAILED" });
        } catch {
          // A throwing rejoin is a failed rejoin, not a crash. Anything else
          // would take the room down for the one case it exists to survive.
          if (!cancelled) send({ type: "RECONNECT_FAILED" });
        } finally {
          attemptingRef.current = false;
        }
      })();
    }, reconnectDelayMs(session));

    return () => {
      cancelled = true;
      attemptingRef.current = false;
      clearTimeout(timer);
    };
    // `attempt` is the dependency that matters: each failure schedules the next
    // try at a longer delay.
  }, [session.state, session.attempt]);

  // A component that unmounts mid-room (navigation, a crash boundary) must not
  // leave app-hang tracking paused for the rest of the app's life.
  useEffect(
    () => () => {
      if (wasActive.current) {
        wasActive.current = false;
        exitRoomObservability();
      }
    },
    [],
  );

  return session;
}

/**
 * Session state → banner phase. The banner used to read the transport status
 * directly on both legs, which is why a first join and a mid-session drop
 * looked the same on web: the transport cannot tell them apart, and only the
 * session's history can.
 *
 * `ended` maps to `disconnected` rather than getting its own banner — a room
 * that is over is a sheet, not a strip (ConnectionBanner.types).
 */
export function bannerPhaseFor(session: LynkSession): ConnectionPhase {
  switch (session.state) {
    case "idle":
      return "idle";
    case "joining":
      return "connecting";
    case "connected":
      return "connected";
    case "degraded":
      return "degraded";
    case "reconnecting":
      return "reconnecting";
    case "ended":
      return "disconnected";
  }
}
