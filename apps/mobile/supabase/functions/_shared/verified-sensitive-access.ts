import { checkAdultBirthDate } from "./age-policy.ts";

export const LEGACY_ID_VERIFICATION_CUTOFF = "2026-07-01T00:00:00.000Z";

export type SensitiveAccessReason =
  | "verified"
  | "legacy_grandfathered"
  | "unauthenticated"
  | "verification_required"
  | "verification_incomplete"
  | "age_evidence_missing"
  | "underage"
  | "duplicate_identity"
  | "verification_unavailable";

export interface SensitiveAccessRecord {
  user_id?: string | null;
  status?: string | null;
  date_of_birth?: unknown;
  failure_code?: string | null;
}

export interface SensitiveAccessVerdict {
  allowed: boolean;
  reason: SensitiveAccessReason;
  message: string | null;
}

export interface SensitiveAccessInput {
  userId: string | null | undefined;
  accountCreatedAt?: string | null;
  record?: SensitiveAccessRecord | null;
  now?: Date;
}

const VERIFY_MESSAGE =
  "Oops… You’re not verified yet! This access is restricted to real people only. Please verify your account.";

export function decideVerifiedSensitiveAccess(
  input: SensitiveAccessInput,
): SensitiveAccessVerdict {
  const now = input.now ?? new Date();
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId) {
    return { allowed: false, reason: "unauthenticated", message: "Sign in to continue." };
  }

  const record =
    input.record &&
    (input.record.user_id == null || input.record.user_id === userId)
      ? input.record
      : null;

  const failureCode =
    typeof record?.failure_code === "string" ? record.failure_code : null;
  const status = typeof record?.status === "string" ? record.status : null;
  const age = checkAdultBirthDate(record?.date_of_birth, now);

  // Any explicit proof that the member is under 18 wins over grandfathering.
  if (age.code === "AGE_RESTRICTED" || failureCode === "underage") {
    return {
      allowed: false,
      reason: "underage",
      message: "DVNT is for adults 18 and older.",
    };
  }

  if (failureCode === "duplicate_identity") {
    return {
      allowed: false,
      reason: "duplicate_identity",
      message: "This identity cannot be used to verify this account.",
    };
  }

  if (status === "passed" && age.allowed) {
    return { allowed: true, reason: "verified", message: null };
  }

  const createdAt = input.accountCreatedAt
    ? Date.parse(input.accountCreatedAt)
    : Number.NaN;
  const cutoff = Date.parse(LEGACY_ID_VERIFICATION_CUTOFF);
  if (Number.isFinite(createdAt) && createdAt < cutoff) {
    return { allowed: true, reason: "legacy_grandfathered", message: null };
  }

  if (status === "pending" || status === "submitted" || status === "review") {
    return {
      allowed: false,
      reason: "verification_incomplete",
      message: VERIFY_MESSAGE,
    };
  }

  if (status === "passed" && !age.allowed) {
    return {
      allowed: false,
      reason: "age_evidence_missing",
      message: "We need a valid adult date of birth from your ID before this access can open.",
    };
  }

  return {
    allowed: false,
    reason: "verification_required",
    message: VERIFY_MESSAGE,
  };
}

export async function resolveVerifiedSensitiveAccess(
  db: any,
  userId: string | null | undefined,
  now = new Date(),
): Promise<SensitiveAccessVerdict> {
  if (!userId) return decideVerifiedSensitiveAccess({ userId, now });

  const [accountResult, verificationResult] = await Promise.all([
    db.from("user").select("id,createdAt").eq("id", userId).maybeSingle(),
    db
      .from("identity_verifications")
      .select("user_id,status,date_of_birth,failure_code")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (verificationResult?.error) {
    console.error(
      "[verified-sensitive-access] verification read failed:",
      verificationResult.error.message,
    );
    return {
      allowed: false,
      reason: "verification_unavailable",
      message: "We can’t confirm verification right now. Please try again.",
    };
  }

  const base = decideVerifiedSensitiveAccess({
    userId,
    accountCreatedAt: accountResult?.error
      ? null
      : accountResult?.data?.createdAt ?? null,
    record: verificationResult?.data ?? null,
    now,
  });

  // A passed adult ID is enough even if the account-age lookup is temporarily
  // unavailable. Every other state needs the account timestamp to know whether
  // the July grandfather rule applies, so fail closed rather than guessing.
  if (accountResult?.error && !base.allowed) {
    console.error(
      "[verified-sensitive-access] account read failed:",
      accountResult.error.message,
    );
    return {
      allowed: false,
      reason: "verification_unavailable",
      message: "We can’t confirm verification right now. Please try again.",
    };
  }

  return base;
}

export function sensitiveAccessRefusal(verdict: SensitiveAccessVerdict) {
  return {
    code: "verification_required",
    reason: verdict.reason,
    message: verdict.message ?? VERIFY_MESSAGE,
  };
}
