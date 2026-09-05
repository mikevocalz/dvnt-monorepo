# DVNT watch v2 — implementation and release status

2026-09-05. **Not release ready.** This is the reviewable local implementation and its evidence ledger. No production migrations/functions were deployed, no store release was submitted, and no real messages, calls, invitations or ticket mutations were executed. Existing unrelated native-project changes were preserved. Environment and baseline: [environment record](../watch-v2-environment.json).

## User-visible changes

Apple Watch opens directly into Now, Inbox, Events and Tickets, with the Door artwork as the first scroll item. Conversations have real paginated history, inline images, a bounded viewer, drafts, explicit send, durable outbox, backend-confirmed replies and reactions. Events no longer require a ticket. Tickets retain the existing QR/ring and selected pass. Companion calls identify where audio occurs and show confirmed phone call state. Host Door now has an authorized aggregate sync source and confirmed notice/presence actions. Wear has native conversation, Events and companion-call implementations using the same account-scoped contracts.

The changes retain DVNT fonts, artwork, black canvas and brand colors. Design rationale, journey map, copy and accessibility work are in [design and research](design-and-research.md). These are source-level decisions; missing native captures are not replaced with conceptual mockups.

## Findings A–Q

Paths below are relative to the repository root. “Confirmed” describes the initial finding, not release acceptance.

| Finding | Verdict and final source evidence |
| --- | --- |
| A — gateway/navigation | Confirmed. `apps/mobile/targets/watch/RootTabs.swift`, `Marquee.swift`: one stack per tab, first-scroll-item DoorHeader; no whole-page gateway link. |
| B — preview-only thread | Confirmed. `DMListView.swift`, `DMStore.swift`, `WatchProtocol.swift`, `features/watch/contracts/v2.ts`: observable ID-driven paginated thread and attachments. |
| C — premature send success | Confirmed. `DMStore.swift` and Wear `MessageRepository.kt`: sent requires matching server message ID; transport delivery is insufficient. |
| D — process-only dedupe | Confirmed. `watch-bridge.ts:registerWatchDMReplyHandler`, `send-message/index.ts`, migration `20260905120000_watch_message_delivery.sql`: persistent sender/operation uniqueness; concurrent duplicate callers await the same result. |
| E — display timestamp | Confirmed. `packages/app/lib/api/messages-impl.ts:getConversations`, `watch-dm-payload.ts`: canonical ISO `createdAt` alongside phone display text. |
| F — incomplete signature | Confirmed. `watch-dm-payload.ts:dmSignature`: serialized meaningful DTOs, generation, status and quick replies; snapshot time excluded. |
| G — oldest-page limit | Confirmed. Existing `getMessages` callers preserved; `messages-impl.ts:getThreadPage` and `thread-pagination.ts` add descending timestamp/ID cursor queries and reverse for display. |
| H — ticket-derived Events | Confirmed. `use-watch-event-sync.ts`, `EventStore.swift`, Wear `EventRepository.kt`: authorized RSVP/invitation/saved/waitlist/host relationships independent of tickets. |
| I — freshness/link conflation | Confirmed. `EventListView.swift:StalenessFooter` separates cached snapshot age from phone link; active calls require fresh heartbeats. |
| J — native duplex impossible | False platform claim removed. SDK CallKit/PushKit/voice-chat APIs compile; installed Fishjam binary has no watchOS slice. Native audio is an unresolved dependency, not proven impossible. See call evidence. |
| K — stale queued calls | Confirmed. `watch-bridge.ts`, native call stores: expected state, account generation, expiry and ended tombstones. Notification routing now revalidates a current recipient-bound ringing row instead of joining on tap. |
| L — Wear parity | Confirmed missing baseline coverage. Native additions improve parity; the capability table below explicitly separates missing/untested surfaces. |
| M — absent four-person limit | Confirmed. `call_create`, `video_join_room`, `call_join` and `20260905121000_call_admission.sql`: four total, room-row transaction lock, reconnect membership reuse. Group chats remain larger than four. |
| N — Lynk coupling | Partially confirmed. Creation applied Lynk rules; fixed initial call domain and separate admission. `video_list_rooms` already filtered all three discovery paths to Lynk and was preserved. |
| O — missing notification metadata/actions | Confirmed. `_shared/watch-notification.ts`, `send-message`, `send_notification`, `watch-notification-actions.ts` add categories/thread identity and supported interruption levels. Full requested action/image/collapse coverage remains partial. |
| P — INSERT-only realtime | Confirmed in actual subscriber callers, not the channel factory alone. `message-realtime.ts`, `use-watch-dm-sync.ts`: message changes and read cursors refresh recently opened threads; Wear event transport now carries threadPage. Older-page reconciliation outside refreshed windows remains limited. |
| Q — iOS-only DMs | Confirmed. `watch-bridge.ts`, phone Wear plugin and `WearDataLayerService.kt`: versioned DataClient snapshots, MessageClient commands/results/live events. Media uses bounded authorized HTTPS URLs; no credentials in snapshots. |

