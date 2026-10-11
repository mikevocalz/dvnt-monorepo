import type { NormalizedVerification } from "./verification-state.ts";

/**
 * Bridge SPICY publication refusals to the verification popup already deployed
 * on web/native. Keep the nested legacy error code for existing API consumers.
 * Used only by the explicit SPICY branch, never the ticket/first-post campaign.
 * This formats a refusal; it cannot grant verification or write a post.
 */
export function spicyPostRefusal(verification: NormalizedVerification) {
  const reason = verification.reason === "underage" ? "underage"
    : verification.reason === "duplicate_identity" ? "duplicate_identity"
    : verification.state === "pending" ? "verification_incomplete"
    : verification.reason === "age_evidence_missing" ? "age_evidence_missing"
    : "verification_required";
  return {
    ok: false as const,
    // Duplicate-identity refusals need support, not another capture session.
    code: reason === "duplicate_identity" ? "adult_verification_required" : "verification_required",
    reason,
    error: {
      code: "adult_verification_required",
      reason,
      retryable: verification.retryable,
      message: verification.message || "Verify that you're 18 or older before posting SPICY content.",
    },
  };
}
