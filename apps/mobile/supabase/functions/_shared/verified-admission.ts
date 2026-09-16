/**
 * Verified-only admission for the existing membership.
 *
 * One server-owned decision. The participation edge functions call
 * `resolveVerifiedAdmission` before they write; the client reads the same
 * inputs through `public.verified_admission_context()` and runs
 * `decideVerifiedAdmission` to draw its banner, so the screen and the server
 * cannot disagree.
 *
 * Enforcement is configuration, not code: `verified_admission_policy` ships
 * with `enforce = false`, so merging this changes nothing for live members.
 */
import { checkAdultBirthDate } from "./age-policy.ts";

export interface AdmissionPolicy {
  enforce?: boolean | null;
  /** Accounts created before this instant stay out of scope. Null = whole membership. */
  cohort_created_after?: string | null;
  /** Participation is refused from this instant. Null = prompt only, never refuse. */
  grace_deadline?: string | null;
}

export interface AdmissionRecord {
  user_id?: string | null;
  status?: string | null;
  date_of_birth?: unknown;
}

export interface AdmissionContext {
  userId: string | null | undefined;
  /** Better Auth `user.createdAt`. Unknown means in scope. */
  accountCreatedAt?: string | null;
  policy?: AdmissionPolicy | null;
  /** The account's own identity_verifications row. A row carrying a different user_id is discarded. */
  record?: AdmissionRecord | null;
  /** Operator allowlist hit: admitted while enforcement runs. */
  exempt?: boolean;
  /** Operator denylist hit: in scope whatever the cohort date says. */
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
  /** ISO instant the grace period ends, when the operator has set one. */
  deadline: string | null;
  message: string | null;
}

/** What the gate closes. Read access and the verification flow stay open. */
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
  // An unusable cohort date or an unknown account age puts the account in
  // scope: the safe direction is a verification prompt, not a silent pass.
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

  // Verification never transfers between accounts. A row that arrived from a
  // stale cache or a mis-joined query is treated as no record at all, so an
  // account switch can only ever lose status, never inherit it.
  const record = input.record && (input.record.user_id == null || input.record.user_id === userId)
    ? input.record
    : null;
  const status = typeof record?.status === "string" ? record.status : null;
  const documentAge = checkAdultBirthDate(record?.date_of_birth, now);

  // A document that proves the holder is under 18 closes participation whatever
  // the rollout configuration says. The age gate only ever tightens.
  if (documentAge.code === "AGE_RESTRICTED") {
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
  if (status === "passed" && documentAge.allowed) return allowed("verified");

  const reason: AdmissionReason = status === null || status === "none"
    ? "verification_required"
    : status === "failed" || status === "expired"
      ? (documentAge.code === "DATE_OF_BIRTH_REQUIRED" || documentAge.code === "INVALID_DATE_OF_BIRTH"
        ? "age_evidence_missing"
        : "verification_required")
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

/** The refusal body every participation rail returns, so one client handler covers all of them. */
export function admissionRefusal(verdict: AdmissionVerdict) {
  return {
    code: "verification_required",
    reason: verdict.reason,
    message: verdict.message ?? blockedMessage("verification_required"),
  };
}

/**
 * Server verdict for one account. Service-role client only — it reads the
 * operator lists, which never reach a browser or a device.
 */
export async function resolveVerifiedAdmission(
  db: any,
  userId: string | null | undefined,
  now = new Date(),
): Promise<AdmissionVerdict> {
  if (!userId) return decideVerifiedAdmission({ userId, now });
  const [policyResult, recordResult, accountResult] = await Promise.all([
    db.from("verified_admission_policy")
      .select("enforce, cohort_created_after, grace_deadline, allowlist, denylist")
      .eq("id", 1).maybeSingle(),
    db.from("identity_verifications")
      .select("user_id, status, date_of_birth").eq("user_id", userId).maybeSingle(),
    db.from("user").select("createdAt").eq("id", userId).maybeSingle(),
  ]);

  // ponytail: an unreadable policy row falls back to enforcement off, which is
  // exactly the behaviour shipping today. Failing closed on a config read would
  // take the whole app down over a gate the operator has not switched on.
  if (policyResult?.error) {
    console.error("[verified-admission] policy read failed:", policyResult.error.message);
  }
  const policy: AdmissionPolicy & { allowlist?: unknown; denylist?: unknown } | null =
    policyResult?.error ? null : policyResult?.data ?? null;
  const has = (list: unknown) => Array.isArray(list) && list.map(String).includes(userId);

  return decideVerifiedAdmission({
    userId,
    accountCreatedAt: accountResult?.data?.createdAt ?? null,
    policy,
    // A failed read is no record, so an enforced account is refused rather than admitted.
    record: recordResult?.error ? null : recordResult?.data ?? null,
    exempt: has(policy?.allowlist),
    denied: has(policy?.denylist),
    now,
  });
}
