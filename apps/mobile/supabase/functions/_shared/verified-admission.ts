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
import { determineNewMemberStep, NEW_MEMBER_ONBOARDING_CUTOFF } from "./new-member-onboarding.ts";

/**
 * Every account is in scope once `enforce` is on (checklist A03). There is no
 * account-age exemption: the `cohort_created_after` column still exists in
 * verified_admission_policy but nothing reads it.
 */
export interface AdmissionPolicy {
  enforce?: boolean | null;
  /** Prompt-only until this instant, refused after it. Null = no grace: refused as soon as enforce is on. */
  grace_deadline?: string | null;
}

export interface AdmissionRecord {
  user_id?: string | null;
  status?: string | null;
  date_of_birth?: unknown;
}

export interface AdmissionContext {
  userId: string | null | undefined;
  policy?: AdmissionPolicy | null;
  /** The account's own identity_verifications row. A row carrying a different user_id is discarded. */
  record?: AdmissionRecord | null;
  /** Operator allowlist hit: admitted while enforcement runs. */
  exempt?: boolean;
  /** Operator denylist hit: refused even when allowlisted. */
  denied?: boolean;
  /**
   * Profile created by guest checkout with no date of birth. Locked out of
   * participation until verification passes, whatever the rollout says.
   */
  restricted?: boolean;
  now?: Date;
}

export type AdmissionReason =
  | "not_enforced"
  | "exempt"
  | "verified"
  | "unauthenticated"
  | "verification_required"
  | "verification_incomplete"
  | "age_evidence_missing"
  | "underage"
  | "restricted_profile"
  | "profile_photo_required"
  | "first_post_required";

export interface AdmissionVerdict {
  state: "allowed" | "grace" | "blocked";
  reason: AdmissionReason;
  /** ISO instant the grace period ends, when the operator has set one. */
  deadline: string | null;
  message: string | null;
}

/**
 * What the gate closes. Read access, ticket purchase, the ticket wallet and the
 * verification flow stay open (checklist A01/A03).
 */
const PARTICIPATION = "posting, commenting, messaging, hosting and joining rooms";

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
    case "profile_photo_required":
      return "Before joining the DVNT community, upload a profile photo and save it successfully.";
    case "first_post_required":
      return "Your photo is saved. Publish your first post to unlock the full DVNT community.";
    case "restricted_profile":
      return "Verify your ID to start posting, commenting, messaging and joining rooms. Your tickets are already in your account.";
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

  // A profile made at guest checkout never gave a date of birth. It stays
  // locked until an adult document passes, even with the rollout switched off
  // and even for an allowlisted id: the allowlist exempts members, and this
  // account has not been through signup's age check.
  if (input.restricted && !(status === "passed" && documentAge.allowed)) {
    return {
      state: "blocked",
      reason: "restricted_profile",
      deadline: null,
      message: blockedMessage("restricted_profile"),
    };
  }

  if (!policy?.enforce) return allowed("not_enforced");
  if (input.exempt && !input.denied) return allowed("exempt");
  if (status === "passed" && documentAge.allowed) return allowed("verified");

  const reason: AdmissionReason = status === null || status === "none"
    ? "verification_required"
    : status === "failed" || status === "expired"
      ? (documentAge.code === "DATE_OF_BIRTH_REQUIRED" || documentAge.code === "INVALID_DATE_OF_BIRTH"
        ? "age_evidence_missing"
        : "verification_required")
      : "verification_incomplete";

  // Grace is opt-in. With no deadline set, an enforced policy refuses at once;
  // only a future grace_deadline turns the refusal into a prompt.
  const deadlineAt = policy.grace_deadline ? Date.parse(policy.grace_deadline) : NaN;
  const deadline = Number.isFinite(deadlineAt) ? new Date(deadlineAt).toISOString() : null;
  if (deadline !== null && now.getTime() < deadlineAt) {
    return {
      state: "grace",
      reason,
      deadline,
      message: `DVNT is verified-only from ${formatDeadline(deadline)}. Verify your ID before then to keep ${PARTICIPATION}.`,
    };
  }
  return { state: "blocked", reason, deadline, message: blockedMessage(reason) };
}

