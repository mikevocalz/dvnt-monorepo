/**
 * Outbox types — durable offline mutation queue (WS-12).
 *
 * An OutboxEntry is a *reference* to work, never the work itself:
 * payload carries IDs / refs / small scalars ONLY — never base64,
 * never file bodies, never anything an asset pipeline should own.
 */

export type OutboxStatus = "queued" | "inflight" | "failed_terminal";

/** Payload values are intentionally restricted to simple JSON scalars. */
export type OutboxPayloadValue = string | number | boolean | null;

export interface OutboxEntry {
  /**
   * Client-minted UUID, created once at enqueue time (crypto.randomUUID —
   * same precedent as `lib/stores/cart.ts:52`) and STABLE for the life of
   * the entry, including across app restarts (it's MMKV-persisted with the
   * entry). Executors MUST forward it to the server as the body field
   * `idempotency_key` so the `client_mutations` dedupe table can reject
   * replays. See SERVER CONTRACT in `./index.ts`.
   */
  idempotencyKey: string;
  /** Registry key — which executor runs this entry (e.g. "event.rsvp"). */
  mutationType: string;
  /** Entity kind the mutation targets (e.g. "event", "post"). */
  entityType: string;
  /**
   * Stable ref for the target entity (e.g. event id). Entries sharing an
   * entityRef must apply in FIFO order relative to each other.
   */
  entityRef: string;
  /** IDs/refs and small scalars only — NEVER base64 or blobs. */
  payload: Record<string, OutboxPayloadValue>;
  /** ms-epoch when the entry was enqueued. */
  createdAt: number;
  /** Completed executor attempts so far. */
  attempts: number;
  /** Message from the most recent failure, if any. */
  lastError: string | null;
  status: OutboxStatus;
  /**
   * ms-epoch before which the drain loop must not retry this entry
   * (exponential backoff + jitter). Absent/0 = due immediately.
   */
  nextAttemptAt?: number;
}

export interface EnqueueInput {
  mutationType: string;
  entityType: string;
  entityRef: string;
  payload: Record<string, OutboxPayloadValue>;
}

/**
 * Feature-registered executor for one mutationType. Receives the full
 * entry (including idempotencyKey — forward it as `idempotency_key` in
 * the request body). Resolve = success (entry removed). Throw = failure:
 *   - throw OutboxTerminalError (or any error with a 4xx `status`) for
 *     validation/permanent failures → entry parked as 'failed_terminal'
 *   - throw anything else for retryable failures → backoff + retry
 */
export type OutboxExecutor = (entry: OutboxEntry) => Promise<void>;

/**
 * Thrown by executors to mark an entry permanently failed (bad request,
 * validation, gone entity). The entry is retained as 'failed_terminal' —
 * never silently dropped, never retried.
 */
export class OutboxTerminalError extends Error {
  readonly terminal = true as const;
  constructor(message: string) {
    super(message);
    this.name = "OutboxTerminalError";
  }
}

/**
 * Classifies an executor throw. Terminal = OutboxTerminalError, anything
 * flagged `terminal: true`, or an error carrying a numeric 4xx `status`
 * (except 408 request-timeout and 429 rate-limit, which are retryable).
 */
export function isTerminalOutboxError(err: unknown): boolean {
  if (err instanceof OutboxTerminalError) return true;
  if (typeof err === "object" && err !== null) {
    const e = err as { terminal?: unknown; status?: unknown };
    if (e.terminal === true) return true;
    if (
      typeof e.status === "number" &&
      e.status >= 400 &&
      e.status < 500 &&
      e.status !== 408 &&
      e.status !== 429
    ) {
      return true;
    }
  }
  return false;
}
