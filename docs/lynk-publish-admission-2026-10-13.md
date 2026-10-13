# Publish admission and alternate Lynk clients

This follow-up is based on the room reliability repair in PR #83. It changes the
alternate `lynk/[roomId]` web/native screens and the two media-token endpoints.
It does not introduce a database migration or a new admission RPC.

## Changes

- Both alternate clients call the existing `video_join_room` before mounting
  viewer or broadcaster transport. Query-string host hints only choose a screen;
  the returned server role decides whether the Go Live control is available.
- Existing verification, private/event-ticket admission, host standing, waiting
  room, room capacity responses, heartbeat, room-end observation and roster role
  changes are shared with the ordinary room surface.
- Media is scoped to the current room/account. Backgrounding stops transport;
  foreground rechecks admission and requires a fresh capture opt-in. Explicit
  host End and participant Leave retain their distinct server operations.
- `lynk-moq-token` and retained `lynk-livestream-token` require an active,
  correctly scoped membership before granting publish access, including hosts.
  Both repeat current authorization after provider minting. Legacy provisioning
  can update an active member's stream metadata but cannot create/reactivate a
  membership.
- Honest clients send their runtime platform. App-only and host-standing checks
  also apply to direct token requests and refreshes. This platform declaration
  is compatibility metadata, not device attestation.

## Compatibility and rollout boundary

Old direct-publish clients must join first or upgrade. Deploy coordinated client
and token-handler changes only after normal review and release approval. The
existing join handler provisions a legacy Fishjam peer even for MoQ clients;
this patch intentionally reuses that admission path rather than introducing a
second one. Viewer-only tokens retain existing eligible public/invited access.
MoQ permits active participant publishing; legacy WHIP/WHEP preserves its
host/co-host/speaker role list.

This is not complete atomic capacity enforcement. The existing join handler
counts and writes separately, can reject an already-active rejoin at capacity,
and has count-derived anonymous label collisions and anonymous refresh response
inconsistency. The separate co-host invitation path remains another admission
writer. The proposed atomic admission correction is incomplete and is NOT part
of this source set. Do not claim these defects are resolved by requiring an
active membership at token mint time.

Navigation/unmount stops transport but does not send an asynchronous server
Leave: the existing endpoint has no session generation, so a delayed request
could revoke a newly re-admitted same-account session or auto-end its room.
Explicit Leave/End still calls the server. Abrupt navigation/account switches
can therefore leave an existing membership row until existing room lifecycle
cleanup; no new lease or abandoned-seat cleanup protocol is added here.

Existing credential lifetimes and already-open relay sessions are unchanged.
Post-mint revalidation withholds stale credentials, but it is not relay-side
revocation. A legacy provisioning request revoked mid-flight may leave an unused
provider room without releasing a token. Monthly hosting-session quota accounting
and old-client host-end enforcement remain outside this follow-up.

## Validation

Fixtures execute actual handlers with synthetic database/provider adapters and
actual React web/native screen and transport hooks with in-memory media devices.
They cover concurrent clients, existing publishers, join failure, waiting,
account/room changes, late replies, background/resume, role changes, host end,
strict-effect replay, explicit capture opt-in and denied-token capture shutdown.
No live room, token, camera, microphone, or payment is used. Physical mixed
web/native media acceptance and actual provider integration still require a
separate approved staging exercise.

Local verification on 2026-10-13: 351 scoped tests passed, including 15 Genesis
React screen scenarios; the separate two-client React DOM room fixture passed.
Architecture checks (8 sections), edge-import checks (178 functions), hooks lint,
and whitespace checks passed. Independent token review also ran 73 extra
in-memory compatibility cases. Local full-web typecheck is not a clean pass:
its 7 diagnostics are existing dependency/type issues outside this changed file
set. These results do not replace exact-head CI or physical-device acceptance.
