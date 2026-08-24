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

import {
  createSession,
  isActive,
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

export function useRoomSession(status: RoomTransportStatus): LynkSession {
  const [session, setSession] = useState<LynkSession>(createSession);

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
