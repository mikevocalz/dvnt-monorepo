/**
 * Host mute is a LOCK, not a remote microphone switch.
 *
 * The rule, as specified:
 *   - A host can mute everyone, or one participant.
 *   - A participant can mute themselves. They cannot mute anyone else.
 *   - While the host holds the mute, a participant CANNOT unmute themselves.
 *     They stay locked until the host lifts it.
 *   - Lifting the mute restores the participant's control. It does not turn
 *     their microphone on. Who speaks next is their decision.
 *
 * That last clause is the whole point of this module. The native client used to
 * treat `unmute_peer` / `unmute_all` as `setMicEnabled(true)`, so a host could
 * remotely open any participant's microphone — in rooms that are anonymous by
 * design. A host granting permission to speak is not the same as a host taking
 * the microphone.
 *
 * The host is never locked; they are the one holding the lock.
 */

export type HostMuteEvent = "mute_peer" | "mute_all" | "unmute_peer" | "unmute_all";

export interface HostMuteState {
  /** True while the host is holding this participant muted. */
  locked: boolean;
}

export const NO_HOST_MUTE: HostMuteState = { locked: false };

export interface HostMuteContext {
  isHost: boolean;
  /** True when the event named this participant specifically. */
  targetsSelf: boolean;
}

/**
 * Fold a host-moderation event into the local lock state.
 * Returns the state unchanged when the event is not ours to act on, so a
 * caller can compare by identity to decide whether anything happened.
 */
export function applyHostMuteEvent(
  state: HostMuteState,
  event: HostMuteEvent,
  { isHost, targetsSelf }: HostMuteContext,
): HostMuteState {
  // The host holds the lock; it is never applied to them.
  if (isHost) return state;

  switch (event) {
    case "mute_all":
      return state.locked ? state : { locked: true };
    case "unmute_all":
      return state.locked ? { locked: false } : state;
    case "mute_peer":
      return targetsSelf && !state.locked ? { locked: true } : state;
    case "unmute_peer":
      return targetsSelf && state.locked ? { locked: false } : state;
  }
}

/** Should the local microphone be stopped as a result of this event? */
export function shouldStopMic(
  event: HostMuteEvent,
  { isHost, targetsSelf }: HostMuteContext,
): boolean {
  if (isHost) return false;
  return event === "mute_all" || (event === "mute_peer" && targetsSelf);
}

/** Whether the participant may turn their own microphone on right now. */
export function canSelfUnmute(state: HostMuteState, isHost: boolean): boolean {
  return isHost || !state.locked;
}

export const HOST_MUTE_COPY = {
  mutedByHost: "The host muted you.",
  mutedAll: "The host muted everyone.",
  /** Shown when a locked participant taps their own mic button. States the
   *  rule and who can change it, rather than failing silently. */
  blocked: "You can't unmute until the host allows it.",
  released: "The host lifted the mute. You can unmute when you're ready.",
} as const;
