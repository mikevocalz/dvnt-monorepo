/**
 * Shared source of truth for personal-call capacity.
 *
 * SQL admission is the human authority: it never admits more than
 * CALL_HUMAN_CAPACITY participants. The media provider gets a small
 * headroom so stale or transient peers (e.g., a reconnecting device that
 * has not been cleaned up yet) do not artificially cap the call.
 */
export const CALL_HUMAN_CAPACITY = 12;
export const CALL_MAX_INVITEES = CALL_HUMAN_CAPACITY - 1; // caller + invitees
export const CALL_PROVIDER_HEADROOM = 2;
export const CALL_PROVIDER_MAX_PEERS = CALL_HUMAN_CAPACITY +
  CALL_PROVIDER_HEADROOM; // 14

/** Seconds the media-provisioning lease stays locked around external work. */
export const CALL_MEDIA_LEASE_SECONDS = 55;

/**
 * Bounded exponential backoff with jitter for the pending-lease poll loop.
 * Exported so unit tests can assert the timing curve without sleeping.
 */
export function pendingWaitMs(attempt: number, maxDelayMs = 8_000): number {
  const jitter = Math.floor(Math.random() * 200);
  const base = Math.min(maxDelayMs, 250 * 2 ** attempt);
  return base + jitter;
}
