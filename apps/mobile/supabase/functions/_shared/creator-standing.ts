/**
 * Creator standing — one server-owned answer to "may this account host?".
 *
 * `creator_hosts.status` was read in exactly one place, the creator-program
 * `schedule` action, so a suspended creator kept hosting through the ordinary
 * rails: video_create_room minted Lynk rooms and create-event published
 * events, neither of which had ever heard of the table. Moderation that only
 * closes one of three doors is not moderation.
 *
 * Shape follows `verified-admission.ts` on purpose: a pure decision function
 * the tests drive directly, a thin service-role resolver that reads the row,
 * and one refusal body so a single client handler covers every rail.
 *
 * Scope: an account with no `creator_hosts` row is NOT a creator and is
 * allowed — the gate must never turn an ordinary member into a refused host.
 * Only an enrolled account whose status says otherwise is refused.
 */

/** Statuses that close hosting. `creator_hosts.status` CHECK owns the vocabulary. */
const REFUSED: Record<string, CreatorStandingReason> = {
  suspended: "suspended",
  rejected: "rejected",
  paused: "paused",
};

export type CreatorStandingReason =
  | "not_enrolled"
  | "in_good_standing"
  | "unauthenticated"
  | "standing_unavailable"
  | "suspended"
  | "rejected"
  | "paused";

export interface CreatorHostRecord {
  user_id?: string | null;
  status?: string | null;
  suspended_at?: string | null;
  suspension_reason?: string | null;
}

export interface CreatorStandingContext {
  userId: string | null | undefined;
  /** The account's own creator_hosts row. A row carrying a different user_id is discarded. */
  record?: CreatorHostRecord | null;
}

export interface CreatorStandingVerdict {
  state: "allowed" | "refused";
  reason: CreatorStandingReason;
  /** Null whenever hosting is open. */
  message: string | null;
}

function refusedMessage(reason: CreatorStandingReason): string {
  switch (reason) {
    case "suspended":
      return "Your creator hosting is suspended. Rooms and events stay closed until DVNT reinstates you.";
    case "rejected":
      return "Your creator application was declined, so creator hosting is closed.";
    case "paused":
      return "Your creator hosting is paused. Reach out to DVNT to resume hosting.";
    case "standing_unavailable":
      return "Hosting could not be verified. Try again shortly.";
    default:
      return "Creator hosting is not available on this account.";
  }
}

export function decideCreatorStanding(
  input: CreatorStandingContext,
): CreatorStandingVerdict {
  const userId = typeof input.userId === "string" ? input.userId.trim() : "";
  if (!userId) {
    return {
      state: "refused",
      reason: "unauthenticated",
      message: "Sign in to continue.",
    };
  }

  // Standing never transfers between accounts. A row that arrived from a stale
  // cache or a mis-joined query is treated as no row at all — the same rule
  // verified-admission applies, and it can only ever lose standing, never
  // inherit someone else's suspension.
  const record = input.record &&
      (input.record.user_id == null || input.record.user_id === userId)
    ? input.record
    : null;
  if (!record) {
    return { state: "allowed", reason: "not_enrolled", message: null };
  }

  const status = typeof record.status === "string" ? record.status.trim() : "";
  const reason = REFUSED[status];
  if (reason) {
    return { state: "refused", reason, message: refusedMessage(reason) };
  }
  return { state: "allowed", reason: "in_good_standing", message: null };
}

/** The refusal body every host rail returns, so one client handler covers all of them. */
export function creatorStandingRefusal(verdict: CreatorStandingVerdict) {
  return {
    code: "creator_hosting_closed",
    reason: verdict.reason,
    message: verdict.message ?? refusedMessage(verdict.reason),
  };
}

/**
 * Server verdict for one account. Service-role client only.
 *
 * A failed read refuses rather than admits. Standing is a moderation control:
 * the safe direction when the database will not answer is the closed door, and
 * the blast radius is bounded because only enrolled creators can be refused
 * for any reason other than a read failure.
 */
export async function resolveCreatorStanding(
  db: any,
  userId: string | null | undefined,
): Promise<CreatorStandingVerdict> {
  if (!userId) return decideCreatorStanding({ userId });
  const { data, error } = await db
    .from("creator_hosts")
    .select("user_id,status,suspended_at,suspension_reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[creator-standing] read failed:", error.message);
    return {
      state: "refused",
      reason: "standing_unavailable",
      message: refusedMessage("standing_unavailable"),
    };
  }
  return decideCreatorStanding({ userId, record: data ?? null });
}
