# DVNT weekly fixes: source and release checklist

## Agreed behavior

- Every Spicy post requires following its author, including on Public pages.
  Private pages require owner approval, retained legacy access, or acceptance
  while Public for that exact live follow. Existing age/admission and
  bilateral-block restrictions still apply. Nonfollowers see a follow placeholder,
  not hidden originals embedded beneath a blur. Private safe posts are protected
  too. The author retains access to their own posts.
- Public/Private settings preserve sibling settings and concurrent updates.
  Private follow requests can be requested, cancelled, approved, or declined.
  All existing follows are preserved separately from approval. Public followers
  also retain access when an owner later switches Private; new Private follows
  remain pending. Unfollow/removal permanently retires that relationship access.
  Older clients may omit a follow action; the server resolves that toggle inside
  the locked relationship transaction. Settings and follow operations stay bound
  to the account that initiated them, including rapid sign-out/sign-in changes.
  Requests have a Settings entry/count, profile links and visible action feedback.
- Feed and profile use matching two-decimal distance labels for mutually opted-in
  precise sharing. Exact sharing has a separate disclosure and withdrawal control.
  New map consent lasts for the verified sign-in instead of four hours. Neither
  saved coordinates nor prior OS permission grants new sharing consent. Direct
  web/native Settings visits synchronize sharing, show failure/retry states, and
  serialize Stop with in-flight publication; saved positive coordinate grants
  cannot resurrect sharing after restart.
- The map shows nearby public events and eligible consenting members. Text posts
  fit their available space and align left. Home double-tap scrolls to the top;
  the logo selects Sweet/Home and scrolls to the top. Activity content opens its
  target; the actor's avatar/name opens their profile.
- The six requested adult event categories are Spicy-only. Deleted/inactive ticket
  tiers disappear from buyer selectors; purchased tickets and organizer records
  remain intact.

## Release ordering and explicit hold points

This branch contains source and local fixture validation. It does not apply a live
migration, backfill live data, deploy functions/clients, merge, change credentials,
or certify production behavior. Those actions need separate release authorization.

1. Rehearse the pinned source, migrations and supported client versions on an
   approved nonproduction project. Establish installed-native compatibility for
   service-only profile writes, follow requests and the approval UI. Current
   source tests do not prove compatibility of older installed binaries. Existing follows are preserved through separate incarnation-bound legacy grants,
   including Public accounts later made Private; none are labeled owner-approved.
2. Prepare the trusted-users prerequisite tracked in PR #210. The weekly gate
   refuses ANY effective client users INSERT/UPDATE column grant, including
   nonidentity profile columns. Preserve SELECT and verified service writes.
   The users SQL alone does not stop privileged auth-sync from rebinding an
   established identity: the reviewed null-only auth-sync safeguard must also be
   deployed and verified, with old invocations drained before step 3. Pin a release
   artifact containing that guard; a later bulk deploy of weekly-only source must
   not restore old auth-sync. For unlinked profiles, also verify the deployed
   Better Auth email-ownership path used by the strict verified-email guard.
   Existing linked logins do not enter that path. The notification-table lockdown and
   notification-client rollout in #210 are not dependencies of these weekly
   migrations; do not expand the release to them implicitly.
3. With separate approval for the named project's permission changes, apply the
   reviewed users prerequisite. Deploy the new `user-settings` handler, including
   CAS writes and canonical privacy normalization, and drain all older invocations
   BEFORE the privacy sync trigger. An older handler could otherwise carry a
   stale Public flag during an unrelated edit and make a legacy Private account
   public. Do not bypass either prerequisite or mix these handler versions.
4. Apply `20261109050000_member_map_session_consent.sql`, then the additive
   `20261109110000_private_follow_requests.sql` with `ready=false`. This captures
   no relationships and leaves old follow behavior available. Deploy and verify
   compatible service readers: `bootstrap-feed`, `bootstrap-profile`,
   `bootstrap-notifications`, `get-posts`, `get-bookmarks`, `get-liked-activity`,
   `get-post-comments`, `get-text-post-slides`, `live-surface`, and `add-comment`,
   plus matching `toggle-follow`. These readers preserve compatibility before
   activation. Never use the earlier approved-only weekly reader. `get-posts`
   verifies Better Auth itself and uses `verify_jwt=false`. Drain every old Edge
   invocation AND outstanding database request/transaction. If this cannot be
   proved, stop at compatibility mode; do not activate or assume atomic deployment.
