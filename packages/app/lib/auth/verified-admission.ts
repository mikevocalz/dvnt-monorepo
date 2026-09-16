/**
 * Client mirror of apps/mobile/supabase/functions/_shared/verified-admission.ts.
 *
 * The server owns the decision: every participation rail calls
 * `resolveVerifiedAdmission` before it writes, and a client that skips this
 * module is still refused. This copy exists so the banner can say the same
 * thing the server will say, the way age-verification.ts mirrors age-policy.ts.
 * verified-admission.test.ts asserts the two agree case by case — change one
 * and you must change the other.
 */
import { calculateAge, validateDateOfBirth } from "../utils/age-verification.ts";

export interface AdmissionPolicy {
  enforce?: boolean | null;
  cohort_created_after?: string | null;
  grace_deadline?: string | null;
}

export interface AdmissionContext {
  userId: string | null | undefined;
  accountCreatedAt?: string | null;
  policy?: AdmissionPolicy | null;
  record?: { user_id?: string | null; status?: string | null; date_of_birth?: unknown } | null;
  exempt?: boolean;
  denied?: boolean;
  now?: Date;
}

export type AdmissionReason =
  | "not_enforced"
  | "out_of_cohort"
  | "exempt"
  | "verified"
  | "unauthenticated"
  | "verification_required"
  | "verification_incomplete"
  | "age_evidence_missing"
  | "underage";

export interface AdmissionVerdict {
  state: "allowed" | "grace" | "blocked";
  reason: AdmissionReason;
  deadline: string | null;
  message: string | null;
}

const PARTICIPATION = "posting, buying tickets, joining rooms and messaging";

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function inCohort(createdAt: string | null | undefined, after: string | null | undefined): boolean {
  if (!after) return true;
  const start = Date.parse(after);
  if (!Number.isFinite(start)) return true;
  const created = Date.parse(createdAt ?? "");
  return Number.isFinite(created) ? created >= start : true;
}

function blockedMessage(reason: AdmissionReason): string {
  switch (reason) {
    case "unauthenticated":
      return "Sign in to continue.";
    case "verification_incomplete":
      return `Your ID check hasn't finished. ${PARTICIPATION} open again once it's approved.`;
    case "age_evidence_missing":
      return `Your ID didn't show a readable date of birth. Submit it again to reopen ${PARTICIPATION}.`;
    case "underage":
      return `Your ID shows you're under 18. DVNT is 18+, so ${PARTICIPATION} stay closed.`;
    default:
      return `Verify your ID to continue ${PARTICIPATION}. Your account, your tickets and the verification flow stay open.`;
  }
}

export function decideVerifiedAdmission(input: AdmissionContext): AdmissionVerdict {
  const now = input.now ?? new Date();
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId) {
    return { state: "blocked", reason: "unauthenticated", deadline: null, message: blockedMessage("unauthenticated") };
  }

  // Verification never transfers between accounts. A record carrying someone
  // else's user_id is discarded, so an account switch can only lose status.
  const record = input.record && (input.record.user_id == null || input.record.user_id === userId)
    ? input.record
    : null;
  const status = typeof record?.status === "string" ? record.status : null;
  const dob = record?.date_of_birth;
  const documentAge = typeof dob === "string" || dob instanceof Date ? calculateAge(dob, now) : null;
  const adultDocument = dob === undefined || dob === null || dob === ""
    ? false
    : validateDateOfBirth(dob as Date | string, now).isValid;

  if (documentAge !== null && documentAge >= 0 && documentAge < 18) {
    return { state: "blocked", reason: "underage", deadline: null, message: blockedMessage("underage") };
  }

  const policy = input.policy ?? null;
  const allowed = (reason: AdmissionReason): AdmissionVerdict =>
    ({ state: "allowed", reason, deadline: null, message: null });

  if (!policy?.enforce) return allowed("not_enforced");
  if (input.exempt && !input.denied) return allowed("exempt");
  if (!input.denied && !inCohort(input.accountCreatedAt, policy.cohort_created_after)) {
    return allowed("out_of_cohort");
  }
  if (status === "passed" && adultDocument) return allowed("verified");

  const reason: AdmissionReason = status === null || status === "none"
    ? "verification_required"
    : status === "failed" || status === "expired"
      ? (adultDocument ? "verification_required" : "age_evidence_missing")
      : "verification_incomplete";

  const deadlineAt = policy.grace_deadline ? Date.parse(policy.grace_deadline) : NaN;
  const deadline = Number.isFinite(deadlineAt) ? new Date(deadlineAt).toISOString() : null;
  if (deadline === null || now.getTime() < deadlineAt) {
    const by = formatDeadline(deadline);
    return {
      state: "grace",
      reason,
      deadline,
      message: by
        ? `DVNT is verified-only from ${by}. Verify your ID before then to keep ${PARTICIPATION}.`
        : `DVNT is moving to verified-only. Verify your ID to keep ${PARTICIPATION}.`,
    };
  }
  return { state: "blocked", reason, deadline, message: blockedMessage(reason) };
}
