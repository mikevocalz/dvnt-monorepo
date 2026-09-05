# DVNT Watch v2 — completion ledger

2026-09-05. Local implementation and verification are substantially expanded. **Release acceptance is still open:** full phone builds are running, signing requires Xcode team access, and paired physical acceptance has not run. Production functions/migrations have not been deployed. Existing unrelated native-project changes are preserved.

## Implemented behavior

| Area | Current source behavior |
| --- | --- |
| Navigation | Apple direct Now/Inbox/Events/Tickets roots; compact first-scroll-row Door artwork. Wear native M3 Now, Events, Inbox, Tickets, Broadcasts and authorized Host Door. |
| Messaging | Paginated threads, sender identity, images/viewer, durable account-scoped media caches, drafts/outbox, explicit send, server-ID confirmation, durable desired-state reaction retries and retained-page deletion reconciliation. Account transitions fence late data and clear private state. |
| Events | Independent event relationships, bounded archive paging, exact event pass navigation, real forecast at future doors, Maps, confirmed RSVP/waitlist and explicit owner presence. No public attendee counts. Up to six permitted event photo moments have explicit refresh and a five-minute visibility lease; blocked, flagged, expired and video content is excluded. |
| Tickets | Stable selected-pass identity, native QR quiet zone and membership rings; missing/unknown/cancelled status and malformed QR fail closed. Owner-only membership information and wrist-down privacy. Wallet installation is never inferred from share-sheet success. |
| Host Door | Authorized aggregate source, validated counts, explicit preview/send notices, uncertain-operation retention and account/disable resets on both platforms. Presence shares no coordinates and does not redeem a ticket. |
| Calls | Companion call picker/recents, fresh recipient-bound answer/decline, backend-confirmed decisions, truthful phone audio state, desired-state mute/end and interruption recovery. Transactional backend admission caps calls at four total participants. Native wrist media remains disabled pending compatible transport and physical proof. |
| System surfaces | Apple Show ticket, I’m here and Mute controls; account-scoped intent handoff through the watch app. Complications include event fallback, optional unread state, fresh presence, date relevance and location relevance only with existing location permission. Wear tile/ongoing companion surfaces retain their native integrations. |
| Notifications | Reply/heart/read, event RSVP/view, waitlist phone continuation, host Door, exact ticket and fresh call actions. Recipient/time/account validation, persistent uncertain message/event actions, server-ID reply confirmation and no persistent call replay. Canonical grouping/collapse and bounded trusted image attachments via a generated notification-service extension. Custom cold-start actions bypass generic navigation; authenticated handler readiness preserves the original response, recipient-bound call hydration uses a conditional backend decision, and only consumed responses are cleared. Handler unmounts/account changes cannot invoke stale callbacks. |

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
| J — native duplex impossible | False platform claim removed. SDK CallKit/PushKit/voice-chat APIs compile; installed Fishjam binary has no watchOS slice. A matching-architecture link probe confirms the installed binary is built for iOS Simulator, not watchOS Simulator. Compatible native audio transport remains a dependency. See call evidence. |
| K — stale queued calls | Confirmed. `watch-bridge.ts`, native call stores: expected state, account generation, expiry and ended tombstones. Notification routing now revalidates a current recipient-bound ringing row instead of joining on tap. |
| L — Wear parity | Confirmed missing baseline coverage. Native additions improve parity; the capability table above explicitly separates missing/untested surfaces. |
| M — absent four-person limit | Confirmed. `call_create`, `video_join_room`, `call_join` and `20260905121000_call_admission.sql`: four total, room-row transaction lock, reconnect membership reuse. Group chats remain larger than four. |
| N — Lynk coupling | Partially confirmed. Creation applied Lynk rules; fixed initial call domain and separate admission. `video_list_rooms` already filtered all three discovery paths to Lynk and was preserved. |
| O — missing notification metadata/actions | Confirmed. `_shared/watch-notification.ts`, `send-message`, `send_notification`, `watch-notification-actions.ts` add categories/thread identity and supported interruption levels. Message/event/waitlist/host/ticket/call actions, canonical collapse/grouping and trusted image attachments are implemented; paired delivery remains unverified. |
| P — INSERT-only realtime | Confirmed in actual subscriber callers, not the channel factory alone. `message-realtime.ts`, `use-watch-dm-sync.ts`: message changes and read cursors refresh recently opened threads; Wear event transport now carries threadPage. Retained page IDs are now reconciled through bounded authorized reads, including deletions; unloaded history remains paginated. |
| Q — iOS-only DMs | Confirmed. `watch-bridge.ts`, phone Wear plugin and `WearDataLayerService.kt`: versioned DataClient snapshots, MessageClient commands/results/live events. Media uses bounded authorized HTTPS URLs; no credentials in snapshots. |

## Verification

