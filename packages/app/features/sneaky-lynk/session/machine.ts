/**
 * Sneaky Lynk — room session machine.
 *
 * Transport-agnostic and platform-agnostic on purpose: it imports nothing from
 * react, react-native, @moq/*, or any SDK, so every recovery path in it can be
 * exercised in a test without a device, a browser, or a live relay. That is the
 * whole point — today `ConnectionBanner` displays `peerStatus`, which is a
 * status readout, not a recovery path, and the recovery behind it can only be
 * checked by joining a real room on real hardware. That is not production ready.
 *
 * What it owns: the lifecycle of one membership in one room, and the policy for
 * getting back into it. What it deliberately does NOT own:
 *   - hand queue, roles, mute state → `stores/room-store.ts` already owns them
 *   - capacity and entitlement decisions → server-authoritative; the machine
 *     only consumes the verdict as an event (AGENTS.md I3)
 *   - host succession → also server-authoritative; the machine reacts to
 *     HOST_ENDED, it never elects
 *
 * Backgrounding has no state of its own. An app sent to the background loses
 * media the same way a bad network does, and comes back needing the same
 * re-establishment, so BACKGROUNDED lands in `degraded` and FOREGROUNDED starts
 * a reconnect. iOS, Android and the web page-lifecycle differ in *when* they
 * fire; they do not differ in what the session has to do next.
 */

export type LynkSessionState =
  | "idle"
  | "joining"
  | "connected"
  | "degraded"
  | "reconnecting"
  | "ended";

/** Why a session finished. Every terminal path names one; none is "unknown". */
export type LynkEndReason =
  | "left"
  | "host_ended"
  | "kicked"
  | "room_full"
  | "entitlement_denied"
  | "entitlement_expired"
  | "permission_revoked"
  | "reconnect_exhausted";

export type LynkSessionEvent =
  | { type: "JOIN" }
  | { type: "JOIN_GRANTED" }
  | { type: "JOIN_REJECTED"; reason: Extract<LynkEndReason, "room_full" | "entitlement_denied"> }
  | { type: "TRANSPORT_DEGRADED" }
  | { type: "TRANSPORT_RECOVERED" }
  | { type: "TRANSPORT_LOST" }
  | { type: "RECONNECT_SUCCEEDED" }
  | { type: "RECONNECT_FAILED" }
  | { type: "BACKGROUNDED" }
  | { type: "FOREGROUNDED" }
  | { type: "HOST_ENDED" }
  | { type: "KICKED" }
  | { type: "ENTITLEMENT_EXPIRED" }
  | { type: "PERMISSION_REVOKED" }
  | { type: "LEAVE" };

export type LynkSessionEventType = LynkSessionEvent["type"];

export interface LynkSession {
  readonly state: LynkSessionState;
  /** Consecutive failed reconnects. Reset by any successful attachment. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Set once, when `state` becomes `ended`. */
  readonly endReason: LynkEndReason | null;
  /** True while the reason we are not connected is the app being backgrounded. */
  readonly backgrounded: boolean;
}

export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;

export function createSession(
  maxAttempts: number = DEFAULT_MAX_RECONNECT_ATTEMPTS,
): LynkSession {
  return { state: "idle", attempt: 0, maxAttempts, endReason: null, backgrounded: false };
}

/**
 * The transition table. Every (state, event) pair that is legal appears here;
 * anything absent is a no-op, which is what makes a duplicate or late event
 * from a flaky transport harmless rather than a crash. `scripts/verify-lynk.mjs`
 * asserts every state and every event type is represented, so a new event
 * cannot be added to the union and silently ignored everywhere.
 */
const TABLE: Record<
  LynkSessionState,
  Partial<Record<LynkSessionEventType, LynkSessionState>>
