/**
 * Who may be offered, and may publish, the ticket -> first-post draft.
 *
 * The checklist says the post goes out only after adult verification, so this
 * gate requires an approved adult record whatever `verified_admission_policy`
 * says. While that policy is off (`enforce = false`), the general posting rail
 * still admits unverified members; this campaign does not.
 *
 * Pure so node:test can reach it. Callers load the verification state with
 * `resolveAdultVerificationState` (the same reader create-post uses for SPICY)
 * and the event row, then ask this function.
 */

export interface FirstPostGateInput {
  /** `NormalizedVerification.state` from resolveAdultVerificationState. */
  verificationState: string | null | undefined;
  /**
   * Raw `events.visibility`, or undefined when the caller has not read the
   * event (the offer endpoint checks visibility on its own path).
   */
  eventVisibility?: unknown;
  /** Set false when the event read failed or found no row. */
  eventFound?: boolean;
}

export interface FirstPostRefusal {
  code: "adult_verification_required" | "event_not_public";
  message: string;
}

export function firstPostRefusal(input: FirstPostGateInput): FirstPostRefusal | null {
  if (input.verificationState !== "approved") {
    return {
      code: "adult_verification_required",
      message: "Verify that you're 18 or older before posting about your ticket.",
    };
  }
  if (input.eventFound === false || (input.eventVisibility !== undefined && input.eventVisibility !== "public")) {
    return {
      code: "event_not_public",
      message: "This event is no longer public, so this draft can't be posted. Edit the text to remove the event first.",
    };
  }
  return null;
}
