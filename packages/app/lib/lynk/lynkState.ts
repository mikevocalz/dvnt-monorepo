/**
 * Lynk Live (MoQ) connection state machine — transport-agnostic.
 *
 * Shared by `useLynkBroadcast` (host/cohost) and `useLynkViewer` (room of
 * viewers) on web AND native. The same humane states drive both screens' UI:
 *
 *   idle → requesting-token → connecting → live → reconnecting → ended
 *                                  └──────────────────────────→ error
 *
 * Maps onto the underlying `@moq` `Connection.Reload.status`
 * ("connecting" | "connected" | "disconnected") plus our token + teardown
 * lifecycle — see `lynkStateFromConnection`.
 */

export type LynkState =
  | "idle"
  | "requesting-token"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ended"
  | "error";

/** A MoQ relay connection status as surfaced by `Connection.Reload.status`. */
export type MoqConnectionStatus = "connecting" | "connected" | "disconnected";

export interface LynkStateInputs {
  /** True once we've successfully minted a scoped MoQ token. */
  hasToken: boolean;
  /** The live relay connection status (undefined before connect starts). */
  connection: MoqConnectionStatus | undefined;
  /**
   * For a viewer: at least one publisher is announced/live. For a broadcaster:
   * our own broadcast is publishing. Lets us distinguish "connected but nothing
   * on air yet" (still `connecting`) from `live`.
   */
  hasMedia: boolean;
  /** Host ended the room / we tore down intentionally. Terminal. */
  ended: boolean;
  /** A fatal error (token denied, transport gave up). Terminal. */
  error: boolean;
}

/**
 * Derive the humane `LynkState` from the raw inputs. Pure — no side effects, so
 * it is trivially unit-testable and identical across platforms.
 */
export function deriveLynkState(i: LynkStateInputs): LynkState {
  if (i.error) return "error";
  if (i.ended) return "ended";
  if (!i.hasToken) return "requesting-token";
  if (i.connection === "connected") {
    return i.hasMedia ? "live" : "connecting";
  }
  if (i.connection === "disconnected") {
    // We had a token (so we'd started); a drop after connecting = reconnecting.
    return "reconnecting";
  }
  // connection === "connecting" | undefined
  return "connecting";
}

/** Human-facing copy for each state (broadcaster + viewer share the vocabulary). */
export function lynkStateLabel(state: LynkState, role: "broadcaster" | "viewer"): string {
  switch (state) {
    case "idle":
      return role === "broadcaster" ? "Ready to go live" : "Joining…";
    case "requesting-token":
      return "Authorizing…";
    case "connecting":
      return role === "broadcaster" ? "Connecting…" : "Waiting for the stream to start…";
    case "live":
      return role === "broadcaster" ? "You're live" : "Live";
    case "reconnecting":
      return "Reconnecting…";
    case "ended":
      return role === "broadcaster" ? "Lynk ended" : "The stream has ended";
    case "error":
      return "Something went wrong";
  }
}

/** Terminal states never transition further; the hook stops reconnecting. */
export function isTerminalLynkState(state: LynkState): boolean {
  return state === "ended" || state === "error";
}
