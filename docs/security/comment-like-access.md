# Comment-like authorization

The service-role toggle-comment-like endpoint previously inserted likes and returned
raw comment totals without authorizing the parent post. Its ordinary, idempotent,
and duplicate-insert responses all had that gap. This is a separately confirmed
code defect, not proof of the reported follow-request screenshot's cause.

The endpoint now uses the production post projection before adding a like, and
freshly checks the comment's parent and relationships before returning any total.
Only the caller's existing like can be deleted after access is lost. A hidden
completion returns countHidden with zero redaction sentinels, never observed totals.
Shared and legacy clients preserve that marker, tombstone local comment-like state,
and reset protected caches rather than treating the sentinel as a fresh total.

A read-only information_schema.columns query on 2026-11-11 confirmed comments
has post_id and no event_id; event_comments has its own event_id.
The comments and event_comments tables have independent identifiers. This endpoint
uses comments/comment_likes only; it never guesses an event parent from an ID
collision. Missing or unknown parents fail closed. Event comment APIs are unchanged.

Tests execute the actual handler and post projector with controlled database
responses, including private/unapproved, blocked, nonpublic, orphan, idempotent,
duplicate, revocation after insertion, and own removal cases. Client tests execute
both production hooks with a real QueryClient and mocked hook dispatch, not a
browser or live backend. No private user content was accessed.

This patch is not a transaction-level lock against a relationship changing between
an authorization read and an insert; database restrictive policies are reviewed
separately. No deployment or migration has been applied. Combine with cache epoch
PR #272 to retire already-running unmanaged readers during resets.
