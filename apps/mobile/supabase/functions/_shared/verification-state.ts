import { checkAdultBirthDate } from "./age-policy.ts";

export type VerificationState =
  | "not_started"
  | "pending"
  | "approved"
  | "retry_required"
  | "rejected";

export interface VerificationRecord {
  user_id?: string | null;
  status?: string | null;
  date_of_birth?: unknown;
  failure_code?: string | null;
  failure_message?: string | null;
  provider_ref?: string | null;
}

export interface NormalizedVerification {
  state: VerificationState;
  retryable: boolean;
  reason: string | null;
  message: string | null;
  providerRef: string | null;
}

const NON_RETRYABLE_FAILURES = new Set(["underage", "duplicate_identity"]);

export function normalizeVerificationState(
  record: VerificationRecord | null | undefined,
  now = new Date(),
): NormalizedVerification {
  if (!record) {
    return { state: "not_started", retryable: true, reason: null, message: null, providerRef: null };
  }

  const status = typeof record.status === "string" ? record.status : "pending";
  const failureCode = typeof record.failure_code === "string" ? record.failure_code : null;
  const failureMessage = typeof record.failure_message === "string" ? record.failure_message : null;
  const providerRef = typeof record.provider_ref === "string" ? record.provider_ref : null;
  const age = checkAdultBirthDate(record.date_of_birth, now);

  if (age.code === "AGE_RESTRICTED" || NON_RETRYABLE_FAILURES.has(failureCode ?? "")) {
    return {
      state: "rejected",
      retryable: false,
      reason: failureCode || "underage",
      message: failureMessage || "DVNT is for adults 18 and older.",
      providerRef,
    };
  }

  if (status === "passed" && age.allowed) {
    return { state: "approved", retryable: false, reason: null, message: null, providerRef };
  }

  if (status === "pending" || status === "submitted" || status === "review") {
    return {
      state: "pending",
      retryable: status !== "review",
      reason: failureCode,
      message: failureMessage,
      providerRef,
    };
  }

  if (status === "failed" || status === "expired" || (status === "passed" && !age.allowed)) {
    return {
      state: "retry_required",
      retryable: true,
      reason: failureCode || (age.allowed ? null : "age_evidence_missing"),
      message: failureMessage || "We couldn't finish age verification. Please try again.",
      providerRef,
    };
  }

  return { state: "not_started", retryable: true, reason: failureCode, message: failureMessage, providerRef };
}

export async function resolveAdultVerificationState(
  db: any,
  userId: string | null | undefined,
  now = new Date(),
): Promise<NormalizedVerification> {
  if (!userId) {
    return { state: "not_started", retryable: false, reason: "unauthenticated", message: "Sign in to verify.", providerRef: null };
  }
  const { data, error } = await db
    .from("identity_verifications")
    .select("user_id,status,date_of_birth,failure_code,failure_message,provider_ref")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[verification-state] own record read failed:", error.message);
    return { state: "retry_required", retryable: true, reason: "verification_unavailable", message: "Verification status is temporarily unavailable.", providerRef: null };
  }
  if (data && data.user_id !== userId) {
    return { state: "not_started", retryable: true, reason: "account_changed", message: "Verify this account before continuing.", providerRef: null };
  }
  return normalizeVerificationState(data, now);
}