5. Apply `20261109114000_post_follow_read_gate.sql` to stage the privacy trigger,
   gate policies and protocol version. New follow restrictions remain inactive
   until cutover. Follow the [staged preservation procedure](../workstreams/15-private-follow-requests.md):
   record reviewed commit/source hashes, project/operator approval and drain
   evidence; verify all new reader/writer versions; then obtain separate approval
   for `docs/security/private-follow-preservation-cutover.sql`. That bounded
   transaction captures ALL current follow incarnations, closes direct client
   follow writes and flips readiness atomically without rewriting follows/counts
   or inventing owner approval. Every subsequent Public follow also retains
   acceptance across a later Private choice; new Private follows are pending.
   Check batch/count, protocol, permissions, preservation, revocation and parity
   after commit. A timeout rolls back to compatibility; a committed batch must
   never be deleted or recaptured. Check the migration ledger/batch after any
   uncertain result; post-COMMIT schema notification failure is not rollback.
   Only then apply `20261109120000_weekly_event_visibility.sql` and
   `20261109143000_member_exact_distance_consent.sql` through the separately
   reviewed release process. Event classification includes a live-data backfill.
   Location migrations do not upgrade existing duration or precision grants.
6. Deploy matching `create-event`, `member-map`, and `member-proximity` before
   clients. Missing approval/location RPCs fail closed; do not add legacy read
   fallbacks. Ship matching web/native clients only after staging/device approval,
   then perform the production device/browser smoke tests below.
   Confirm logout, account switch, unfollow, denied requests, revocation, and expiry
   erase displayed media/location immediately and reject late responses.

Do not run an unreviewed bulk database push: the compatibility deploy/drain and separate activation boundary
are intentional. A rollback must not restore broad client
identity writes, old service readers or permissive post reads. Keep protection
in place and repair forward, or use an explicitly approved traffic hold. Public
URL/media revocation is outside these database rollback guarantees.

The API/RLS protections do not retract media already delivered to authorized
viewers or invalidate already-known public CDN URLs. Private signed asset delivery
and rotation require their own storage/CDN release; this work does not claim that.

## Validation and remaining release checks

The `weekly experience regressions` workflow installs isolated fixtures and runs
the settings handlers, follow services and UI, actual SQL migrations in disposable
PGlite databases, exact/session location handlers and hooks, navigation, activity,
text layout, event classification, and active ticket selectors.

The combined validation also runs the full Node suite, community tests, monorepo
typecheck, route/parity audits, shipped-edge audit, and release-critical checks.
Final results are recorded in the pull request. Full repository lint has existing
unrelated failures; do not present it as green. Local DOM/component fixtures are
not physical-device or visual-browser QA.

Run these checks in staging before release on web, iOS, and Android. After
deployment, repeat only the separately approved synthetic-account smoke checks:

- Public nonfollower, accepted Public follower later made Private, preserved
  historical follower, private pending/approved/rejected follower,
  minor/ineligible viewer, blocked pair, and author across feed, profile, grids,
  search, direct links, notifications, bookmarks, comments, and text slides.
- Unfollow/account switch while a lightbox or share overlay is open and while a
  protected fetch is in flight; old persisted post data must not reappear.
- Hold a settings save or follow approval during account changes, including an
  immediate return to the original account. No old operation, success/error
  message or optimistic Public setting may appear in the new sign-in.
- Approve/decline/cancel requests, refresh status and verify content is fetched
  again from the protected server before becoming visible. Test old callers that
  omit a follow action without turning historical follows into approval.
- A legacy Private account with a stale Public settings flag stays private after
  notification/read-receipt edits. Only an explicit Public choice makes it public.
- Fresh precise opt-in, stale/missing device observation, denied OS permission,
  failed revoke/retry, logout, session deletion/expiry, and subsequent sign-in.
  No precise or approximate fallback may survive invalidated v2 consent.
- Open Privacy Settings directly without visiting Feed. Test grant/publication,
  failed exact Stop followed by ordinary Stop, unmount during a queued withdrawal,
  and repeat controls across account/session changes. Errors must describe the
  current unresolved operation and offer an available retry.
- Feed/profile distance parity and Near You public event pins, every specified
  adult event category, Sweet/Spicy and Past filters, and removed tiers with
  purchased tickets still visible to their holders.

Focused implementation notes: [Spicy access](2026-11-09-spicy-post-access.md),
[events and tiers](2026-11-09-event-ticket-visibility.md), and
[location](../location/weekly-location-2026-11-09.md).
