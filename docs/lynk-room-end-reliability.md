# Sneaky Lynk room-end reliability

## Failure and client fix

Previously, `video_end_room` waited for legacy Fishjam room deletion before
persisting `video_rooms.status = 'ended'`, changing active memberships to
`left`, revoking legacy `video_room_tokens`, and inserting `room_ended`. The current live media
uses MoQ. Removing the legacy Fishjam room is not a verified MoQ disconnect,
and a membership-filtered event can become unreadable after memberships leave.

`useRoomLifecycle` observes the persisted `video_rooms` row after server
admission. It checks on initial admission, realtime `SUBSCRIBED`/reconnect,
foreground/visibility/focus, browser network recovery, media reconnect, and a
5-second fallback interval. Reads time out after 8 seconds so a hung request
cannot block all later checks. A confirmed `ended` or `closed` result is terminal;
late `open` snapshots cannot reverse it. The callback and observer cleanup run
once per admitted room/user lifetime. An error or missing row is inconclusive,
not a fabricated room end.

The caller must stop both MoQ publishing and subscribing, release camera/mic,
cancel token refreshes by disabling the admitted transport lifetime, and show
or navigate to the terminal room state. Existing `room_ended` handlers should
call the returned `notifyEnded` so both paths share the same terminal latch.

## Server end ordering and truthful retries

`video_end_room` now authorizes the host, then conditionally changes an open
or historical closed room to ended before any ancillary cleanup. Read-only live
metadata verification on 2026-10-13 found the current `video_rooms_status_check`
allows only `open` and `ended`, confirming that `open` is the sole active state.
The historical schema in `20260213100001_video_rooms_schema.sql` also allowed
`closed`; the handler retains compatibility with that known legacy value. Only
`open` passes join/refresh gates. Unknown states fail closed without writes.
The update compares the observed state, and a zero-row result must be confirmed
as already ended before reporting success. Every member/token/event write
checks returned errors. Only the terminal-transition winner inserts the end
event, preventing duplicate notifications from repeated requests. The original
host can retry an already-ended room even after active membership is removed;
other users cannot perform that cleanup. A losing concurrent request confirms
the persisted end instead of assuming a zero-row update succeeded.

Legacy Fishjam deletion happens last with a 2-second abort and a timeout race.
A legacy outage cannot prevent the terminal row update or indefinitely delay
the response. Already-deleted legacy rooms (HTTP 404) are harmless.

Once the terminal row commits, the response remains `ended: true`. Ancillary
failures are reported separately through `cleanupComplete: false` and warning
codes. A retry repairs active memberships and unrevoked legacy tokens. If the
supplementary end-event write failed, retries report the missing event without
risking duplicate inserts; updated clients still observe the terminal room row.
No partial failure reopens a room. A failed terminal write returns failure and
performs no downstream cleanup.

## Relay authority and existing clients

The room-status check is authoritative for clients that include this fix. It is
not a server-side revocation of already-issued relay credentials.

The inspected Fishjam server SDK has these relevant properties:

- The pinned v0.30.0 did not expose configurable MoQ token TTL.
- v0.30.1 adds `ttl` in seconds to `createMoqAccess`. The default is 3600 seconds,
  and the documented maximum is 604800 seconds. Upstream tests verify that
  `ttl: 120` produces JWT claims with `exp - iat = 120`.
- The inspected generated MoQ management API exposes `POST /moq/access` only.
  No per-room MoQ close or revoke operation was found in that API.
- No inspected source establishes that JWT expiry forcibly closes an already
  established MoQ connection. A short TTL must not be represented as proof of
  mid-session termination.

Sources:

