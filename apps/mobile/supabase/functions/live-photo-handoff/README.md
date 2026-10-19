# Live Photo draft handoff

Deployment requires the accompanying **draft** migration. Nothing in this change
applies it or deploys the function automatically. Apply the migration before deploying
the changed media-upload function: upload success now requires a protected receipt.
Deploy media-upload before enabling handoff UI; old uploads without receipts are
intentionally ineligible for handoff.

POST with the existing Better Auth session in `x-auth-token` (or the existing
Authorization transport). The Supabase anon key does not authorize a handoff.
Both browser and native app must authenticate as the same Better Auth user.

Request bodies:
- `create`: `{ action, draftId, maxCount }` (UUID draft, 1–10 slots).
- `status`, `cancel`: `{ action, id, draftId }`.
- `complete`: `{ action, id, draftId, pairs: [{ photoId, motionId }] }`.
- `consume`: `{ action, id, draftId, requestId }` (UUID consumption request).

`create` produces the server-generated UUID `id`. The deep link may carry `id`
and `draftId`, neither is a credential. Never put authentication tokens, owner
IDs or return URLs in the link. The function accepts no redirect destination.

Success: `{ ok: true, data: { id, draftId, state, expiresAt, maxCount } }`.
Only `consume` adds `data.assets`, ordered as completed:
`[{ photoId, motionId, url, livePhotoVideoUrl, mimeType, width, height }]`.
Failure: `{ ok: false, error: { code, message } }`.

Every handoff expires 15 minutes after creation, including retries. At most five
unexpired pending/ready handoffs are allowed per owner. Completion validates all
1–maxCount pairs before the atomic pending→ready transition. It reads URLs only
from media records; protected service-written upload receipts establish owner and pin the canonical
object key, URL, type and MIME. Filenames provide an additional kind/owner check,
not provenance on their own, because legacy media policies may allow client inserts.
No claim is made that metadata proves two arbitrary owner-uploaded files are an
Apple pair: the native client supplies the original pair from the iOS picker.

Consume atomically claims the batch. Retry with the **same persisted requestId**
to recover an interrupted response; another requestId is refused. Browser code
must persist its requestId before sending and maintain an applied-handoff ledger
with the draft update to prevent duplicate insertion. Server atomicity cannot
make a browser storage operation atomic with an HTTP response.

Cancellation clears media references and permanently prevents completion or
consumption. A consumed batch cannot be cancelled. Original media files are not
deleted by this protocol. Expiry is enforced by the database clock; expired rows
are inert. Production retention cleanup is separate operational work and not
included as a live scheduled job in this draft.

Tests use `typescript` and `@electric-sql/pglite`. On memory-constrained hosts:
`node --max-old-space-size=256 --wasm-lazy-compilation --liftoff-only --test apps/mobile/supabase/functions/_shared/live-photo-handoff.test.cjs`.
The SQL test executes the actual migration and RPC against a minimal media schema.
