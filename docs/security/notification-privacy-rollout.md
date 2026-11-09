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
The user requires no disruption to legacy users. Do not require native updates,
new verification, re-authentication or change their access as a rollout shortcut.
Prove existing-version compatibility first; anonymous private access cannot be
retained as a claimed security fix.

## Historical validation (2026-10-30; not current-head or installed-client proof)

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

The user explicitly requires that legacy users not be bothered. Enforcement
cannot proceed by forcing updates, migrations, email verification or re-auth.
Current-client behavior and existing installed-native compatibility must first
be proven non-disruptive; if that cannot be established, report the remaining
safety/compatibility blocker rather than preserving the vulnerability as a fix.

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

## Identity claims and compatibility (2026-11-09 source revision)

The coordinating read-only production audit on 2026-11-09 found zero profiles
with NULL/blank `users.auth_id`; effective anon/authenticated INSERT/UPDATE on
Better Auth `public."user"`, including email and `emailVerified`, were false.
This is aggregate/privilege evidence, not an installed-client guarantee. Deployed
auth-sync v83 still uses an unconditional email rebind. No live change is included.

The current auth-sync source preserves found-by-auth_id logins and normal new
profile creation. Matching an existing non-NULL different identity is rejected.
Only an unlinked row claim now requires strictly boolean true `emailVerified`
from the server-read Better Auth account for the matched email. Request body,
metadata, strings and other truthy values cannot supply this proof. The update
compares both NULL auth_id and unchanged email; concurrent different claimants
cannot replace the winner. Same-account retries remain idempotent. Failed reads,
writes or ambiguous matches fail closed without provisioning duplicates or
returning the other profile.

This closes the earlier draft's unverified-email-only claim path within the
reviewed source trust boundary. It adds no prompt, reauthentication, verification
campaign, backfill, installed-client requirement or mutation of linked profiles.
A future unlinked collision without existing proof will receive the existing
generic sync failure; that behavior change is intentional and must not be
represented as zero possible user impact.

### Why the server flag is trusted in the reviewed source

- Actual auth configuration pins Better Auth 1.6.26. Signup forces false even if
  the request supplies true; authenticated update-user ignores the verification
  field and rejects direct email replacement. Change-email is not enabled.
- Signed email verification binds its token to the email. The configured
  magic-link plugin consumes a server-issued token before verification.
- Current Google/Apple library paths use provider verification evidence; they
  do not accept request-body `emailVerified`. Provider-token validation is not
  exercised against live providers by these offline fixtures.
- Repository writers outside Better Auth do not set this flag true. The
  update-profile mirror writes username only. Checkout provisioning inserts
  `emailVerified=false`. Read-only metadata reports no client write grants.

The new email-ownership fixture executes the actual edge configuration and the
pinned Better Auth routes against an in-memory adapter, with outbound email
captured rather than sent. It proves forged signup/update values do not elevate,
invalid tokens do not verify, valid signed tokens do, email changes stay disabled,
and magic-link replay fails. Actual auth-sync tests separately prove verified,
unverified/missing/malformed, linked-user, new-profile, and concurrent paths.
No deployed-bundle equivalence or exhaustive future writer guarantee is claimed.

## Integrating current notifications behavior

This revision incorporates master `d1f03d8b95e0f0aa0421b3d08453bbd509d2f73d`
into the PR210 source branch, without merging the GitHub PR or changing master.
It preserves stable keyset pagination, transfer payloads, cohost routing,
read-state rollback, bootstrap cache precedence, visible-query/badge refresh,
and wildcard shared CORS from current master. Private calls keep canonical
identity checks, verified JWT transport, account epochs and explicit socket auth.
A missing bootstrap unread count now fails visibly instead of becoming zero.

The SQL remains outside migrations. `DVNT_SQL_ENGINE=pglite` explicitly runs the
exact same schema/policy statements in local PGlite; its multi-connection test is
visibly skipped. Default execution still requires socket-only PostgreSQL and
fails if the server is absent. CI must exercise the true concurrent CAS test.

## Release sequence and remaining gates

1. Validate this exact source head in CI, including real PostgreSQL concurrency
   and browser interactions. Current-source fixtures are not deployed assurance.
2. Confirm deployed Better Auth configuration/writer behavior matches the trust
   boundary above and supported legacy profiles use service edges for writes.
   Verify installed-client behavior without asking users to reauth or update.
3. Separately obtain approval to deploy the auth-sync ownership safeguard and
   apply the users identity-write prerequisite on the intended project. Protect
   privileged writers as well as direct grants; neither source publication nor
   a passing test authorizes a live security-setting/migration change.
4. Notification ownership SQL has its own compatibility/approval gate. Weekly
   follower-only projections need trusted users identity plus safe auth-sync;
   they do not depend on deploying the notification policy draft.
5. If supported legacy clients depend on direct profile writes or anonymous
   private notification access, enforcement remains blocked pending a compatible
   service route. Do not restore unsafe grants and call that a security fix.

Rollback favors a compatible service path. Restoring client-writable identity
or unconditional privileged email rebinding reopens the vulnerability and must
not be automatic. Preserve all existing users SELECT access and verified service
signup/profile updates. Live deployment, RLS changes and installed-device proof
remain outside this source-only work.
