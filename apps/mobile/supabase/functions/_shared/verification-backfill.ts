/**
 * Plan resolution, batching and throttle maths for the verification-email
 * backfill (backfill-verification-emails).
 *
 * The database owns the outbox constraints and the skip rules
 * (20260917000000_verification_email_backfill.sql). This module owns what the
 * edge function decides before it sends: how many rows one invocation may
 * attempt, how they are split into batches, how long it waits between them,
 * and whether the run sends at all. All of it is testable without a database
 * and without a mail provider.
 *
 * The state machine is NOT here. The outbox uses the same state vocabulary as
 * brand_message_outbox, so the worker imports transition() and MAX_ATTEMPTS
 * from ./brand-outbox.ts rather than growing a second copy.
 */

/** Nothing sends unless the caller says so in so many words. */
export const DEFAULT_DRY_RUN = true;

/** Campaign the outbox rows are keyed under. */
export const DEFAULT_CAMPAIGN_VERSION = "verify_backfill_v1";

/** Rows one invocation may attempt when the caller names no limit. */
export const DEFAULT_LIMIT = 25;

/**
 * Rows one invocation may attempt however large a limit the caller passes.
 * 1113 accounts are waiting; a fat-fingered limit must not try them all. At
 * the default throttle the ceiling is about 63s of waiting, which stays inside
 * the edge-function wall clock.
 */
export const MAX_LIMIT = 100;

/** Sends issued concurrently inside one batch. */
export const DEFAULT_BATCH_SIZE = 4;
export const MAX_BATCH_SIZE = 25;

/** Wait between batches. Resend's default is 2 requests/second. */
export const DEFAULT_BATCH_DELAY_MS = 2500;
export const MAX_BATCH_DELAY_MS = 60_000;

/** Days before an already-mailed account may be mailed again. */
export const DEFAULT_COOLDOWN_DAYS = 3;
export const MAX_COOLDOWN_DAYS = 90;

export interface BackfillBody {
  dry_run?: unknown;
  limit?: unknown;
  batch_size?: unknown;
  batch_delay_ms?: unknown;
  cooldown_days?: unknown;
  campaign_version?: unknown;
}

export interface BackfillPlan {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  batchDelayMs: number;
  cooldownDays: number;
  campaignVersion: string;
}

/** A finite number, or null for anything a caller can mistype into the body. */
function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}

/**
 * Resolve one invocation's plan from the request body and the environment.
 *
 * Only `dry_run: false` sends. Absent, null, the string "false", a typo — all
 * of it stays a dry run, because the failure that costs something here is
 * mailing 1113 people by accident, not printing a list twice.
 *
 * Batch size and delay come from the environment so an operator can slow the
 * run down without a deploy; the body overrides them for a single invocation.
 */
export function resolvePlan(
  body: BackfillBody = {},
  env: Record<string, string | undefined> = {},
): BackfillPlan {
  const envBatch = num(env.DVNT_VERIFY_BACKFILL_BATCH_SIZE);
  const envDelay = num(env.DVNT_VERIFY_BACKFILL_DELAY_MS);

  const campaign = typeof body.campaign_version === "string"
    ? body.campaign_version.trim()
    : "";

  return {
    dryRun: body.dry_run !== false,
    limit: clamp(num(body.limit) ?? DEFAULT_LIMIT, 1, MAX_LIMIT),
    batchSize: clamp(
      num(body.batch_size) ?? envBatch ?? DEFAULT_BATCH_SIZE,
      1,
      MAX_BATCH_SIZE,
    ),
    batchDelayMs: clamp(
      num(body.batch_delay_ms) ?? envDelay ?? DEFAULT_BATCH_DELAY_MS,
      0,
      MAX_BATCH_DELAY_MS,
    ),
    cooldownDays: clamp(
      num(body.cooldown_days) ?? DEFAULT_COOLDOWN_DAYS,
      1,
      MAX_COOLDOWN_DAYS,
    ),
    campaignVersion: campaign || DEFAULT_CAMPAIGN_VERSION,
  };
}

/** Split rows into batches of at most `size`. Order is preserved. */
export function batches<T>(rows: readonly T[], size: number): T[][] {
  const width = Math.max(Math.floor(size), 1);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += width) {
    out.push(rows.slice(i, i + width));
  }
  return out;
}

/**
 * Wait before batch `index`. The first batch goes out immediately; every later
 * one pays the delay, so N batches wait (N-1) × delay in total rather than N.
 */
export function batchDelayMs(index: number, delayMs: number): number {
  return index <= 0 ? 0 : Math.max(delayMs, 0);
}

/** Wall-clock the waits alone add to a run of `rowCount` rows. */
export function throttleBudgetMs(
  rowCount: number,
  batchSize: number,
  delayMs: number,
): number {
  const count = Math.ceil(Math.max(rowCount, 0) / Math.max(batchSize, 1));
  return Math.max(count - 1, 0) * Math.max(delayMs, 0);
}

/** Sends per second the throttle allows, ignoring provider latency. */
export function sendsPerSecond(batchSize: number, delayMs: number): number {
  if (delayMs <= 0) return Infinity;
  return batchSize / (delayMs / 1000);
}

/**
 * `mi***@example.com`. The response and the logs name who was mailed without
 * writing a full address list into a log aggregator.
 */
export function maskEmail(email: string): string {
  const at = String(email || "").lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 2)}***${domain}`;
}