- [v0.30.1 release](https://github.com/fishjam-cloud/js-server-sdk/releases/tag/v0.30.1)
- [TTL change and upstream tests](https://github.com/fishjam-cloud/js-server-sdk/pull/300/files)
- [MoqAccessConfig at v0.30.1](https://github.com/fishjam-cloud/js-server-sdk/blob/v0.30.1/packages/fishjam-openapi/src/generated/models/MoqAccessConfig.ts)
- [MoQApi at v0.30.1](https://github.com/fishjam-cloud/js-server-sdk/blob/v0.30.1/packages/fishjam-openapi/src/generated/apis/MoQApi.ts)

Existing installed native clients and already-loaded web bundles do not gain
the lifecycle watcher merely because a backend function changes. Already-open
sessions on those clients remain an explicit acceptance gap. They must upgrade
or reload; no old-client forced shutdown is claimed.

## Compatible server hardening included in source

Keep the signed Fishjam token flow and the MoQ transport unchanged:

1. Pin the verified v0.30.1 SDK and request a 120-second publish/subscribe
   TTL, further bounded by the persisted room deadline.
2. Return the actual issued JWT expiration as `expiresAt`; do not fabricate it
   from the completion time of a slow provider request.
3. After asynchronous token minting, re-read the persisted room status/deadline
   before returning access. Reject if host-end won the race.
4. Continue rejecting fresh token requests for ended rooms, and clear client
   token/media state on a terminal refresh refusal. Transient network failures
   may retain only an unexpired token, with a separate expiry deadline that
   cannot be postponed by a hung refresh.
The following remains outside the implemented source fix:

- To guarantee termination of non-upgraded clients, obtain a verified
   provider-side namespace/session revocation operation or verified enforcement
   of expiration on established connections. Do not invent an endpoint, rotate
   shared management credentials, or weaken signing/authentication.

TTL work limits token replay/reconnect and gives upgraded clients a bounded
local lease. It does not, by itself, prove old-client media termination.

## Proposed provider-compatible revocation contract (not implemented)

If the provider adds namespace revocation, preserve the existing MoQ transport
and signed admission flow. The concrete integration should be:

1. Persist the terminal room transition and a durable revocation job in one
   database transaction. Give the job an idempotency key derived from room ID
   and its terminal version. Membership/event cleanup remains retryable.
2. A service-only worker invokes the provider's documented namespace-close
   capability. No endpoint or credential is assumed by this proposal. The relay
   records a terminal namespace tombstone before closing every publisher and
   subscriber connection belonging to that namespace.
3. The relay rejects both existing credentials and new connection attempts for
   tombstoned namespaces, regardless of token expiry. Room IDs/namespaces must
   not be reused; no client acknowledgement is needed for revocation.
4. Keep a pending revocation observable until the provider acknowledges closure.
   Retry bounded transient failures with the same idempotency key. Never report
   relay-wide termination merely because the database row is ended.

Acceptance tests for that provider capability must establish that an old client
which ignores application room-end events still loses media; both publication
and subscription stop; a cached unexpired token cannot reconnect; a concurrent
late issuer result cannot reopen the namespace; duplicate/out-of-order jobs are
safe; and provider outage recovery eventually closes all sessions. Test rooms
must be synthetic staging fixtures. Until this contract is available and tested,
old-client forced relay shutdown remains unresolved.

## Verification and deployment boundaries

`node --test packages/app/features/video/room-lifecycle.test.ts` uses synthetic
backend snapshots, fake realtime callbacks, and fake timers only. It covers
multiple clients, missing membership events, offline/foreground recovery,
reconnect during an old read, periodic recovery, stale `open` results,
pre-admission gating, timeouts, cancellation, and exactly-once cleanup.

`node --test apps/mobile/supabase/functions/_shared/lynk-moq-access.test.cjs`
adds synthetic TTL/deadline/expiry tests and executes the actual Edge Function
against in-memory DB and issuer substitutes. It covers host-end and revoked
verification, ticket, private invite, ban, kick, leave, role, and anonymity changes
during issuance. Test credential strings have deliberately invalid signatures.

`node --test apps/mobile/supabase/functions/video_end_room/index.test.cjs`
executes the actual end handler against synthetic DB/HTTP/timer fixtures. It
checks hung legacy deletion, host-only authorization, idempotent repeats,
concurrent ends, terminal-write failure, and truthful partial-cleanup warnings.

The tests do not open rooms, issue real tokens, post messages, activate camera or
microphone, or contact a live relay. Synthetic tests establish client lifecycle
logic; they are not a two-device media teardown measurement.

The lifecycle change requires a new web bundle and native client/compatible OTA
release. It does not require a new database policy or migration. The server TTL and
post-mint checks require a separate `lynk-moq-token` deployment. The end-ordering
fix requires deploying `video_end_room`.
No deployment or live configuration change is part of these tests.

Before release acceptance, use isolated staging fixtures and test host web +
native guest and native host + web guest; verify publishing, remote playback,
capture indicators and reconnect all stop after host-end. Include dropped
realtime and phone background/resume cases. Separately test whether a relay
connection survives signed-token expiry before promising provider enforcement.