- `node scripts/verify-watch.mjs` passes ten checks. It previously compiled only
  the RingPhase sources; the five suites in `apps/mobile/targets/watch-tests/`
  existed but no runner executed them, and two of the five were untracked.
  `DMStoreTests`, `DoorStoreTests`, `TicketSafetyTests`, `VenueActionStoreTests`
  and `WatchMediaCacheTests` now build and run there.
- Combined watch contracts, bridge, event/weather, notification, identity and incoming-call decisions: **77 tests passed**, including final notification and event moment regressions. Log `/tmp/dvnt-watch-v2-final-combined-tests.log`; invariant log `/tmp/dvnt-watch-v2-final-invariants.log`.
- Full application TypeScript check passed after final cold-start/moments integration: `/tmp/dvnt-watch-v2-final-combined-tsc.log`.
- Wear: **30 Kotlin tests**, Debug APK and unsigned Release APK passed after ticket safety and event moments changes; `/tmp/watch-v2-moments-final-wear.log`.
- Swift messaging/media/ticket safety, complication-cache and notification-image-source standalone tests passed. Framework, QR wire, feature-gate, DM wire and ring invariant checks passed.
- Isolated Deno check passed for send-message, send_notification, notify-event-change and event-broadcast-message. Shared notification metadata/image tests passed (4).
- Real clean Expo prebuild passed twice in an isolated tree. Apple Watch/complication simulator, unsigned Watch device Release and notification-service extension builds passed. Full phone builds resumed after authorized cache cleanup. See the native ledger for final results and reproducible commands.
- Native simulator captures exist at 40/41/45/49 mm for unpaired/largest-type and two header treatments. Additional actual-screen fixtures are explicitly synthetic and have no command relay or production account data. Corrected 40/41/45/49 mm ticket screenshots decode via Apple Vision to the explicit synthetic payload; the latest conversation capture confirms the initial latest-message position. Captures do not constitute paired-device acceptance.


## Full phone build

2026-09-05. The full phone build now completes. `** BUILD SUCCEEDED **` for
`-workspace ios/DVNT.xcworkspace -scheme DVNT -configuration Debug -destination
'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`. Log
`/tmp/dvnt-v2-device-build.log`; product preserved at
`/tmp/dvnt-v2-device-products/DVNT.app`. The product embeds
`Watch/DVNTWatch.app`, which embeds `PlugIns/DVNTWatchComplication.appex`, plus
`PlugIns/ShareExtension.appex`. App binary is arm64 platform 2 minos 17.0; the
watch binary is arm64_32 + arm64. This is an unsigned compile-and-link result,
not an install or a signed archive.

Two findings changed how this is built.

**The earlier failure was a real link error, not the disk exhaustion recorded
against it.** `Ld RNAudioAPI.framework` failed on roughly ninety undefined
ffmpeg symbols. `react-native-audio-api` declares the four ffmpeg xcframeworks
as `vendored_frameworks`, and CocoaPods writes `-framework "libavcodec"` and its
three siblings into the app target's `OTHER_LDFLAGS` but not into the pod's own,
so the pod could never resolve them while it linked as its own dynamic
framework. `RNAudioAPI` is now in `STATIC_FRAMEWORK_PODS`
(`apps/mobile/plugins/with-static-pods.js`, mirrored into
`apps/mobile/ios/Podfile`), alongside the two pods already there for the same
reason. `pod install` reports `[with-static-pods] Building RNAudioAPI as a
static framework` and the generated project carries `MACH_O_TYPE = staticlib` in
both Debug and Release. The pod's own six `-force_load` flags become inert,
because Xcode's Libtool task reads `OTHER_LIBTOOLFLAGS` rather than
`OTHER_LDFLAGS`; the ogg/opus/vorbis archives are now force-loaded once at the
app link instead of into both binaries. `-ObjC` is present in both
configurations and on the app target, so `RCT_EXPORT_MODULE(AudioAPIModule)`
survives archive linkage. `apps/mobile/plugins/with-static-pods.test.cjs` covers
the list and the plugin's idempotent re-injection.

**A full iOS Simulator build of this app cannot succeed.** `MoqFFI.xcframework`
ships `ios-arm64-simulator` and no x86_64 simulator slice; MLKit's
`MLImage.framework` ships simulator support for x86_64 only, its arm64 slice
being `platform 2` (device). An arm64 simulator build fails with `building for
'iOS-simulator', but linking in object file (…MLImage[arm64][2](GMLImage.o))
built for 'iOS'`, and excluding arm64 strands MoQ. Both dependencies do ship
device arm64, which is why the device destination above is the one that
completes. Recorded so the simulator path is not attempted again.

Not yet in any build: `apps/mobile/targets/notification-service/` is a valid
`@bacons/apple-targets` target producing `com.dvnt.app.notifications`, but
`DVNTNotificationService` appears zero times in the committed
`ios/DVNT.xcodeproj/project.pbxproj`, and the built product's `PlugIns/` holds
only `ShareExtension.appex`. A prebuild is required before that extension exists
anywhere. No hardware or signing account is involved.

