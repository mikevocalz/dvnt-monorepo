# Notification privacy: review draft, not a deployed migration

## Evidence (2026-10-30, metadata-only production inspection)

`notifications` has RLS enabled, but its three public policies permit SELECT,
INSERT and UPDATE unconditionally. Both `anon` and `authenticated` have those
table privileges. This is overbroad database access, **not evidence that anyone
accessed another account**. No cross-account probe or live write was performed.
The current notification fix's schema test must not manufacture a stricter RLS
policy and claim that it represents deployed isolation.

History is deliberate compatibility debt: `20260333_fix_anon_role_all_tables.sql`
grants anon SELECT/INSERT/UPDATE and unconditional policies;
`20260519203218_rls_consolidate_permissive_dupes.sql` explicitly retains the three
human-named public/true policies. Existing duplicate cleanup was not hardening.

## Identity and compatibility

- Better Auth is the sign-in authority. `mint-supabase-jwt` verifies its session
  and signs `role=authenticated`, `sub=<Better Auth text ID>`; `users.auth_id`
  links this to integer notification `recipient_id`.
- Shared web/native Supabase clients use the JWT bridge accessToken callback;
  the bridge deliberately returns the anon key if minting/refresh fails.
  Older shipped native clients may have no working bridge. Their installed
  behavior/version distribution is **unverified**.
- `notificationsApi.getNotifications` / `getBadges` query the table directly;
  `markAsRead` / `markAllAsRead` update directly. Realtime INSERT subscriptions
  are filtered by recipient but a client filter is not an authorization rule.
- At the audit baseline, `bootstrap-notifications` verifies a session but selects a nonexistent
  `notifications.content` column, omits `entity_payload`, and ignores the query
  error. It cannot be adopted blindly as a secure fallback. Its route is not a
  substitute for read-state writes or Realtime authorization.

## Proposed least privilege

The adjacent SQL is deliberately **outside migrations** and must not be deployed
by an automatic workflow. It atomically replaces every permissive policy,
revokes anon/public table and explicit column grants, and allows authenticated
SELECT plus UPDATE of `read_at` only, scoped by signed sub → canonical users.id.
No client may INSERT, DELETE, forge an actor/payload, or reassign a recipient.
Existing service-role emitters retain their privileges. No new SECURITY DEFINER
function, secret, user_metadata trust, or credential change is required.
The users lookup is invoker-scoped; existing users RLS/SELECT compatibility must
also be verified on the approved staging configuration. Never weaken users RLS
just to make this policy work.

## Rollout gates (must precede live approval)

1. Publish/test this draft against disposable PostgreSQL: reproduce current
   overbroad policies using synthetic rows, then verify own-only read, forbidden
   cross-account update, denied anon, forbidden content/recipient changes,
   insert/delete denial, nullable actor, legitimate mark-all and service writes.
2. Verify current web and supported native versions actually mint/refresh the
   bridge JWT, including expired session, sign-out/account switch, reconnect,
   and Realtime event visibility. Do not request or log real tokens.
3. Choose compatibility explicitly: release bridge-capable native builds and
   fail visibly/retry on mint failure, or implement session-verified edge list,
   badge and read-state APIs. If using edge APIs, repair bootstrap schema/error
   handling, migrate all callers, and design secure Realtime/polling behavior.
   Anonymous direct readers cannot be securely grandfathered by a client id.
4. Exercise browser/native activity, read-one/read-all, badge counts, payload
   deep links and ticket emitters in staging. Verify only `read_at` updates are
   required by supported clients and no authorized emitter uses client grants.
5. Obtain **specific approval to apply notification table grants/RLS** on the
   named production project, with legacy-client impact and rollout/rollback
   decision stated. General ticket-fix deployment approval is not this approval.
6. Execute only the approved migration; inspect schema/advisors and agreed
   synthetic-account smoke checks. Monitor permission failures and unread/feed
   behavior without reading other accounts or making real ticket changes.

Rollback should prefer fixing identity/edge compatibility forward. Restoring
public/true grants reopens the privacy weakness and requires an explicit risk
acceptance, not an automatic retry or hidden rollback.

## Limitations

No guarantee of delivery is added: current notification emission remains
best-effort after ticket commit, with no durable outbox/backfill. A separate
outbox design would need its own scope and schema approval. Data API route
exposure and installed-client readiness have not been probed in production.

## Reference

Supabase [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
requires both grants and row policies; adding a restrictive policy does not
remove existing permissive grants/policies. The draft also revokes unnecessary
client sequence privileges (observed USAGE/SELECT) while retaining service access.

## Current-client compatibility work in this draft

The draft also hardens the current client without treating that as server
protection: notification reads, badges and read-state calls verify the canonical
account/JWT bridge, attach an account epoch, and fail visibly on verification
failure. The shared transport refuses anon requests specifically to the private
notifications endpoint. Existing bootstrap schema selection/error handling is
repaired and ticket payloads are preserved through hydration. Realtime work
awaits explicit socket authentication and checks lifecycle boundaries.
These fixtures do not prove that an already-installed older binary has the new
code. Deployment of client/edge changes is separate from applying the SQL.
The least-disruptive enforcement decision is to require/update unsupported
native versions before applying RLS; indefinite anonymous compatibility cannot
be retained safely for private notifications.

## Verified evidence and remaining deployment gate

- Exact SQL draft at initial PR210 head passed real disposable PostgreSQL CI:
  7 checks, no failures/skips (run 40998311175). It reproduces only synthetic
  account data and the metadata-observed grants/policies, not a live attack.
- Read-only last-24-hour mint endpoint aggregates on 2026-10-30 showed 598
  POST 200 and 139 OPTIONS 204 responses. This shows observed bridge operation,
  not native-version coverage or token validity on every installed device.
- Current-client API/bridge/bootstrap/Realtime fixture suite: 74 passing checks.
  Realtime explicit auth writes now serialize, preventing a delayed prior-user
  write from overwriting the latest queued account/logout credential.
- Local Chromium launch was blocked by OS socket restrictions; browser DTO and
  bundling preflight passed. CI browser interaction remains the acceptance gate.

Smallest remaining user decision after staged supported-client tests: approve
production notification policy enforcement **with an update/re-auth requirement
for unsupported old native clients**, or defer enforcement while accepting the
known overbroad access. There is no safe exception that lets anonymous clients
choose a recipient. This draft does not make that decision or execute it.

## STOP: identity-table prerequisite discovered during final review

Additional read-only production metadata shows `users` has public/true UPDATE
and anon/authenticated INSERT policies; both clients have UPDATE on `auth_id`,
and there are no non-internal users triggers. Therefore the notification draft's
`users.auth_id` lookup is **not independently trustworthy in the present live
configuration**. No identity mutation or cross-account read was attempted.
The SQL now includes a hard preflight refusal if clients can mutate canonical
identity links/create/delete users. Its isolated tests verify refusal; the
positive policy tests use a protected synthetic users table, not the current
production users write rules. Do not claim notification privacy is solved by
this draft alone.

A separately scoped identity-write lockdown must first be assessed and approved:
prefer verified service-only profile writes if supported clients already use
update-profile; otherwise allow only approved nonidentity columns under genuine
own-profile policies with immutable auth_id. Check signup/auth-sync/native
compatibility and all privileged functions before choosing. Do not silently
expand this notification migration to lock down users. This prerequisite makes
live notification RLS approval premature even if all client CI passes.
