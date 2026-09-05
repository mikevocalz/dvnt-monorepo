# Watch v2 message and Wear implementation evidence

Date: 2026-09-05. This slice is source implementation and local verification, not a release or paired-device sign-off.

## Reproduced findings

- **D:** `send-message/index.ts` previously inserted every delivery. `messages.operation_id` now has a sender-scoped unique index. The winning insert alone reaches read effects and push; conflict recovery returns the existing row, rejects a changed body/metadata/conversation, and never repeats notifications. The UUID remains nullable for existing phone clients. Watch transport acknowledgment is not send confirmation.
- **E:** `messagesApi.getConversations` discarded `_rawTs` after formatting. The existing display `timestamp` remains; `createdAt`, `lastMessageId`, `lastSenderId`, and actual `lastMessageMetadata` are additive. Strict watch reads propagate auth/query/category/block failures instead of manufacturing an empty inbox.
- **G:** Existing `getMessages` queries ascending plus limit. Its callers remain intact; `getThreadPage` uses descending `created_at,id`, a bounded 25-message page (maximum 30), one-row lookahead, and a stable older cursor before reversing for display. Microsecond timestamp strings are preserved.
- **P:** `realtime.ts` originally only provided safe channel creation. The actual INSERT-only subscribers were in message screens. `bindMessageChanges` adds message `*` and viewer `conversation_reads` subscriptions before subscribing; the new migration publishes read cursors. The watch sync integration owns calling the helper.

Further confirmed: `react-message` previously checked neither conversation membership nor blocks and used a read/modify/write metadata race. The service-only `set_message_reaction` RPC now locks the message row, validates authenticated membership and bilateral block rules, preserves unrelated metadata, and supports idempotent desired-present updates. Omitted desired state keeps legacy toggle semantics. The allowed set is 😂 😢 😊 😈 🥵 💝 ❤️.

The four-person call cap had leaked into group-chat creation and native/web selection. Those guards and misleading copy were removed. Minimum two selected people and group-name validation remain. The native group screen now uses the existing Zustand store.

## Wear source implementation

- Phone config plugin installs the previously missing `PhoneWearListenerService` manifest entry and keeps source copying/registration idempotent.
- `DVNTWearBridge.syncContext`, `sendResponse`, and `DVNTWearMessage` carry credential-free snapshots/commands. Existing `syncTickets` now resolves on DataClient success instead of before its asynchronous result.
- `broadcastEvent(payloadJson)` sends live MessageClient events only to reachable nodes advertising the DVNT Wear capability, with no replicated fallback for ringing.
- Watch uses replicated `/dvnt/context` plus `/dvnt/command/<requestUUID>` and `/dvnt/response/<requestUUID>`. Requests time out honestly if phone JS is unavailable.
- Native Material 3 Inbox, filters, message pages, bounded image decoding/viewer, RemoteInput, explicit draft/send, durable operation UUID outbox, safe retries, reaction counts/mine and desired-state reaction actions.
- Thread/Inbox list state survives viewer/navigation transitions. New snapshots refresh an open thread; foreground older pages retain their anchor keys and a bounded 250-message window.
- `WearAccountSession` serializes account-scoped ingress across tickets/messages/events, rejects retired generations, and clears tickets, drafts, outbox, thread and image state on account change. Outer context session is accepted before nested domains; versioned legacy `/tickets` delivery uses the same gate.
- AmbientLifecycleObserver removes message/ticket content while wrist-down, showing only a small shifting DVNT mark. Multiple tickets can be selected without changing QR generation.
- Native Calls provide Recents, search, a picker limited to three other people, phone audio/video start, incoming actions, and actual active-call phase/mute/end controls. Expired ringing and missing heartbeats disable controls; this is a phone call companion and carries no native watch audio. Incoming events are not persisted.
- Native Events use real phone snapshots for sections, flyers, event/local time, RSVP and waitlist actions. Ticket purchase, pending invitation acceptance and offer claims continue on phone. Optional venue weather shows the phone snapshot timestamp and uses no watch location. Pending mutations persist as uncertain after restart and are never automatically replayed.
- Native incoming notifications use a permission-gated high-importance channel, generic private text, immutable account/call/expiry-bound actions and system timeout. After process death an unexpired action can reconstruct only its original command from the PendingIntent; phone confirmation is still required, and it is never queued/replayed automatically. Active phone calls use Wear OngoingActivity with timeout tied to the last heartbeat. Full-screen intents are not used.
- Material 3 ProtoLayout tile has title/main/bottom slots, real cached unread-chat count/event countdown and an exact pass/event navigation target. SHORT_TEXT/LONG_TEXT complication data sources expose counts/countdowns only, with bounded validity. Ingress and account resets request system-managed tile/complication updates.
- Unknown/missing/cancelled Wear ticket statuses now fail closed, so they cannot expose a scannable QR or become the tile's Show pass target.
- Release builds no longer inherit the debug signing configuration; the local release APK is explicitly unsigned.

## Verification

