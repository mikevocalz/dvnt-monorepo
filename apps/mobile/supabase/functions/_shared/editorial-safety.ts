/**
 * Pure rules for the AI editorial lanes, shared by editorial-admin and
 * process-editorial-jobs.
 *
 * They live here rather than inline in the two function bodies because the
 * deno-shared-suites CI job runs exactly one path:
 *
 *   deno test apps/mobile/supabase/functions/_shared/
 *
 * A rule written inside an edge function is a rule nothing executes in CI.
 * Every export below is a pure function — no database, no network, no clock
 * except the `now` a caller passes in — so each one is directly testable.
 *
 * NONE OF THIS IS CONTENT MODERATION. See obviousTextBlocklist.
 */

import { checkAdultBirthDate } from "./age-policy.ts";

/**
 * Lanes that can emit pixels. Generated imagery cannot be read by a string
 * check, so these lanes never lose their human approval step.
 */
export const VISUAL_CONTENT_TYPES = ["image", "video"] as const;

/** Patch keys an admin may set on an editorial profile. */
export const PROFILE_PATCH_KEYS = [
  "account_auth_id",
  "prompt_version",
  "allowed_content_types",
  "cadence",
  "quiet_hours",
  "source_policy",
  "moderation_policy",
  "engagement_budget",
  "enabled",
  "paused",
  "requires_human_approval",
] as const;

export type ProfilePatchKey = (typeof PROFILE_PATCH_KEYS)[number];

export interface EditorialProfileShape {
  slug?: unknown;
  allowed_content_types?: unknown;
  requires_human_approval?: unknown;
  source_policy?: unknown;
}

/** True when the lane is allowed to publish an image or a video. */
export function isVisualLane(allowedContentTypes: unknown): boolean {
  if (!Array.isArray(allowedContentTypes)) return false;
  return allowedContentTypes.some((t) =>
    (VISUAL_CONTENT_TYPES as readonly string[]).includes(String(t)),
  );
}

/**
 * Whether a generated job must wait for a person.
 *
 * `requires_human_approval` is an operator switch for text lanes only. On any
 * lane that can post an image or a video it is forced true and the stored
 * column is ignored, because the only automated gate in front of `approved` is
 * a substring scan of the JSON payload — which sees nothing at all in a
 * rendered image. Turning the switch off on a visual lane would hand a bot a
 * straight path from `generated` to published pixels.
 *
 * The same rule is enforced in the database by
 * editorial_profiles_visual_requires_approval, so a direct UPDATE cannot
 * disagree with this function.
 */
export function requiresHumanApproval(profile: EditorialProfileShape): boolean {
  if (isVisualLane(profile?.allowed_content_types)) return true;
  return profile?.requires_human_approval !== false;
}

export interface BlocklistResult {
  passed: boolean;
  reasons: string[];
  disclosure?: string;
}

/**
 * A substring scan for three unambiguous phrases. NOT a moderation system.
 *
 * It reads `JSON.stringify(payload)`, so it cannot see inside an image, a
 * video, a URL's contents, a synonym, a misspelling or another language. It
 * catches a generator that has echoed one of these phrases back in plain text
 * and nothing else.
 *
 * Renamed from `basicModeration` deliberately: that name read like a safety
 * check and let `requires_human_approval = false` look survivable. A real
 * moderation provider — image and video classification, not string matching —
 * must be wired in and its verdict recorded on the job before any lane is set
 * `enabled = true`.
 */
export function obviousTextBlocklist(
  payload: unknown,
  profile: EditorialProfileShape,
): BlocklistResult {
  const text = JSON.stringify(payload || {}).toLowerCase();
  const blocked = ["child sexual", "minor nude", "non-consensual"];
  const reasons = blocked.filter((phrase) => text.includes(phrase));
  const result: BlocklistResult = { passed: reasons.length === 0, reasons };
  if (profile?.slug === "astrology") {
    result.disclosure = "For entertainment/editorial purposes.";
  }
  return result;
}

/**
 * The stage a passing/failing blocklist result moves a generated job to.
 * Separate from the scan itself so the approval rule is tested on its own.
 */
export function nextStageAfterBlocklist(
  profile: EditorialProfileShape,
  result: BlocklistResult,
): "awaiting_approval" | "approved" | "rejected" {
  if (!result.passed) return "rejected";
  return requiresHumanApproval(profile) ? "awaiting_approval" : "approved";
}

/** Does this lane's source policy demand citations the caller did not supply? */
export function sourcePolicySatisfied(
  profile: EditorialProfileShape,
  sources: unknown,
): boolean {
  const policy = (profile?.source_policy || {}) as Record<string, unknown>;
  const list = Array.isArray(sources) ? sources : [];
  const needsCitations = Boolean(
    policy.citations_required ||
      policy.current_sources_required ||
      policy.citations_required_for_news,
  );
  if (needsCitations && list.length === 0) return false;
  if (policy.quote_source_required) {
    const unsourcedQuote = list.some(
      (s) => s && typeof s === "object" &&
        (s as Record<string, unknown>).quote &&
        !(s as Record<string, unknown>).url,
    );
    if (unsourcedQuote) return false;
  }
  return true;
}

export type PatchRead =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Read an admin profile patch out of a request body.
 *
 * The caller used to do `if (k in body.patch)` straight off
 * `await req.json().catch(() => ({}))`. A POST of `{"action":"profile"}` then
 * threw "Cannot use 'in' operator to search for 'account_auth_id' in
 * undefined" out of an unguarded handler, so the client got a raw stack trace
 * instead of a 400.
 */
export function readProfilePatch(body: unknown): PatchRead {
  const input = body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : null;
  const raw = input?.patch;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "A profile patch object is required" };
  }
  const source = raw as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of PROFILE_PATCH_KEYS) {
    if (key in source) patch[key] = source[key];
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No editable profile fields in the patch" };
  }
  return { ok: true, patch };
}

/**
 * Is this patch trying to bind the lane to an account?
 *
 * `account_auth_id` is the identity every published job posts under
 * (process-editorial-jobs reads profile.account_auth_id). An unvalidated value
 * here points AI output at whatever account that id names, so the caller must
 * prove the target row carries `users.is_editorial = true` before the UPDATE.
 * Returns the trimmed id to verify, or null when the patch leaves the binding
 * alone.
 */
export function boundAccountAuthId(patch: Record<string, unknown>): string | null {
  if (!("account_auth_id" in patch)) return null;
  const value = patch.account_auth_id;
  if (value === null) return null;
  return String(value ?? "").trim();
}

/**
 * 18+ from a verification row's date_of_birth.
 *
 * `identity_verifications.date_of_birth` is a `date`, which PostgREST hands
 * back as `YYYY-MM-DD`, and checkAdultBirthDate is the repo's one age rule.
 * Anything it cannot parse fails closed — an unreadable DOB is not evidence of
 * an adult.
 */
export function isVerifiedAdultDob(value: unknown, now = new Date()): boolean {
  return checkAdultBirthDate(value, now).allowed;
}

/** A verification row only clears the gate when it passed AND reads 18+. */
export function isVerifiedAdultRow(
  row: { status?: unknown; date_of_birth?: unknown } | null | undefined,
  now = new Date(),
): boolean {
  if (!row || row.status !== "passed") return false;
  return isVerifiedAdultDob(row.date_of_birth, now);
}

export const ENGAGEMENT_ACTIONS = ["like", "follow", "comment"] as const;

/** Is this a real engagement action? */
export function isEngagementAction(value: unknown): boolean {
  return (ENGAGEMENT_ACTIONS as readonly string[]).includes(String(value ?? ""));
}
