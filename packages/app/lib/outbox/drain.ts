/**
 * Outbox drain — executor registry + FIFO drain loop (WS-12).
 *
 * Pure module (no react-native imports) so the loop is testable under
 * `node --import tsx --test`. Production triggers (connectivity→online,
 * AppState foreground) live in `./index.ts`.
 *
 * ── MONEY LAW ──────────────────────────────────────────────────────────
 * Paid checkout, refunds and payouts NEVER enqueue. Money mutations must
 * fail loudly in front of the user, synchronously, online — a durable
 * retry queue replaying a charge/refund/payout after the user walked away
 * is how you double-charge people. Enforced below by the registration
 * denylist (MONEY_DENYLIST): mutationTypes matching /checkout|refund|payout/
 * throw in dev and are refused (+ Sentry breadcrumb) in prod.
 * ───────────────────────────────────────────────────────────────────────
 */

import type { OutboxExecutor } from "./types";
import { isTerminalOutboxError } from "./types";
import type { OutboxStore } from "./store";

// ─── Executor registry ──────────────────────────────────────────────────────
// Feature code registers `mutationType → executor`. The outbox module has
// ZERO feature imports — the dependency arrow only ever points feature→outbox.

const executors = new Map<string, OutboxExecutor>();

/** Money law denylist — see module header. */
export const MONEY_DENYLIST = /checkout|refund|payout/i;

const IS_DEV: boolean =
  typeof __DEV__ !== "undefined"
    ? __DEV__
    : typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production";

/**
 * Register the executor for a mutationType. Call once from feature code
 * at module scope (before the first drain). Re-registering the same type
 * replaces the executor (hot-reload friendly).
 *
 * @throws in dev if mutationType matches the money denylist.
 */
export function registerOutboxExecutor(
  mutationType: string,
  executor: OutboxExecutor,
): void {
  if (MONEY_DENYLIST.test(mutationType)) {
    const msg =
      `[Outbox] REFUSED executor registration for "${mutationType}" — ` +
      `money mutations (checkout/refund/payout) never enqueue. ` +
      `See MONEY LAW in lib/outbox/drain.ts.`;
    if (IS_DEV) throw new Error(msg);
    console.error(msg);
    sentryBreadcrumb("outbox.money_denylist", msg, { mutationType }, "error");
    return;
  }
  executors.set(mutationType, executor);
}

/** Test/teardown helper. */
export function unregisterOutboxExecutor(mutationType: string): void {
  executors.delete(mutationType);
}

// ─── Backoff ────────────────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000; // 5 min ceiling
const BACKOFF_JITTER_MS = 1_000;

/** Exponential backoff + jitter: 2s, 4s, 8s … capped at 5 min, +0–1s jitter. */
export function backoffMs(
  attempts: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
  return exp + Math.floor(random() * BACKOFF_JITTER_MS);
}

// ─── Sentry breadcrumb (same defensive pattern as diagnostics/app-trace.ts) ─

function sentryBreadcrumb(
  category: string,
  message: string,
  data: Record<string, string | number | boolean | null>,
  level: "warning" | "error",
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/react-native");
    Sentry.addBreadcrumb({ category, message, data, level });
  } catch {
    // Sentry is optional in this app.
  }
}

// ─── Drain loop ─────────────────────────────────────────────────────────────

export interface DrainOptions {
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable jitter source for tests. */
  random?: () => number;
  /** Sync gate — return false to skip the pass (wired to isOnline() in prod). */
  isOnline?: () => boolean;
}

export interface DrainResult {
  succeeded: number;
  retried: number;
  terminal: number;
  skippedNotDue: number;
  /** ms until the earliest backed-off entry is due, or null if none remain. */
  nextDueInMs: number | null;
}

let _draining = false;

/**
 * Run one drain pass: process every due 'queued' entry in FIFO order.
 * Sequential global drain — one entry at a time, awaited.
 *
 * ponytail: v1 is deliberately a single global FIFO. The upgrade, when a
 * consumer actually needs it, is per-entityRef lanes: entries sharing an
 * entityRef stay serialized (ordering is a correctness property), while
 * different refs drain in parallel via Promise.all over lane queues.
 * Don't build it until something measurably queues enough to care.
 *
 * Concurrency-guarded: a second call while a pass is running returns
 * immediately (the running pass reads fresh store state each iteration,
 * so entries enqueued mid-pass are picked up).
 */
export async function drainOutbox(
  store: OutboxStore,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const now = opts.now ?? Date.now;
  const result: DrainResult = {
    succeeded: 0,
    retried: 0,
    terminal: 0,
    skippedNotDue: 0,
    nextDueInMs: null,
  };
  if (_draining) return result;
  _draining = true;
  try {
    // Snapshot the keys we saw retry THIS pass so we don't spin on an
    // entry whose backoff already elapsed within the same pass.
    const retriedThisPass = new Set<string>();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (opts.isOnline && !opts.isOnline()) break;
      const t = now();
      const next = store
        .getState()
        .entries.find(
          (e) =>
            e.status === "queued" &&
            (e.nextAttemptAt ?? 0) <= t &&
            !retriedThisPass.has(e.idempotencyKey),
        );
      if (!next) break;

      const executor = executors.get(next.mutationType);
      if (!executor) {
        // No executor registered (feature module not loaded yet). Leave
        // the entry queued for a later pass — but don't spin on it now.
        retriedThisPass.add(next.idempotencyKey);
        result.skippedNotDue += 1;
        continue;
      }

      store.getState().markInflight(next.idempotencyKey);
      try {
        await executor(next);
        store.getState().remove(next.idempotencyKey);
        result.succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isTerminalOutboxError(err)) {
          // 4xx/validation → parked, retained, NEVER silently dropped and
          // NEVER retried. Breadcrumb includes queue age per WS-12 spec.
          store.getState().markTerminal(next.idempotencyKey, message);
          result.terminal += 1;
          sentryBreadcrumb(
            "outbox.terminal_failure",
            `Outbox entry failed terminally: ${next.mutationType}`,
            {
              mutationType: next.mutationType,
              entityType: next.entityType,
              entityRef: next.entityRef,
              idempotencyKey: next.idempotencyKey,
              attempts: next.attempts + 1,
              queueAgeMs: now() - next.createdAt,
              error: message,
            },
            "error",
          );
        } else {
          // Retryable → exponential backoff + jitter, back to 'queued'.
          const delay = backoffMs(next.attempts, opts.random);
          store
            .getState()
            .markRetry(next.idempotencyKey, message, now() + delay);
          retriedThisPass.add(next.idempotencyKey);
          result.retried += 1;
        }
      }
    }

    // Report when the earliest backed-off entry becomes due so the caller
    // (index.ts) can schedule a follow-up pass.
    const t = now();
    let earliest: number | null = null;
    for (const e of store.getState().entries) {
      if (e.status !== "queued") continue;
      const due = e.nextAttemptAt ?? 0;
      const inMs = Math.max(0, due - t);
      if (earliest === null || inMs < earliest) earliest = inMs;
    }
    result.nextDueInMs = earliest;
    return result;
  } finally {
    _draining = false;
  }
}

// __DEV__ is provided by React Native / Metro; absent under node tests.
declare const __DEV__: boolean | undefined;
