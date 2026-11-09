# DVNT weekly fixes: source and release checklist

## Agreed behavior

- Every Spicy post requires following its author, including on Public pages.
  Private pages require an approved follow request. Existing age/admission and
  bilateral-block restrictions still apply. Nonfollowers see a follow placeholder,
  not hidden originals embedded beneath a blur. Private safe posts are protected
  too. The author retains access to their own posts.
- Public/Private settings preserve sibling settings and concurrent updates.
  Private follow requests can be requested, cancelled, approved, or declined.
  Historic raw follow rows are not silently treated as private approvals.
- Feed and profile use matching two-decimal distance labels for mutually opted-in
  precise sharing. Exact sharing has a separate disclosure and withdrawal control.
  New map consent lasts for the verified sign-in instead of four hours. Neither
  saved coordinates nor prior OS permission grants new sharing consent.
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

1. Rehearse the migrations and edge/client versions on a nonproduction project.
   Review the existing identity-write lockdown prerequisite. The post-read
   migration deliberately refuses to install while clients can mutate the users
   identity table or its columns. Do not bypass that preflight.
2. Deploy the new `user-settings` handler, including CAS writes and canonical
   privacy normalization, and drain all older in-flight handler invocations BEFORE
   installing the account-privacy sync trigger. An older handler could otherwise
   carry a stale Public flag during an unrelated settings edit and make a legacy
   Private account public. Do not reverse this order or mix handler versions.
3. Install the private follow-request schema before the restrictive post-read
   gate. No historic private follows are auto-approved. Review this conservative
   transition with the product owner before release.
4. Apply the five new migrations through the reviewed database release process:
   `20261109050000_member_map_session_consent.sql`,
   `20261109110000_private_follow_requests.sql`,
   `20261109114000_post_follow_read_gate.sql`,
   `20261109120000_weekly_event_visibility.sql`, and
   `20261109143000_member_exact_distance_consent.sql`.
   The event migration includes a live-data classification backfill. The location
   migrations do not upgrade old grants to longer duration or precise sharing.
5. Release the matching edge handlers before clients. Include the new `get-posts`
   endpoint, all changed service-role post readers, follow mutations,
   `user-settings`, `create-event`, `member-map`, and `member-proximity`.
   `get-posts` verifies Better Auth itself and is configured with `verify_jwt=false`.
   Missing approval/location RPCs fail closed; do not add legacy read fallbacks.
6. Ship matching web/native clients, then perform device/browser smoke tests below.
   Confirm logout, account switch, unfollow, denied requests, revocation, and expiry
   erase displayed media/location immediately and reject late responses.

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

Before a separately approved release, manually verify on web, iOS, and Android:

- Public nonfollower, public follower, private pending/approved/rejected follower,
  minor/ineligible viewer, blocked pair, and author across feed, profile, grids,
  search, direct links, notifications, bookmarks, comments, and text slides.
- Unfollow/account switch while a lightbox or share overlay is open and while a
  protected fetch is in flight; old persisted post data must not reappear.
- A legacy Private account with a stale Public settings flag stays private after
  notification/read-receipt edits. Only an explicit Public choice makes it public.
- Fresh precise opt-in, stale/missing device observation, denied OS permission,
  failed revoke/retry, logout, session deletion/expiry, and subsequent sign-in.
  No precise or approximate fallback may survive invalidated v2 consent.
- Feed/profile distance parity and Near You public event pins, every specified
  adult event category, Sweet/Spicy and Past filters, and removed tiers with
  purchased tickets still visible to their holders.

Focused implementation notes: [Spicy access](2026-11-09-spicy-post-access.md),
[events and tiers](2026-11-09-event-ticket-visibility.md), and
[location](../location/weekly-location-2026-11-09.md).
