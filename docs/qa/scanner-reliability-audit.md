# Event scanner reliability audit

Draft follows released attendee-search #224. No live check-ins, QR credentials,
refunds or ticket records were used by the tests. No deployment or migration is
performed by this PR.

## Verified defects addressed

- A display lookup throwing after atomic admission returned HTTP 500. Preserve
  the committed RPC verdict and fall back to its ticket identity; display-only
  reads cannot reverse admission.
- Token/role lookup database errors looked like invalid credentials. Return a
  retryable scan failure without exposing database details instead.
- Malformed explicit event IDs silently fell back to the QR's event. Reject
  malformed supplied context while preserving legacy event-less calls.
- A canceled event could accept an active ticket during asynchronous refunds.
  Both redemption RPCs now gate lifecycle under a row lock. See the separate
  locking note and actual PostgreSQL contention tests.
- Offline downloads stopped at the PostgREST cap and swallowed add-on errors.
  Read both rails completely with bounded keyset pagination; fail partial reads.
- Failed downloads could erase/renew a good cache. Keep transient failures distinct
  from authoritative empty or revoked allowlists.
- Offline caches never expired; each rail now has its own 24-hour maximum age.
- Offline replay erased rejected HTTP-200 results. Only valid:true is confirmed;
  conflicts remain visible for staff review instead of silently disappearing.
- Network errors claimed the ticket had not been checked despite possible lost
  responses after commit. UI now states that confirmation is unknown.

## Verification and limits

Actual edge-handler fixtures cover all accepted staff roles, unauthorized and
wrong-event cases, signed credentials, post-commit enrichment failures, lifecycle
results, retryable lock contention and legacy calls. PostgreSQL suites exercise
one-winner concurrency, credential rotation, void/refund races, independent comp
credentials, audit rollback, cancellation before/after scans and bounded retries.
The PostgreSQL suites require a disposable server and explicitly fail if missing;
local server binaries were unavailable, so CI must pass before release readiness.
Actual API, persisted Zustand store and mounted React fixtures cover offline
refresh, expiry, replay verdicts and visible pending conflicts. Physical iOS/
Android camera permissions, venue connectivity and real attendee check-in were
not exercised.

Offline admission is provisional: no isolated device can know about a later
refund, transfer or another device's admission. A fresh local allowlist is not a
global exactly-once guarantee. An already-scanned replay may be another staff
member's admission or a lost-response retry; it stays unresolved, not auto-cleared.
No new re-entry/multi-pass product semantics are introduced: distinct issued
credentials admit independently, each only once.

## Approval boundary / release components

Requires a separately approved release: reviewed lifecycle migration, ticket-scan
entrypoint, get-event-tickets entrypoint plus existing read-all-rows helper, web
client; native client delivery remains separate. Preserve verify_jwt=false and
all existing shared auth/HMAC/rate-limit/Sentry helpers byte-for-byte. Live
metadata at audit: ticket-scan v56; all five shared helper files exactly equal
repository source. No PR210, RLS/publication, credential, legacy-auth, historical
scan edits or accounting schema changes are included.
