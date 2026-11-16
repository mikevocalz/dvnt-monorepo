# Retired post-cache writes

## Confirmed locally

With fixture-only responses, the production feed bootstrap hook could restore an
unlocked private post after `resetFollowAccessCaches()` had removed it. Bootstrap
promises are not TanStack queries, so `cancelQueries()` did not cancel their
subsequent cache hydration. The original viewer-ID check still passed after a
same-viewer unfollow. The actual spicy-lock predicate treated the restored
server-authorized response as unlocked.

The same boundary was missing from profile bootstrap, its deferred text-detail
hydration, and failed delete/profile-update rollback. The latter restored whole feed/profile
snapshots, potentially including another author's revoked content, and could
restore the previous account's auth-user snapshot after an account switch.
Create/update success callbacks also validate their captured owner before
seeding server responses; stale render-closure users cannot own optimistic
profile/create snapshots.

These are demonstrated local races, not confirmation that they caused the
reported follow-request screenshot. No private live content was fetched for the
reproduction.

## Fix

A per-QueryClient access generation advances synchronously before reset awaits
query cancellation. Unmanaged reads and mutation snapshots capture that generation,
auth-store and content-mode revisions (including transient A-B-A transitions), and the session
lifecycle epoch. They discard writes when any owner changes. Deferred profile
text hydration also checks the captured NSFW mode. A discarded feed accelerator
releases bootstrap gating so ordinary queries can recover. Obsolete feed attempts
cannot change the state of a newer attempt.

The guard does not discover remote revocation by itself: existing follow,
follow-request and privacy mutation reset boundaries retire work when the client
learns of those transitions. Remote changes without refresh/notification and
revocation of already-downloaded media remain outside this fix. No SQL migration,
backend deployment, or stored credential changes are included.

## Regression coverage

`test-post-bootstrap-revocation.cjs` runs transpiled production hooks against
controlled promises and real QueryClient instances. It checks reset boundaries
used for follow requests, unfollow, approval loss and privacy updates; account
switch/roundtrip; session renewal; asynchronous cancellation; delayed profile
text reads; NSFW mode changes; delete/profile-update rollback; allowed unchanged-owner writes;
and isolation between QueryClients. These are reset-boundary tests, not live
end-to-end approval/notification tests.