## Capability and acceptance matrix

“Local” means compiler/unit/integration-fixture evidence only. Device validation remains separate.

| Feature | Apple Watch implementation | Wear implementation | Verification and remaining dependency |
| --- | --- | --- | --- |
| Navigation / brand | Direct roots, Door headers, retained pass/context | Native M3 navigation | Native builds; no four-case-size captures, two rendered treatments, largest-type or rotary/VoiceOver/TalkBack acceptance. |
| Inbox / thread | Summaries, categories, history, group sender, images/viewer, read/reactions | Native equivalents | Contracts/stores/query tests; paired delivery and long-thread interaction unverified. Older unloaded/retained page deletion reconciliation requires refetch. |
| Sending | Persistent drafts/outbox, same-operation retry, confirmed ID | Persistent native outbox | Concurrency/idempotency PostgreSQL and state tests; process-kill paired behavior unverified. Reactions do not have a durable offline outbox. |
| Privacy | Account-generation gate, retired generations, cache/outbox clear, ambient pass hiding | Account gate, ambient hiding, bounded media | Replay/reset tests pass; hardware preview/privacy behavior unverified. Media is memory cached, not a durable offline image library. |
| Events / Now | Independent sections, no-ticket fallback, confirmed free RSVP/waitlist, phone continuation, Maps, venue weather | Independent native Events and snapshot weather | Model/action tests; real endpoint/device actions unverified. Full archive pagination, permitted Crew/social proof, album preview, event chat and event-specific crew call are not complete. Weather is a current venue snapshot, not a forecast at future doors. |
| Tickets | Existing qrToken QR/ECL H/quiet zone/ring, stable pass identity, wrist-down placeholder | Existing native QR, invalid statuses fail closed | QR checks/builds; no physical venue scans. Wallet-installed fact is not available from current share-sheet success, so “Also in Apple Wallet” is not asserted. |
| Host / presence | Authorized aggregate Door, tier/perk/presence counts, confirmed notice and presence actions | Phone carries Door snapshot; full native host UI parity incomplete | Real isolated aggregate SQL tests; paired host flow unverified. No unsupported “running late” state or location inference. |
| Calls / capacity | Recents/picker, audio answer/decline, truthful active phone status/mute/end | Native companion flow | Transactional admission/provider fixture tests; physical audio, handoff, interruption, headset and lifecycle acceptance missing. Native watch media transport is not implemented. |
| Widgets / system surfaces | Existing complications extended; scoped deep links; date relevance and privacy control | M3 three-slot tile, private count/countdown complication, incoming notifications and Ongoing Activity | Compiler evidence only. Requested Show ticket / I'm here / Mute control set and location-based relevance are incomplete. No RelevanceKit hardware proof. |
| Notifications | Reply/Mark read with persistent retry recovery; category Open actions and stale-call validation | Permission-gated native incoming actions and Ongoing Activity, expiring process-death command recovery | Payload and actual-source retry tests. Full requested heart/event/waitlist/host actions, authorized image thumbnails and collapse behavior remain incomplete. Paired notification delivery and cross-device deduplication unverified. |
| Accessibility / performance | Semantic font scaling, labels, contrast and motion/privacy provisions | Native M3/ambient provisions | Source checks only. No measured cold/warm launch, scroll, transfer/day, memory plateau or battery data; no invented budgets or performance claims. |
| Release integration | Unsigned watch/complication simulator product | Debug and unsigned release artifacts | Full phone app integration build, signing/archives, clean real prebuild, installation and paired acceptance remain open. Plugin isolated compile and twice-run prebuild fixture are narrower checks. |

## Verification evidence

- [Apple navigation, stores, media, widgets, build and research evidence](../watch-v2-navigation-evidence.md)
- [Messaging, backend reactions, Wear, Kotlin and plugin evidence](../watch-v2-message-wear-evidence.md)
- [Call admission, native audio feasibility, companion controls and Host Door evidence](../watch-v2-call-evidence.md)
- [Events, actions and weather evidence](../watch-v2-events-evidence.md)
- [Authorized Host Door aggregate and PostgreSQL evidence](../watch-v2-door-evidence.md)