/** The refusal body every participation rail returns, so one client handler covers all of them. */
export function admissionRefusal(verdict: AdmissionVerdict) {
  return {
    code: verdict.reason === "profile_photo_required" || verdict.reason === "first_post_required"
      ? "profile_completion_required" : "verification_required",
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
  opts: { purpose?: "participation" | "ticket_purchase" | "first_post" } = {},
): Promise<AdmissionVerdict> {
  if (!userId) return decideVerifiedAdmission({ userId, now });
  // Buying a ticket is the one thing a checkout-created profile can always do
  // (checklist A01), so the ticket rails skip the restricted read entirely.
  const checkRestricted = opts.purpose !== "ticket_purchase";
  const [policyResult, recordResult, restrictedResult] = await Promise.all([
    db.from("verified_admission_policy")
      .select("enforce, grace_deadline, allowlist, denylist")
      .eq("id", 1).maybeSingle(),
    db.from("identity_verifications")
      .select("user_id, status, date_of_birth").eq("user_id", userId).maybeSingle(),
    checkRestricted
      ? db.rpc("is_checkout_restricted", { p_auth_id: userId })
      : Promise.resolve({ data: false, error: null }),
  ]);

  const restricted = readRestricted(restrictedResult);
  if (restricted === null) {
    return {
      state: "blocked",
      reason: "verification_required",
      deadline: null,
      message: `We can't confirm your access right now. Try again in a moment and ${PARTICIPATION} will open if your account is verified.`,
    };
  }

  // An unreadable policy row refuses rather than falling back to enforcement
  // off. Once `enforce` is true, an open fallback would let a transient read
  // failure admit every unverified account. A proven-underage record would
  // still block (the AGE_RESTRICTED branch runs first), but a signup with no
  // verification record, the case this gate exists for, would pass. The
  // message says it is a config read and claims nothing about the account.
  if (policyResult?.error) {
    console.error("[verified-admission] policy read failed:", policyResult.error.message);
    return {
      state: "blocked",
      reason: "verification_required",
      deadline: null,
      message: `We can't confirm your access right now. Try again in a moment and ${PARTICIPATION} will open if your account is verified.`,
    };
  }
  const policy: AdmissionPolicy & { allowlist?: unknown; denylist?: unknown } | null =
    policyResult?.data ?? null;
  const has = (list: unknown) => Array.isArray(list) && list.map(String).includes(userId);

  const verdict = decideVerifiedAdmission({
    userId,
    policy,
    record: recordResult?.error ? null : recordResult?.data ?? null,
    exempt: has(policy?.allowlist),
    denied: has(policy?.denylist),
    restricted,
    now,
  });
  if (opts.purpose === "ticket_purchase" || verdict.state === "blocked") return verdict;

  // The mandatory onboarding gate is independent of the legacy verified-only
  // rollout. It only applies to NEW Better Auth signups, never old accounts,
  // and cannot be lifted by localStorage or a fabricated posts_count.
  const { data: account, error: accountError } = await db.from("user")
    .select("id,createdAt,emailVerified,image").eq("id", userId).maybeSingle();
  if (accountError || !account) return verdict;
  const createdAt = Date.parse(String(account.createdAt || ""));
  if (!Number.isFinite(createdAt) || createdAt < Date.parse(NEW_MEMBER_ONBOARDING_CUTOFF))
    return verdict;

  const { data: member, error: memberError } = await db.from("users")
    .select("id,avatar_id").eq("auth_id", userId).maybeSingle();
  if (memberError || !member) {
    return { state: "blocked", reason: "profile_photo_required", message: "We couldn't confirm your profile. Retry.", deadline: null };
  }
  const [{ data: avatar, error: avatarError }, { data: posts, error: postError }] =
    await Promise.all([
      member.avatar_id == null
        ? Promise.resolve({ data: null, error: null })
        : db.from("media").select("url").eq("id",member.avatar_id).maybeSingle(),
      db.from("posts").select("id").eq("author_id",member.id).limit(1),
    ]);
  if (avatarError || postError) {
    return { state: "blocked", reason: "profile_photo_required", message: "We couldn't confirm your setup. Retry.", deadline: null };
  }
  const step = determineNewMemberStep({
    accountCreatedAt: account.createdAt,
    emailVerified: account.emailVerified === true,
    adultVerified: recordResult?.data?.status === "passed" &&
      checkAdultBirthDate(recordResult.data.date_of_birth, now).allowed,
    hasProfilePhoto: Boolean(String(avatar?.url ?? account.image ?? "").trim()),
    hasPost: Array.isArray(posts) && posts.length > 0,
  });
  if (step === "pending_verification") return {
    state: "blocked", reason: "verification_required",
    message: "Finish ID and email verification before entering the community.",
    deadline: null,
  };
  if (step === "photo") return {
    state: "blocked", reason: "profile_photo_required",
    message: blockedMessage("profile_photo_required"), deadline: null,
  };
  if (step === "first_post" && opts.purpose !== "first_post") return {
    state: "blocked", reason: "first_post_required",
    message: blockedMessage("first_post_required"), deadline: null,
  };
  return verdict;
}

/**
 * true/false from is_checkout_restricted, or null when the answer is unknown.
 *
 * A missing function means this code shipped before its migration did: no
 * restricted profile can exist yet, so it reads as false. Any other error is
 * unknown, and the caller refuses rather than admitting a profile that may be
 * locked, the same direction as the policy read above.
 */
export function readRestricted(
  result: { data?: unknown; error?: { code?: string; message?: string } | null } | null | undefined,
): boolean | null {
  const error = result?.error;
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return false;
    console.error("[verified-admission] restricted read failed:", error.message);
    return null;
  }
  return result?.data === true;
}
