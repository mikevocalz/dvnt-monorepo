/**
 * Shared prop contract for the EjectModal platform split. Non-split file for
 * the same resolution reason as `packages/ui/src/video/VideoTile.types.ts`.
 */

/**
 * Why the session is over. Carried structurally rather than pre-flattened into
 * a sentence, because the three cases are materially different to the person
 * they happen to:
 *   - `kick` is reversible. They can come back.
 *   - `ban` is not, and saying so is the whole point of the screen.
 *   - `room_ended` is nobody being removed at all. Rendering it through an
 *     ejection surface tells the user they were thrown out of a room that
 *     simply finished.
 *
 * The web leg had the action available and threw it away, flattening all three
 * into one string — so a ban read "removed by the host" and never mentioned
 * that it was permanent.
 */
export type EjectKind = "kick" | "ban" | "room_ended";

export interface EjectModalProps {
  visible: boolean;
  kind: EjectKind | null;
  /** Host-supplied reason, when there is one. Shown under the headline. */
  reason?: string;
  /** Acknowledgement. Eject is modal on both platforms by design — there is no
   *  dismiss-by-tapping-away, because the user has to learn why they are out. */
  onDismiss: () => void;
  /**
   * Seconds left before the room leaves on the user's behalf, or null for the
   * kinds that wait for a tap.
   *
   * Only `room_ended` counts down. A kick or a ban is information the person
   * has to actually read — hurrying them off that screen is how someone ends up
   * not knowing why they can't get back in. A room simply ending is different:
   * nothing is left to stay for, and holding a dead room on screen until it is
   * acknowledged is a chore, not a choice.
   */
  autoLeaveIn?: number | null;
}

/** Copy lives with the contract so both legs cannot drift apart again. */
export const EJECT_COPY: Record<EjectKind, { title: string; body: string; cta: string }> = {
  ban: {
    title: "You've been banned",
    body: "You can't rejoin this room.",
    cta: "Leave room",
  },
  kick: {
    title: "You've been removed",
    body: "A moderator removed you from this room.",
    cta: "Leave room",
  },
  room_ended: {
    title: "This Lynk has ended",
    body: "The host closed the room.",
    cta: "Back",
  },
};