Integration regressions added after independent review: Android reset still publishes the composite clear if the legacy ticket transport rejects; old-generation ticket/DM/broadcast/Door publishers cannot restamp data into the current account; Wear receives live thread pages; failed notification replies persist and retry with the same operation ID; account changes erase pending notification text and fence stale retry closures. No notification tap directly enters a call route. CallKit and watch answers/declines now require recipient-bound conditional backend decisions, with account/expiry checks around awaits. Native phone presentation no longer suppresses the corresponding watch ring. Re-enabling ticket/broadcast sync republishes unchanged cached data.

Latest combined deterministic run:

```sh
node --import tsx --test packages/app/features/watch/contracts/v2.test.ts packages/app/features/watch/watch-rendition.test.ts packages/app/features/watch/watch-event-payload.test.ts packages/app/features/watch/watch-event-weather.test.ts packages/app/features/watch/watch-active-call.test.ts packages/app/features/watch/watch-call-directory.test.ts packages/app/features/watch/watch-venue-actions.test.ts packages/app/features/watch/watch-door-payload.test.ts packages/app/features/watch/watch-bridge.test.cjs packages/app/features/watch/watch-notification-actions.test.cjs packages/app/lib/auth/identity.test.cjs packages/app/features/services/callkeep/answer-call.test.ts
```

Exit 0, 50 tests. Log `/tmp/dvnt-watch-final-contract-tests.log`. These are actual-source Node/TypeScript tests; they do not substitute for the brief's requested RNTL hook and device tests.

Final native artifacts and checks:

| Command / artifact | Outcome |
| --- | --- |
| `xcodebuild -project apps/mobile/ios/DVNT.xcodeproj -target DVNTWatch -configuration Debug -sdk watchsimulator -arch arm64 -jobs 2 SYMROOT=/tmp/dvnt-watch-v2-native-products OBJROOT=/tmp/dvnt-watch-v2-native-intermediates CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO build` | Exit 0, latest Now/weather/ActiveCall/Venue/Door and complication sources. Product `/tmp/dvnt-watch-v2-native-products/Debug-watchsimulator/DVNTWatch.app`. |
| `JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ANDROID_HOME=/Users/mikevocalz/Library/Android/sdk /Users/mikevocalz/dvnt-monorepo/apps/mobile/android/gradlew -p /tmp/dvnt-wear-build :wear:testDebugUnitTest :wear:assembleDebug :wear:assembleRelease --console plain` | Exit 0; 15 Kotlin tests. Log `/tmp/dvnt-wear-surfaces-verified.log`. |
| `/tmp/dvnt-wear-build/output/wear/outputs/apk/debug/wear-debug.apk` | Debug artifact retained. |
| `/tmp/dvnt-wear-build/output/wear/outputs/apk/release/wear-release-unsigned.apk` | Unsigned release artifact retained; not a signed release. |
| `JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home ANDROID_HOME=/Users/mikevocalz/Library/Android/sdk /Users/mikevocalz/dvnt-monorepo/apps/mobile/android/gradlew -p /tmp/dvnt-phonewear-build :bridge:compileDebugKotlin --console plain` | Exit 0 against actual React Android 0.86.0 classes and Wearable 20.0.1; `/tmp/dvnt-phonewear-compile.log`. |
| `node scripts/verify-watch.mjs` | Exit 0; framework availability, 45×45 QR wire, feature gates, DM wire and ring boundaries. |
| `pnpm --dir packages/app exec tsc --noEmit` | Exit 0 after final call overlay/bridge integration; `/tmp/dvnt-watch-final-tsc.log`. |
| `git diff --check` | Exit 0. |

The build roots are session-local verification scaffolding. Source files, regression tests and evidence are in the repository. Temporary compiler intermediates were removed after completion to recover disk space; APK/app products, test results and logs were retained.

## Release dependencies

1. Complete the source gaps explicitly marked above and final acceptance review; implementation coverage is not synonymous with a ship decision.
2. Full companion phone build/signing/prebuild and approved migration/function rollout. Local machine disk pressure prevented the full Android phone build; isolated plugin compilation does not certify Expo/MoQ integration.
3. Eligible paired Apple Watch/iPhone and Wear/Android hardware for notifications, calls, QR scans, account switching, privacy, accessibility, captures and performance. No eligible watch destination was available in this session.
4. A supported native watch audio transport, backend/device registration and physical audio proof if native wrist audio is a release requirement.
5. Produce two rendered treatments and capture-based critique. Fresh reference lookups cover all twelve screen contexts, with mismatches qualified; phone references do not replace native evidence.