> = {
  idle: {
    JOIN: "joining",
  },
  joining: {
    JOIN_GRANTED: "connected",
    JOIN_REJECTED: "ended",
    TRANSPORT_LOST: "reconnecting",
    HOST_ENDED: "ended",
    KICKED: "ended",
    PERMISSION_REVOKED: "ended",
    ENTITLEMENT_EXPIRED: "ended",
    LEAVE: "ended",
    BACKGROUNDED: "degraded",
  },
  connected: {
    TRANSPORT_DEGRADED: "degraded",
    TRANSPORT_LOST: "reconnecting",
    BACKGROUNDED: "degraded",
    HOST_ENDED: "ended",
    KICKED: "ended",
    ENTITLEMENT_EXPIRED: "ended",
    PERMISSION_REVOKED: "ended",
    LEAVE: "ended",
  },
  degraded: {
    TRANSPORT_RECOVERED: "connected",
    TRANSPORT_LOST: "reconnecting",
    FOREGROUNDED: "reconnecting",
    HOST_ENDED: "ended",
    KICKED: "ended",
    ENTITLEMENT_EXPIRED: "ended",
    PERMISSION_REVOKED: "ended",
    LEAVE: "ended",
  },
  reconnecting: {
    RECONNECT_SUCCEEDED: "connected",
    // RECONNECT_FAILED is resolved in `transition` — it stays here until the
    // budget is spent, then ends. A table cell cannot express that alone.
    RECONNECT_FAILED: "reconnecting",
    FOREGROUNDED: "reconnecting",
    BACKGROUNDED: "degraded",
    HOST_ENDED: "ended",
    KICKED: "ended",
    ENTITLEMENT_EXPIRED: "ended",
    PERMISSION_REVOKED: "ended",
    LEAVE: "ended",
  },
  // Terminal. A room that ended cannot un-end; rejoining is a NEW session.
  ended: {},
};

/** Exposed so the verifier can assert coverage without re-declaring the table. */
export const TRANSITION_TABLE = TABLE;

const END_REASON_FOR: Partial<Record<LynkSessionEventType, LynkEndReason>> = {
  HOST_ENDED: "host_ended",
  KICKED: "kicked",
  ENTITLEMENT_EXPIRED: "entitlement_expired",
  PERMISSION_REVOKED: "permission_revoked",
  LEAVE: "left",
};

export function transition(session: LynkSession, event: LynkSessionEvent): LynkSession {
  const next = TABLE[session.state][event.type];
  if (!next) return session;

  switch (event.type) {
    case "RECONNECT_FAILED": {
      const attempt = session.attempt + 1;
      return attempt >= session.maxAttempts
        ? { ...session, state: "ended", attempt, endReason: "reconnect_exhausted" }
        : { ...session, state: "reconnecting", attempt };
    }
    case "JOIN_REJECTED":
      return { ...session, state: "ended", endReason: event.reason };
    case "BACKGROUNDED":
      return { ...session, state: next, backgrounded: true };
    case "JOIN_GRANTED":
    case "RECONNECT_SUCCEEDED":
    case "TRANSPORT_RECOVERED":
      // Any successful attachment refunds the reconnect budget, so a long
      // session on a flaky train does not exhaust it on unrelated blips.
      return { ...session, state: next, attempt: 0, backgrounded: false };
    default: {
      const endReason = END_REASON_FOR[event.type] ?? null;
      return next === "ended"
        ? { ...session, state: "ended", endReason: session.endReason ?? endReason }
        : { ...session, state: next, backgrounded: false };
    }
  }
}

/** The room is holding a live membership — the transport should stay attached. */
export function isActive(session: LynkSession): boolean {
  return session.state !== "idle" && session.state !== "ended";
}

/** The caller should be running a reconnect attempt right now. */
export function shouldAttemptReconnect(session: LynkSession): boolean {
  return session.state === "reconnecting" && session.attempt < session.maxAttempts;
}

/**
 * Backoff for the next attempt, ms. Exponential from 500 ms, capped at 8 s.
 * ponytail: no jitter — DVNT room sizes are tens, not thousands, so a
 * thundering herd on the relay is not a live concern. Add jitter if a single
 * relay outage ever has to be survived by a whole venue at once.
 */
export function reconnectDelayMs(session: LynkSession): number {
  return Math.min(500 * 2 ** session.attempt, 8000);
}
