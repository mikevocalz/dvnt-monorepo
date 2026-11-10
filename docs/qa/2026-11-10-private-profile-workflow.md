# Private profile follow workflow correction

This is a source-only follow-up to weekly PR #254. It is not a deployment,
production migration, native release, or signed-in production acceptance report.

## Intended behavior

- Public header, avatar, biography and counts remain visible. An unauthorized
  visitor sees one private-account notice instead of private post tiles. Private
  post projections omit the posts entirely, including decorative IDs/timestamps.
- A new Private follow is a request. The requester can cancel it. Activity has a
  visible Follow requests entry/count, and the owner reviews requests with
  Approve/Decline in Privacy. Approval creates the follow; decline grants none.
- Pending-request Activity is created transactionally and removed on cancellation,
  decline or approval. Approval creates requester Activity. Repeated actions do
  not duplicate transitions. No decline notification is sent.
- Existing followers retain access, including Public followers when an account
  becomes Private. Unfollow/removal retires that grant. No existing follow rows,
  preservation grants, follower counts or ID-verification policy are rewritten.
- Public follows remain immediate; public Spicy posts still require following.
  Age/admission and bilateral-block checks remain independent.
- The owner inbox refreshes on foreground polling every 30 seconds and notification
  refresh; query keys and callbacks remain scoped to the signed-in account.

## Verification and limitations

Focused tests cover actual web/native request panels and Activity rows, account
switches, notification routing, private-profile presentation, private post readers,
social-list handlers, SQL role boundaries, rollback, retained relationships and
real multi-connection PostgreSQL request/cancellation races. These are isolated
fixtures, not real production accounts.

The local Chromium bundle compiled but Chromium could not launch because this
execution environment denied a required socket. Full monorepo typecheck was killed
with exit 137 at the app package, including a serial retry. Changed-file lint has
two existing cross-feature import violations reproduced against the base commit.
Hosted CI must be inspected on the exact published head; these checks are not
reported as locally passing.

## Release boundaries

Deploy only with separate release authorization and compatibility review:

1. Ship clients capable of rendering/routing `follow_request` and
   `follow_request_approved` before enabling producers. Installed-native support
   must be checked separately; a web release does not update native binaries.
2. Commit `20261110010000_follow_request_notification_types.sql` separately before
   `20261110010100_follow_request_notifications.sql` uses its new enum values.
3. Install additive source migration
   `20261110010200_profile_social_graph_rpc.sql` before deploying the new
   `get-followers`/`get-following` handlers. It adds the atomic service-only RPC
   without changing raw read permissions. This intermediate state is NOT full
   social-graph privacy: legacy permissive raw reads still exist.
4. Deploy matching `toggle-follow`, `bootstrap-profile`, guarded social-list
   handlers, and every reader bundling the changed shared post projection.
   Ship compatible clients and drain old handler versions. Only after verifying
   supported installed clients' trusted JWT bridge and obtaining separate release
   approval, apply `20261110010300_private_follow_graph_read_gate.sql`.
   That restrictive raw `follows` SELECT policy leaves verified members' own
   relationships readable, but older anonymous PostgREST clients cannot see
   private edges. Shared and legacy profile clients now use public stored counts.
   Relationship markers, Activity follow markers, and message inbox/spam
   classification still contain direct reads. If their compatibility is unresolved,
   hold gate activation and provide a compatible service path; do not restore
   permissive raw reads as a workaround or claim the privacy gap is closed.
   SQL fixtures exercise additive RPC installation followed by independent gate
   activation and prove predicates/role boundaries, not installed-client
   compatibility or a real concurrent production cutover. Verify retained
   relationships and permissions without exposing individual IDs in reports.
5. Test production request → owner review → approve/decline, cancellation, refresh,
   account switch, Private/Public transitions and retained followers with approved
   synthetic accounts. No real user follow requests or messages were sent here.

In-app request/approval entries commit with the SQL transition. Push delivery is
best effort with a bounded timeout, not a durable retry queue. A push already sent
cannot be retracted if a later cancellation/block occurs. Existing pending
requests remain in the inbox but are not backfilled into historical Activity.
Previously delivered media and known public CDN URLs remain outside this change's
revocation guarantees.

The guarded social-list RPC checks access and projects identities/counts in one
STABLE SQL statement snapshot, avoiding a preflight/read race. Public profile
header/avatar/bio/counts remain visible. Public hosted events retain their own
existing publication rules; changing profile privacy does not reclassify events.
Follow-list caches are erased on follow/privacy resets, and private-locked profile
headers cannot prefetch or navigate to those lists.

## Bounded web-first release

The current client now rejects direct relationship reads when bridge minting is
unavailable instead of interpreting anonymous filtered rows as “not following”.
Profile/Activity errors propagate for retry; unread classification rejects failed
reads instead of silently moving followed members into spam. Public profile
headers do not require a relationship lookup without a signed-in viewer; public
list browsing uses the separately authenticated Edge route.

This does not repair older installed binaries. For a web-first partial release,
ship client presentation/request review and matching private-post readers. The
additive 10200 RPC can precede guarded list endpoints. Hold 10100 entirely: its
triggers immediately produce new notification types even without a new handler.
Old native consumers render those rows with blank action text and incorrect
review routing. Hold 10300 until supported installed-client compatibility is
verified. No new request/approval Activity or push is promised in this partial
release, and the remaining raw social-graph bypass is not closed.

Hosted CI on cd529233 passed the full weekly isolated, PostgreSQL and Chromium
jobs. The subsequent relationship-failure fix adds 26 focused passing tests;
inspect its exact new published head before release.
