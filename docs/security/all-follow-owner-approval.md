# New follows require owner approval

New follows to public and private profiles stay pending. Only the recipient can
approve through the verified follow endpoint. Approval establishes the follow
and permits Spicy access subject to existing age, block and post-visibility
checks. Public non-Spicy posts remain public. Private-profile posts remain hidden
until approval. Cancellation, decline and unfollow retire access; a later follow
requires new approval.

Existing follows are deliberately preserved, including old public-account
acceptances. This does not revoke access already granted to the reporter's test
account. Test a fresh relationship, or have its owner explicitly unfollow before
requesting again after activation. Do not remove production followers as a test.

## Deployment prerequisite and rollout

This draft does not activate production. Obtain deployment/migration approval.
Require the existing private-follow preservation cutover ready at read gate v1,
follow request notification producer, and approved follow endpoint. Confirm all
existing follows have authorization grants before applying. The atomic migration
20261111201000 replaces only the insertion guard and relationship mutation; it
locks against concurrent writers and changes no existing relationship rows.

Publish the request-panel/privacy-copy update for supported clients. Apply the
approved migration; verify metadata-only pending/approved transitions with
explicitly authorized synthetic accounts. Existing RLS and Edge projectors now
see no follow row while a new public-account request is pending. Service jobs
that insert follows also create pending requests rather than bypass approval;
this includes automatic brand/event follows. No service exception is added.

Existing request activity and best-effort request push remain active and
idempotent. Native compatibility notifications direct older clients to the web
review page. This change does not distribute a new native build or fix an old
client's cached downloaded bytes. Permanent CDN URLs and previously downloaded
media remain outside this rule; do not claim it revokes previously shared URLs.

Rollback must not silently restore automatic access. Prefer roll-forward or
pause follow mutations while preserving the access boundary.

## Evidence

The new isolated PostgreSQL-WASM test applies the real follow, post visibility,
age, preservation, notification and approval SQL. It covers public Spicy denial
while pending and grant after approval; public non-Spicy visibility; preservation
of old follows; raw insertion bypass; legacy toggles; unauthorized approval;
notification deduplication; unfollow/refollow; decline; private profiles; blocking
and minor exclusion. Existing server projector, hook and request UI tests remain
required. Provider enforcement and real browser acceptance remain separate gates.
