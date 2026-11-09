# Private page follow requests

Private access requires both a follow and an explicit `follow_requests.status = 'approved'` record. Historical follows are preserved, never backfilled as approved. An existing follower of a newly private page can request approval using Follow. Public follows remain immediate and idempotent; public follows do not create private approval.

`toggle-follow` now requires an explicit action. `follow` creates a pending request for a private page, `unfollow` cancels pending requests and removes any approved relationship, `status` returns authoritative following/request state, and `requests` lists the caller's oldest 100 pending requests. The list refills after each response. `approve` / `decline` accept the requester's target ID; the owner is always the verified caller. An already-cancelled or declined request cannot be approved. Repeated actions are harmless. Neither approval nor a public/private transition silently removes historical follows.

The service-only `mutate_follow_relationship` RPC serializes writes using ordered user-row locks. The new request table is not exposed to anon/authenticated roles. Settings privacy uses `users.is_private` OR the settings JSON preference; malformed non-false preferences fail closed.

## Rollout boundary

This change is source-only. Apply migration `20261109110000_private_follow_requests.sql` before the dependent post-access gate migration. The privacy gate must require approved proof before clients are enabled, then publish the compatible Edge handler and clients under the release's normal deployment process. Do not deploy the handler without its migration: it intentionally fails closed rather than inserting an unapproved follow. No production migration, deployment, or real notification was run during development.

## Offline checks

- `NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node --test scripts/test-private-follow-requests-sql.cjs apps/mobile/supabase/functions/toggle-follow/index.test.cjs scripts/test-follow-hook.cjs`
- `NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node scripts/test-follow-requests-dom.cjs`
- `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit -p packages/app/tsconfig.json`

Tests execute the migration in disposable PGlite, the Edge handler with mocked service/session dependencies, real QueryClient mutation callbacks, and web/native approval components in a DOM harness. No claim is made of physical-device validation or production database application.
