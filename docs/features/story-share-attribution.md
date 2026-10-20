# Web post/event → story attribution

## API and identity

`create-story` preserves the normal upload/overlay API. A share instead sends:

```json
{
  "sharedSource": { "type": "post", "id": "101" },
  "operationId": "00000000-0000-4000-8000-000000000001",
  "expectedViewerId": "1",
  "visibility": "public"
}
```

`type` is `post` or `event`; IDs are positive decimal strings. A UUID operation
ID is required for shares and must survive transport retries. `expectedViewerId`
is the optional integer profile ID captured by the initiating UI; it does not
select the acting account. The Better Auth session selects the sender, and the
existing verified-admission gate still applies. The server ignores any source
media, source author, title, overlays or message metadata supplied by the client.

Success returns `data.story` in the normal create-story shape, plus:

- `story.sharedSource`: `{ type, id, author: { id, username, name, avatar }, title?, caption? }`.
- `story.thumbnailUrl` when canonical post video media has a poster.
- `data.notification`: `{ status: 'sent', messageId, conversationId }`,
  `{ status: 'skipped_self' }`, or `{ status: 'skipped_privacy' }`.

`sent` means the DM is durably stored, not that a device push was delivered or
that the author read it. This feature does not add a separate push sender.

Attribution lives in `stories.shared_source`; `author.id` is the stable public
profile ID. Resolve current usernames by that ID before profile navigation, not
by trusting a potentially renamed/reassigned snapshot handle. An idempotent
replay refreshes the canonical author's display information.

## Canonical source / privacy boundaries

- A post's author is `posts.author_id`; an event's organizer is the user whose
  `auth_id` equals `events.host_id`. Attendees and client-provided authors never
  receive credit or the automatic DM.
- Only public sources can be reshared, even by their owners. Reject private,
  followers-only and link-only sources; private-account settings in either
  `users.is_private` or `user_settings.settings.privacy.privateAccount`; source
  moderation/deletion/hiding; and blocks in either direction.
- Events must be active/published/postponed, not hidden and already published.
- NSFW posts cannot be reshared because stories do not have an equivalent NSFW
  delivery boundary. Do not flatten their access controls into a public story.
- Text posts use the first canonical text slide (falling back to the caption).
  A source without media has `media_id = NULL` and `mediaUrl = ''`; the client
  renders a source card rather than manufacturing an upload.
- A restrictive story SELECT policy revalidates the source for the JWT viewer.
  A deleted, hidden, newly private or ownership-changed source, or a new block,
  no longer exposes its existing share through client story reads. Ordinary
  stories are unaffected. Any future service-role story reader must explicitly
  apply the resolver because service-role reads bypass RLS.

DM eligibility honors `messages.allowAll` (default false),
`messages.messageRequests` (default true), or the author following the sharer.
The existing inbox partitions non-followed senders into Requests. Both settings
disabled with no recipient-to-sender follow means `skipped_privacy`; no message
or empty conversation is created. Sharing one's own source means `skipped_self`.
Neither exception should show copy claiming that someone was notified.

## Atomicity and spoof resistance

`publish_story_share` is a service-role-only PostgreSQL RPC. One transaction
resolves and locks the source, copies media references, inserts attribution and
the story, finds/creates an exact two-person conversation, inserts the author's
DM, and saves a durable operation receipt. Any media/story/membership/message/
receipt failure rolls everything back. No client or background best-effort
second send is needed. The message metadata is:

```json
{
  "type": "story_share",
  "storyId": "42",
  "sourceType": "post",
  "sourceId": "101"
}
```

Events additionally include `sourceTitle`. Plain content is “Shared your post to
their story.” or “Shared your event to their story.” for older/native renderers.
`send-message` refuses this reserved metadata type. Database triggers also reject
client manufacture/modification of attributed stories and this server-owned
message type even if legacy permissive client grants are present.

A sender-scoped advisory lock serializes operations and the 30-new-shares/minute
limit. An operation reused for a different source/audience, or already used for
an ordinary message, returns `idempotency_conflict`. A lost acknowledgement
returns the same story/message IDs on retry. Deleted/expired shares are never
resurrected; a newly unavailable source is not returned into the client cache.
Concurrent shares to the same author use an exact two-person conversation. A
malformed non-group thread with additional participants is not reused.

Shared stories borrow source CDN URLs, but own only their duplicate `media`
rows. `delete-story` skips CDN deletion for these shares while removing their
story/media rows. Deleting a share must never delete the original source bytes.
The durable receipt's nullable story FK makes subsequent retry refuse removal
rather than reposting; the historical DM can still link to the source.

## Staged rollout and verification

No migration/deployment/live data changes are performed by the tests or this
implementation. Apply `20261020221500_story_share_attribution.sql` through the
normal approved migration process before deploying the updated `create-story`,
`send-message`, and `delete-story` functions and web client. The migration also
requires the existing `messages.operation_id` migration. Do not deploy only
`create-story` without the deletion guard.

Offline tests:

```sh
node --test apps/mobile/supabase/functions/create-story/story-share.test.cjs
NODE_PATH=/tmp/dvnt-story-test/node_modules node --test scripts/test-story-share-sql.mjs
```

The SQL suite executes the real checked-in migration in isolated PGlite
(PostgreSQL/WASM) against synthetic schema/data. It verifies canonical ownership,
post/event/text cards, privacy/blocks/moderation, exact membership, rollback on
injected publication/DM/receipt failures, operation recovery/conflicts, expired/
deleted retry, client role guards and restrictive reads. PGlite queues parallel
calls on its single connection; production multi-connection contention is
protected by explicit transaction locks and uniqueness constraints, not claimed
as a multi-backend load test. The edge suite runs the real handlers with isolated
auth/database adapters, including reserved-type refusal, ordinary uploads and
shared-story deletion without network calls.
