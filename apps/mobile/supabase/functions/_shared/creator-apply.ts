/**
 * The creator-program `apply` write, kept apart from the handler so the one
 * rule it exists for can be tested: a creator never names their own status.
 *
 * `creator_hosts.status` legally holds 'suspended' and 'rejected'. An upsert
 * that carried a status let a suspended creator clear their own suspension
 * (or self-approve), so this path only ever INSERTs `{ user_id }` and lets the
 * column DEFAULT ('applied') decide. When the row already exists, one
 * transition is allowed: a row a moderator created as 'invited' becomes
 * 'applied', which is the user accepting the invite. That is a single
 * conditional UPDATE keyed on the caller and on status = 'invited', with the
 * new status a constant here. Any other existing row is refused with a 409
 * that names the current status and is left exactly as it was. Every other
 * move between statuses is a moderator action; nothing here can do it.
 */

/** Postgres unique_violation. The primary key on user_id is what trips it. */
export const UNIQUE_VIOLATION = "23505";

export const CREATOR_COLUMNS =
  "user_id,status,payout_status,terms_version,terms_accepted_at";

export interface CreatorRecord {
  user_id: string;
  status: string;
  payout_status: string;
  terms_version: string | null;
  terms_accepted_at: string | null;
}

export type ApplyOutcome =
  | { kind: "created"; httpStatus: 200; creator: CreatorRecord }
  | { kind: "accepted"; httpStatus: 200; creator: CreatorRecord }
  | {
    kind: "exists";
    httpStatus: 409;
    code: "creator_application_exists";
    message: string;
    creator: CreatorRecord | null;
  }
  | { kind: "failed"; httpStatus: 500; message: string };

const EXISTS_COPY: Record<string, string> = {
  suspended:
    "Your creator account is suspended. Applying again does not lift a suspension; contact support.",
  rejected:
    "Your creator application was not approved. Applying again does not reopen it; contact support.",
  approved: "You are already an approved creator.",
};

export function existingApplicationMessage(status: string | null | undefined): string {
  return EXISTS_COPY[status ?? ""] ??
    "You already have a creator application on file.";
}

/**
 * Minimal surface of the supabase-js client this needs. Typed loosely on
 * purpose so a test double can stand in without the SDK.
 */
// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

export async function applyForCreatorProgram(
  db: Db,
  authId: string,
): Promise<ApplyOutcome> {
  // The payload is the user id and nothing else. No status, no approval
  // fields, nothing from the request body.
  const inserted = await db.from("creator_hosts").insert({ user_id: authId })
    .select(CREATOR_COLUMNS).single();
  if (!inserted.error) {
    return { kind: "created", httpStatus: 200, creator: inserted.data };
  }
  if (inserted.error.code !== UNIQUE_VIOLATION) {
    console.error("[creator-program] apply failed", inserted.error.message);
    return { kind: "failed", httpStatus: 500, message: "Could not submit creator application" };
  }

  // The row exists. Accepting an invite is the one move allowed. The status
  // filter makes this a no-op for every other status, and makes a concurrent
  // second apply lose: only one request can match status = 'invited'.
  const accepted = await db.from("creator_hosts").update({ status: "applied" })
    .eq("user_id", authId).eq("status", "invited")
    .select(CREATOR_COLUMNS).maybeSingle();
  if (accepted.error) {
    console.error("[creator-program] apply invite accept failed", accepted.error.message);
    return { kind: "failed", httpStatus: 500, message: "Could not submit creator application" };
  }
  if (accepted.data) {
    return { kind: "accepted", httpStatus: 200, creator: accepted.data as CreatorRecord };
  }

  // Not an invite. Read the row only to say which status the caller is in.
  const existing = await db.from("creator_hosts").select(CREATOR_COLUMNS)
    .eq("user_id", authId).maybeSingle();
  if (existing.error) {
    console.error("[creator-program] apply re-read failed", existing.error.message);
    return { kind: "failed", httpStatus: 500, message: "Could not submit creator application" };
  }
  const creator = (existing.data ?? null) as CreatorRecord | null;
  return {
    kind: "exists",
    httpStatus: 409,
    code: "creator_application_exists",
    message: existingApplicationMessage(creator?.status),
    creator,
  };
}
