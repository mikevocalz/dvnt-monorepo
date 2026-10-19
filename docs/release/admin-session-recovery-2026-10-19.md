# Admin session recovery after PR #125

Scope: the console and Payload sidebar logout, plus stale-cookie recovery at
the server admin page. No migration, credentials, auth configuration or live
session manipulation is included. Editorial schema/editor repair is separate.

## Behavior

- Logout removes private app/console client state, removes Better Auth first
  so its custom strategy cannot mask a legacy Payload session id, then attempts
  Payload logout even if Better Auth failed, and
  verifies `/payload-api/admin-users/me` returns exactly `user: null` before a
  full navigation to shared sign-in. Partial failures retain a warning and
  retry action, not a successful sign-out message. Repeated clicks/StrictMode
  share one in-flight operation, with stale effect callbacks cancelled before
  navigation. `/admin/logout` requires an explicit confirmation click before
  using the same flow; a direct/cross-site GET cannot end shared sessions.
- Middleware cookie checks are only a routing optimization. The server admin
  page authenticates with Payload, preserving valid legacy sessions. When no
  CMS user exists, read-only Better Auth session validation distinguishes
  expiry/revocation from an active nonstaff identity. Only genuinely signed-out
  requests redirect to the shared login, preserving safe admin destinations.
- Explicit `/admin/login?local=1` remains available. Active app users without
  CMS authorization remain subject to Payload's existing denial/fallback;
  they are not automatically bounced between two login systems. Roles and
  collection permissions are unchanged. Backend validation failure is an
  error, not evidence that a session expired. Missing app database configuration
  is also treated as unavailable validation when a shared-session cookie exists.

## Verification

- Focused Node tests cover coordinated logout, failures, retries, stale and
  malformed cookies, expiry boundaries, local recovery, nonstaff loop
  prevention and safe deep links. They run in `admin-session-regressions.yml`.
- `test-admin-session-browser.cjs` mounts the real console Gate, logout view,
  coordinator and Payload HTTP client against localhost fixtures. It covers
  refresh/remount after sign-out, both partial failure directions, retry and
  Payload's logout route for SSO-only, local-only and expired sessions. External
  requests are rejected. The release regression gate runs it in Chromium.
- Local web TypeScript check, broad app/UI Node suite and release-contract
  verifier passed. Chromium could not launch in the local executor because its
  socket sandbox/runtime setup failed; CI browser results remain required.

## Before release

Require green checks for the exact PR head and review the post-merge #125
findings. Verify a production-equivalent disposable staff session can sign in,
enter Posts, sign out, and remain signed out after refresh/back. Check an
expired/revoked session, a nonstaff identity and explicit local recovery.
Do not use an owner's live session or change staff permissions for these tests.
This separate auth PR is not authorized for merge or deployment by itself.
