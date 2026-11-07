# Host, co-host and guest quality pass

## Scope

- Web and native moderation use current roster authority, reject stale actions after account/room/lifetime changes, and serialize conflicting target and bulk actions.
- Hosts can find co-host controls from the native participant roster. Remove confirmations expire when the sheet, actor or guest changes and dispatch once.
- Failed promotions remain actionable in the raised-hand queue. Switching web panels does not bypass shared pending state. Queue dismissal describes local behavior rather than implying a server-side notification.
- Participant search and role-scoped controls remain usable with a synthetic 30-person roster. Anonymous labels and avatars preserve the room's privacy policy.
- Web departure follows the current authoritative host role. Ending a room explains that co-hosts do not keep it open; automatic host transfer is not implemented.
- No backend capacity, subscription, moderation authority or host-transfer policy changed.

## Verification

The focused fixtures cover 30-person moderation, shared locks, delayed authorization, interrupted confirmations, failed requests, account changes and React StrictMode. Rendered stage fixtures cover 30 publishers on small phone, landscape and desktop, including paging/pinning without replacing media players. Native stage geometry covers 1, 2, 10, 20 and 30 participants.

Three prior CI fixture incompatibilities are repaired: the native expiry fixture supplies the current queued-departure dependencies; the SDK fixture checks the released read-only volume signal contract; the admission source fixture explicitly imports Node's URL type.

Final aggregate checks and exact-commit CI are recorded in the pull request. Synthetic fixtures do not establish simultaneous 30-person call performance. Physical iOS/Android, Safari, Bluetooth, real audibility and authenticated multi-device reconnect acceptance remain deferred. No merge or production deployment is included.
