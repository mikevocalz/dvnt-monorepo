# Sneaky Lynk room reliability repair

## Reported failures

Members in the same room could not see each other's video or use chat; subscription checks were inconsistent; a phone stayed in the room after its host ended it.

## Changes

- Keep pre-join choices and pending leave completions isolated to their originating room/account; stale connected phases cannot silently join a replacement account.
- Start room data/media only after the server admits the current room/account. Preserve anonymous labels in the roster-to-publisher mapping.
- Reconcile authorized roster/chat snapshots after subscription, reconnect, local writes and a 15-second fallback. Discard stale reads, preserve failed-message drafts, deduplicate optimistic echoes, and hide previous-account state immediately.
- Keep native room-join effects stable when the participant count changes. Preserve replacement MoQ broadcast objects in the native participant store so reconnects replace disconnected media. Cancel previous-account joins and refresh callbacks.
- Publish web video as H.264, matching native playback. Restore viewer/publisher resources after lifecycle replay and reconnect, and release every remote subscription on detach.
- Retry transient media-token failures; abort hung requests; hard-expire old tokens. Use short, provider-signed access tokens and repeat admission checks after minting.
- Observe persisted room end on web and native, including reconnect, foreground, online and a five-second fallback. End is terminal and releases media/chat. Host-end failures keep the host on the room screen with a visible error.
- Reconcile legacy Sneaky, Stripe membership and RevenueCat subscriptions through shared rules, including paid-through cancellation, trial/period expiry, grace, identity ownership, read errors and refreshed billing screens.
- Keep anonymous capture/speaking identifiers out of public room broadcasts.

## Verification

Tests use synthetic users, database/provider adapters and deterministic transport boundaries. They include three-viewer chat/roster fixtures, actual React chat/participant controls, initial and existing publishers, reconnect, account switches, stale responses, host end, bounded token expiry and authorization changes during minting. No live accounts, rooms, cameras, tokens, purchases or production writes were used.

Run the scoped regression workflow in `.github/workflows/lynk-room-regressions.yml`. The UI script supports `--dom` for an actual React DOM fixture; omit it for Chromium where that process is supported. Also run `node scripts/verify-lynk.mjs` and `node scripts/verify-edge-functions.mjs`.

Full app type checking was attempted with restored dependencies. Existing unrelated dependency/UI diagnostics remain (webpack/Sentry, game-night Y.Doc, HandQueueSheet and expo-modules-core); no final runtime changes here are claimed to make the entire application typecheck or build clean. Chromium was blocked by the execution environment's process socket restriction, so the React DOM fixture ran instead. Physical-device/mixed-browser camera and codec validation is still required before release.

## Rollout boundaries

Source changes are prepared for a draft pull request. Deployment and database migration are separate approval steps. Updated web and compatible native clients are needed for the client fixes; older installed clients do not acquire these behaviors automatically. Deploy the ownership migration `20261013220600_membership_subscription_owner_reads.sql` before releasing mixed-key subscription readers. It preserves existing numeric-profile and canonical-auth membership rows, with canonical identity taking precedence and ambiguous mappings denied; it does not mutate paid records. Backend targets are `video_create_room`, `lynk-moq-token` and `video_end_room`.

See `lynk-room-end-reliability.md` for provider references and the explicit limitation: no verified provider API currently closes an already-established old-client MoQ session by room. Short tokens bound credential replay; they are not evidence of immediate relay-session revocation.

## Existing subscription accounting gap

Plan metadata describes monthly host-session quotas, but this incident repair does not add server usage accounting or reset semantics. Active entitlement, expiry/grace, room capacity and duration are covered; monthly session-quota enforcement remains an explicit product/backend gap requiring a separately reviewed design.