- Identity regression: 3 passing actual-source tests prove logout/cache ownership, late prior-account query rejection without disturbing the new cache, A→B→A transitions, explicit invalidation and protected identity fields.
- Node: 7 passing tests across thread pagination, realtime binding, JSONB idempotency comparison, real Zustand group selection beyond four, and running the actual config-plugin callbacks twice against an isolated prebuild fixture.
- Kotlin/JUnit: 15 tests for bounded older/newest windows, edited-row replacement, durable operation serialization, legacy summary defaults, authoritative reaction decoding, overnight DST/event-timezone sections, conservative missing-field handling, weather snapshot validation, incoming expiration active-call heartbeat expiration, process-death notification action fencing, private cached surface selection, account separation, and unknown ticket fail-closed behavior.
- Disposable PostgreSQL 14, socket only, no application environment or production database: actual delivery migration applied twice; eight concurrent same-operation inserts yield one row; separate senders and legacy null operations work; publication and equal-microsecond pagination checked.
- Disposable PostgreSQL 14 reaction tests: membership, unknown actor, missing message, both block directions, own message in blocked DM, eight replayed desired-state calls, independent concurrent reactions and metadata preservation, legacy toggle, nine-member group, service-only grants. Passed.
- `deno check --no-lock` passed for send-message and react-message. Full package TypeScript verification is coordinated by the main implementation agent after all agents' edits.
- Isolated Wear Gradle source build: AGP 8.12.0, Kotlin/Compose compiler 2.2.21, Gradle 9.3.1, JDK Zulu 17, compile/target SDK 36, Wear Compose Material 3/Foundation 1.6.2. `:wear:testDebugUnitTest :wear:assembleDebug :wear:assembleRelease` pass. The isolated root avoids configuring unrelated phone/MoQ plugins; it does not verify the entire phone app.

Local build root: `/tmp/dvnt-wear-build`. Source remains `apps/mobile/wear`; outputs redirect to `/tmp/dvnt-wear-build/output/wear`. Debug APK: `outputs/apk/debug/wear-debug.apk`; release: `outputs/apk/release/wear-release-unsigned.apk`. Build log: `/tmp/dvnt-wear-surfaces-verified.log`.

## Sources and limits

- [Wear notification guidance](https://developer.android.com/training/wearables/notifications): full-screen intent notifications and USE_FULL_SCREEN_INTENT are explicitly unsupported on Wear OS. This implementation does not claim them.
- [Wear data client choices](https://developer.android.com/training/wearables/data/client-types): replicated DataClient vs nonpersistent MessageClient and message-size limit.
- [Wear Material 3 releases](https://developer.android.com/jetpack/androidx/releases/wear-compose-m3): first stable M3 release was 1.5.0 in August 2025, disproving the repository's old “no stable M3” comments.
- [Wear list guidance](https://developer.android.com/training/wearables/compose/lists): TransformingLazyColumn, shared ScreenScaffold state and rotary behavior.
- Published 1.6.2 source jars verified `ColorScheme`, `Typography`, `AppScaffold`, `ScreenScaffold`, `TransformingLazyColumn`, and its state saver. Wear 1.4.0 source verified AmbientLifecycleObserver callbacks and WAKE_LOCK declaration. Installed React Native `ReactContext.java` verifies `hasActiveReactInstance`.
- Phone plugin Kotlin compile passed: `/tmp/dvnt-phonewear-build`, `:bridge:compileDebugKotlin`, JDK17/AGP8.12.0/Kotlin2.2.21/SDK36, actual React Android0.86.0 classes + Wearable20.0.1. Source is the four real templates in `plugins/wear-os-phone`; no mock API classes. Log `/tmp/dvnt-phonewear-compile.log`. The published Maven AAR is278,937,998bytes; only its classes.jar was retrieved through HTTPS ZIP range reads with ZIP CRC verification (3,000,864bytes, SHA256 `2997466719f9d5d409ba9f124e686edf5059132fed6bd8a7dfafbb6298b9475c`). This validates phone native APIs, not full Expo packaging.
- Official published sources checked: ProtoLayout Material3 1.4.2 (`materialScope`, `primaryLayout`, `textEdgeButton`), Tiles1.6.2 (`TileService`, tile/resources callbacks), complication data-source1.2.1 and Wear Ongoing1.1.0 (`OngoingActivity.Builder`, static icon, touch intent, status/apply).
- Argent device inventory on2026-09-05 returned no Android devices and no AVDs. No device was booted or interacted with by this slice.
- The code-review skill and React best-practices skill informed the review. No CodeRabbit result or device run is claimed by this slice.

Still unverified/incomplete: paired Android phone/Wear transport and manual UI behavior, full Expo phone app packaging, screen captures/design alternatives, TalkBack/rotary/physical scan validation, device performance/battery metrics, durable offline media disk cache, reactions queued across relaunch, push delivery under process death, and paired background incoming notification/OngoingActivity delivery and mirrored-phone notification deduplication, native watch call audio, Host Door parity and all Events edge cases. No credentials are stored in snapshots. No migrations, functions, notifications or messages were sent to production by these tests.
