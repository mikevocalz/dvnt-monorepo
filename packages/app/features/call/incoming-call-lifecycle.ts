/**
 * When a ringing overlay may appear, and every way it has to disappear.
 *
 * A stuck "incoming call" is worse than no overlay at all: it covers the app,
 * it keeps ringing, and the only way out is a reload. The clearing rules are
 * therefore pure and asserted in `incoming-call-lifecycle.test.ts` rather than
 * spread across realtime callbacks, timers and button handlers where "did the
 * caller hanging up during a stale timer clear it?" is unanswerable.
 *
 * Shared by the native overlay's guards and the web port.
 */

/** Phases in which a NEW incoming call may be presented. Anything else = busy. */
export const ANSWERABLE_PHASES = ["idle", "call_ended", "error"] as const;

export interface RingingSignal {
  /** Call-signal row id. Numeric in the DB; string in tests and some payloads. */
  id: string | number;
}

export interface IncomingCallState {
  /** The signal currently ringing, or null when nothing is. */
  call: RingingSignal | null;
  /** Who the ring belongs to — an account switch invalidates it. */
  viewerId: string | null;
  /** Account generation at subscribe time (watch-session parity). */
  accountGen: string;
}

export type IncomingCallEvent =
  /** A realtime INSERT arrived while the viewer was on `callPhase`. */
  | {
      type: "ring";
      signal: RingingSignal;
      viewerId: string | null;
      accountGen: string;
      callPhase: string;
    }
  /** Caller cancelled / call row reached a terminal status. */
  | { type: "signal_ended"; id: string | number }
  /** The 30s ring window elapsed for that signal. */
  | { type: "timeout"; id: string | number }
  /** This device answered or declined. */
  | { type: "answered" }
  | { type: "declined" }
  /** The call state machine moved (joining, connected, call_ended, …). */
  | { type: "call_phase"; callPhase: string }
  /** Signed-in account changed under the overlay. */
  | { type: "account_changed"; viewerId: string | null; accountGen: string };

export const EMPTY_INCOMING_CALL: IncomingCallState = {
  call: null,
  viewerId: null,
  accountGen: "",
};

export function isAnswerable(callPhase: string): boolean {
  return (ANSWERABLE_PHASES as readonly string[]).includes(callPhase);
}

export function reduceIncomingCall(
  state: IncomingCallState,
  event: IncomingCallEvent,
): IncomingCallState {
  switch (event.type) {
    case "ring":
      // Already on a call: the ring is the OS/other device's problem, not an
      // overlay over the call you are in.
      if (!isAnswerable(event.callPhase)) return state;
      return {
        call: event.signal,
        viewerId: event.viewerId,
        accountGen: event.accountGen,
      };
    case "signal_ended":
    case "timeout":
      // Only the signal it names. A timer from the PREVIOUS call must never
      // clear the call ringing now.
      return state.call?.id === event.id ? { ...state, call: null } : state;
    case "answered":
    case "declined":
      return { ...state, call: null };
    case "call_phase":
      // Answering anywhere — this tab, the other device, CallKit — moves the
      // phase off idle. The overlay's job is over the moment that happens, and
      // `call_ended` clears it too so hanging up never leaves it on screen.
      return event.callPhase === "idle" ? state : { ...state, call: null };
    case "account_changed":
      return event.viewerId === state.viewerId &&
        event.accountGen === state.accountGen
        ? state
        : { call: null, viewerId: event.viewerId, accountGen: event.accountGen };
    default:
      return state;
  }
}