## Ticket envelope session scope

`WatchTicketEnvelope` on the phone (`packages/app/features/watch/watch-payload.ts`)
and on Wear (`wear/…/Models.kt`, enforced in `TicketRepository.ingest`) both
carry optional `protocol` and `accountGen`. The Swift envelope declared neither,
so tickets and broadcasts were the only domains applied without the generation
comparison that `events`, `threadPage`, `callDirectory`, `activeCall` and `call`
each perform, and a protocol-2 snapshot built for a previous account could
repopulate the wrist. `apps/mobile/targets/watch/Models.swift` now declares both
fields and a `belongs(toGeneration:)` rule mirroring Wear's: a protocol-2
envelope must name the session's generation, and an envelope from a released
pre-protocol-2 phone carries no generation to check and is still accepted.
`TicketStore.ingest(json:generation:)` applies it at the call site in
`WatchConnectivityManager`. Covered by `TicketSafetyTests`, including the legacy
path.

Broadcasts had the same drift and are fixed the same way. The phone stamps
`protocol`/`accountGen` in `use-watch-broadcast-sync.ts:50-51` and Wear enforces
them in `BroadcastRepository.ingest`; the Swift envelope declared neither.
`WatchBroadcastEnvelope` now carries both and
`BroadcastStore.ingest(json:generation:)` gates on them. The rule itself lives
once, in `WatchSessionScope.accepts` in `Models.swift`, which both envelopes
call — `BroadcastModels.swift` imports WatchKit and cannot build on the host, so
the host suite covers the shared rule rather than a second copy of it.

## Contract drift closed without protocol changes

Three fields lived on the wire with no entry in
`packages/app/features/watch/contracts/v2.ts`, which claims to be the mirrored
contract. `WatchThreadPageRequest` (carrying `retainedMessageIds`, which both
watches send and `watch-bridge` bounds to 250 numeric IDs) and
`WatchThreadAction` are now declared there.

`operationId` is deliberately absent from `WatchThreadAction` and stays absent.
Wear puts one on its thread actions and watchOS does not, which reads as drift
but is not a correctness gap: the action is desired-state (`read` sets a cursor,
`reaction` states whether the emoji should be present), so replaying it changes
nothing, and the phone validator requires no operation identity for it. Each
client guards duplicate local dispatch its own way — `DMStore.performThreadAction`
keys pending actions by conversation and refuses a conflicting one, Wear keys its
persisted queue by its own id. Adding the field to Swift would be churn on the
messaging path with no behaviour change.

Wear's ticket `imageURL` doc comment justified not rendering flyer art by saying
the module ships no image loader. That stopped being true when
`ui/MessageImage.kt` and `ui/MessageDiskCache.kt` landed for broadcasts and
events. The behaviour is unchanged and now matches Apple, whose capture review
took the flyer off the ticket entry so the QR and ring own the scan surface; only
the stale reason was corrected.

## Evidence

- [Final native builds, prebuild, cache cleanup and captures](final-native-verification.md)
- [Messaging, ticket and Wear evidence](../watch-v2-message-wear-evidence.md)
- [Events, forecasts and action evidence](../watch-v2-events-evidence.md)
- [Calls, capacity and native transport evidence](../watch-v2-call-evidence.md)
- [Authorized Door backend evidence](../watch-v2-door-evidence.md)
- [Design and research](design-and-research.md)

## Remaining acceptance and dependencies

1. ~~Finish the in-progress full phone builds~~ — **done**, see "Full phone build" below. Physical install still needs item 2.
2. Xcode reports **No Account for Team 436WA3W63V** and missing Watch provisioning profiles. The discovered iPhone resets its connection; Watch requests Mac pairing. User confirmed iPhone/Apple Watch availability, but signed install and physical actions have not succeeded.
3. Physical notifications, account switching, process death/retry, wrist privacy, QR scanning, audio routing, background/reconnect, accessibility and measured performance/battery acceptance remain unverified. Wear physical acceptance also needs eligible hardware.
4. A compatible native watchOS media transport and secure device authentication are required before native wrist audio can be enabled. A matching-architecture probe confirms installed WebRTC links for iOS Simulator, not watchOS Simulator; Apple system call APIs separately typecheck. See the reproducible native-audio probe in the call evidence.
5. Private Crew visibility, event-specific chat and Crew calling need explicit consent/event-membership contracts. Existing public avatars, one-way follows, host presence and generic conversation creation do not establish those permissions. Published event moments are implemented separately.
6. Authorized production rollout is separate from local source completion. Existing QA restrictions remain in effect; no real message/call/ticket mutation is claimed by fixture tests.

This ledger supersedes earlier partial follow-up matrices. Passing source checks is not a claim that every physical or release gate has passed.
