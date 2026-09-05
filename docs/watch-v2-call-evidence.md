# Watch v2 call evidence — 2026-09-05

This slice implements call admission and media provisioning. It does not establish a completed watch release or native watch audio. No application data, remote call, production migration, deployment, or push was performed.

## Reproduced findings and changes

Baseline reviewed at repository HEAD `b06fd28`:

- **M reproduced.** `call_create` previously accepted 50 invitees/defaulted to 10 participants; `video_join_room` counted before its separate membership write and rejected an active reconnect when full. Calls now require 1–3 distinct real invitees, force four total in the database room and provider room, and use a room-row lock for admission. Legacy released phones that send a participant hint of 10 remain compatible: the hint normalizes to four.
- **N reproduced in creation, disproved in discovery.** `call_create` previously stamped the domain after creation, while `video_create_room` applied Lynk subscriptions and the free five-minute session deadline. `room_kind` now persists in the initial insert and calls bypass those Lynk checks. All three discovery queries in `video_list_rooms` already filter `room_kind='lynk'`; they were preserved.
- `use-video-call.ts` sends four participants and explicitly passes the intended audio/video kind. `call-rooms.ts` rejects automatic calls to more than three recipients.
- New SQL `begin_call_media` / `finish_call_media` serialize provider room creation and peer replacement with a service-only lease. `call_media_peers` stores provider peer IDs, never credentials. Reconnect removes the caller's prior peer before issuing another, retaining the membership row. The legacy peer metadata path is also handled. A verified provider 404 allows room recreation; a peer failure does not destroy an existing live group room.
- The finish transaction rechecks open room, lease ownership/expiry, active membership and bans. A leave/kick/ban while provider HTTP is pending rejects the result. Failed new admission releases its seat. Failed provider cleanup retries three times; an unresolved provider outage is logged without tokens and is not represented as a successful connection.

Implementation: `apps/mobile/supabase/functions/{call_create,call_join,video_create_room,video_join_room}/index.ts`, shared `call-create-schema.ts` / `call-media.ts`, and migration `20260905121000_call_admission.sql`. Call result payloads omit Lynk mode and deadline semantics.

## Verification

| Exact command | Result |
| --- | --- |
| `deno test --no-lock apps/mobile/supabase/functions/_shared/call-create-schema.test.ts apps/mobile/supabase/functions/_shared/call-media.test.ts` | Exit 0; **12 tests passed**. Input bounds, legacy hints, provider cap, reconnect ordering, capacity refusal before provider traffic, failure cleanup, persistence fencing, old peer removal failure, stale room recovery, legacy peers vs other users. HTTP is completely intercepted; no provider traffic occurs. |
| `PATH=/opt/homebrew/opt/postgresql@14/bin:$PATH python3 apps/mobile/supabase/__tests__/call-admission.integration.py` | Exit 0. Real PostgreSQL 14, disposable database, private Unix socket, no TCP listener. Three simultaneous contenders for the final seat admit exactly one; eight concurrent reconnects leave one membership row. Also covers 2/3/4 people, left/rejoin, invite/ban/kick/ended gates, Lynk with eight members, media lease contention/replacement/failure/expiry, leave/kick/ban during provisioning, service-only grants, repeat application, and rollback. |
| `deno check --no-lock apps/mobile/supabase/functions/call_create/index.ts apps/mobile/supabase/functions/call_join/index.ts apps/mobile/supabase/functions/video_create_room/index.ts apps/mobile/supabase/functions/video_join_room/index.ts` | Exit 0. |
| `git diff --check` | Exit 0 at completion of this slice. |

An initial local run used the `libpq` `initdb` binary without its matching server and failed. Re-running with the installed PostgreSQL 14 bin directory succeeded. Deno's incidental root lockfile update was restored after confirming no other agent intended a lock edit; subsequent checks use `--no-lock`.

Independent main-agent review identified a late leave/kick/ban race and a cleanup exception that could replace the intended failure result. Both were fixed; the PostgreSQL cases above exercise the race. The installed `code-review` skill was read. CodeRabbit CLI 0.7.5 is authenticated; its status reports Free/no assigned seat. No CodeRabbit review completion is claimed. This evidence uses the actual independent agent pass and executed tests.

Migration order: deploy `20260905121000_call_admission.sql` before these edge functions. The migration only adds functions and call-specific tables; it does not rewrite existing rooms or memberships. The test explicitly drops the new functions/tables for rollback and confirms pre-existing Lynk memberships survive. Rollback of the code restores the old, uncapped admission behavior, so it is not a release-ready fallback.

## Native watch audio feasibility gate

**Result: Apple system APIs compile; the installed media transport has no watchOS binary. Native audio remains gated.** This is a source and compiler feasibility probe, not a paired-device audio test.

Installed environment: Xcode **26.4.1**, build **17E202**, WatchOS **26.4 SDK**. Its headers expose `CXProvider` and `PKPushTypeVoIP` for watchOS 9+, and `.playAndRecord` / `.voiceChat` audio-session constants for watchOS 2+. A standalone Swift typecheck against `arm64_32-apple-watchos10.0` succeeded for the following APIs:

```swift
import Foundation
import CallKit
import PushKit
import AVFAudio

func configureWatchAudio(_ registry: PKPushRegistry) throws {
    registry.desiredPushTypes = [.voIP]
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = false
    configuration.maximumCallsPerCallGroup = 1
    _ = CXProvider(configuration: configuration)
    try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat)
}
```

Command (exit 0):

```sh
xcrun swiftc -typecheck -sdk /Applications/Xcode.app/Contents/Developer/Platforms/WatchOS.platform/Developer/SDKs/WatchOS26.4.sdk -target arm64_32-apple-watchos10.0 /tmp/dvnt-watch-native-audio-api-probe.swift
```

The snippet only checks symbol availability. It does not register a persistent provider, acquire microphone permissions, receive pushes, or exchange any audio.

`apps/mobile/ios/Podfile.lock` installs `FishjamReactNativeWebrtc 0.29.0` with `FishjamWebRTC 124.0.2.3`. The installed wrapper podspec (`Pods/Local Podspecs/FishjamReactNativeWebrtc.podspec.json`) declares iOS/macOS/tvOS and React dependencies, with no watchOS platform. `plutil -p apps/mobile/ios/Pods/FishjamWebRTC/WebRTC.xcframework/Info.plist` reports only:

- `ios-arm64` — platform `ios`;
- `ios-arm64_x86_64-simulator` — platform `ios`, variant `simulator`.

`xcrun vtool -show-build .../ios-arm64/WebRTC.framework/WebRTC` confirms binary platform **IOS**, minimum OS 12.0. An arm64 architecture alone does not make an iOS binary usable by watchOS.

Official source checks support the gate, without claiming native watch VoIP is impossible:

- Apple DTS confirms watchOS VoIP/CallKit support and the Speakerbox watch target. [DTS thread 822739](https://developer.apple.com/forums/thread/822739)
- Apple DTS describes system CallUI as owning the active watch call screen. [DTS thread 818140](https://developer.apple.com/forums/thread/818140)
- Fishjam's current VoIP guide explicitly targets React Native mobile applications. It is not evidence of a Swift watch transport. [Fishjam VoIP guide](https://fishjam.swmansion.com/docs/how-to/client/voip-calls)
- The archived native Fishjam SDK's podspec declares an iOS 15.1 deployment target and depends on WebRTC-SDK 125.6422.06. It supplies no verified watchOS build path. Its repository points current development to the React Native/web monorepo. [Native podspec](https://raw.githubusercontent.com/fishjam-cloud/mobile-client-sdk/main/FishjamCloudClient.podspec), [repository status](https://github.com/fishjam-cloud/mobile-client-sdk)

The Axiom watchOS skill and its background/networking and WatchConnectivity references informed the inspection. No OS27 API was added based on the brief's unverified platform claims.

Remaining dependency: a compatible native watchOS media transport with the server's current Fishjam protocol, including a verified device/simulator build and secure watch authentication. Once available, an isolated app/scheme must prove mic-in and remote-audio-out both ways, mute/end, locked/background operation, Bluetooth routing, reconnect/transfer, and four participants on paired hardware. Push signing/provisioning and notification delivery also need physical-device verification. The standalone API probe is not that app or scheme; no native-audio capability was enabled.

Provider/Postgres failure compensation is tested locally, but provider outage cleanup, real peer removal semantics, actual transfer behavior and capacity under live media remain integration gates. Calls outside the two authorized QA accounts were not attempted.

## Companion Recents, recipient selection and active phone call relay

Added independent account-scoped call directory contracts/hook and Swift directory/store/views. Own call-signaling rows become bounded Recents grouped by room; accepted/ended signals never imply connected media or fabricated duration. Current viewer resolves from the users row (captured numeric `id` or auth-string `auth_id`), and bilateral blocks are re-read before eligible users and outgoing phone route. The native picker selects one to three people independent of chat group size. Both audio/video continue through the existing phone call route only while foreground and no current call. Pending operation is persisted before awaiting selection validation, preventing concurrent/restarted replay from opening duplicate calls. Search is live and bounded; Calls disabled/logout pushes an empty snapshot.

The active relay installs only in the useVideoCall instance that successfully joined the Calls API, distinguishing shared Lynk store usage. It publishes real provider peer status plus remote participation, observed microphone track state, room/generation and a 30-second expiry every ten seconds. Accepted signaling alone never yields connected. Desired-state mute operates on live tracks through the existing phone mute callback and checks enabled state; end invokes existing phone cleanup. The watch labels audio as on the phone. Active overlay preserves underlying navigation, restores it on end, permits returning to DVNT while the call continues, and disables stale controls. Native wrist audio remains gated by the SDK evidence above.

Added checks:

- `node --import tsx --test packages/app/features/watch/watch-active-call.test.ts packages/app/features/watch/watch-call-directory.test.ts packages/app/features/watch/watch-event-payload.test.ts`: 8/8 passed.
- Isolated `scripts/watch-call-directory-check/main.swift` with CallDirectoryModels/Store: passed recipient cap, offline handoff truth, cached errors, account purge/replay.
- Isolated `scripts/watch-active-call-check/main.swift` with ActiveCallStore: passed live overlay, failed mute remains unconfirmed, dismissal survives heartbeat, end restores underlying UI, stale/retired account rejection and expiry.
- Full app TypeScript check passed for directory; active relay check and combined native target build tracked by integration agent.

Physical live calls, transport loss, Bluetooth route changes, device microphone mute/end and foreground route continuation still need paired-device acceptance. No live call was placed by these tests.

Independent active-relay review fixes: post-mute confirmation now requires nonempty live microphone tracks all matching the desired state (empty tracks cannot pass vacuously); commands include expectedStatus checked against freshly derived phase before action; owned call generation is captured at Calls API invocation, preventing cross-account rebinding. Active view uses DVNT typography/spacing and removes its timer when wrist-down, inactive or disappeared. Existing successful phone join logging no longer serializes the peer token. Active validator/transport-truth/mute tests now 3/3; full app TypeScript check passed after these changes apart from the final log-only edit.

## Native incoming call answer and fallback overlay

`useCallKeepCoordinator.onAnswer` previously navigated even without a fresh signal and wrote accepted without waiting for confirmation. The coordinator now uses `answerIncomingCall`, resolves the current integer callee, refetches a recipient/room/age-bound ringing row with a known audio/video type, conditionally claims it, and checks generation and hangup cancellation after each await before navigation. Duplicate native answer callbacks are ignored. Realtime subscriptions are cancelled/fenced across account transitions and reject stale/future/foreign signals. Ending a stale unrelated native UUID no longer ends the current different room.

The fallback overlay now scopes its Zustand state to viewer plus generation, reinitializes subscriptions for identity changes, expires at the signal's original deadline, and handles accepted/ended/missed updates. Acceptance and decline both return `Promise<boolean>` only after a conditional server decision; generation/network/stale failures never navigate or acknowledge success. Audio-only acceptance remains explicit. A CallKeep-owned phone presentation no longer suppresses the only watch ring publisher: the fresh signal still feeds the companion while the duplicate phone sheet and buzz stay hidden. UI sheet animation callbacks no longer mutate authoritative incoming state.

`node --import tsx --test packages/app/features/services/callkeep/answer-call.test.ts`: 4/4 passed for missing/stale/foreign/unknown-type rejection, conditional claim, account switch/hangup during either await, network failure, and conditional decline. These exercise the actual decision orchestrator with injected transport outcomes. Device CallKit/ConnectionService, paired watch decision delivery and real account-switch acceptance remain integration acceptance tasks.

## Reverified native transport dependency, completion pass

The transport gate was rerun against the installed binaries and current official SDK sources on 2026-09-05. The result is narrower and reproducible: **the installed/currently documented Fishjam mobile stack cannot link into this watchOS target; Apple's native call APIs themselves are available.** No general claim that watchOS cannot support duplex VoIP is made.

Run `python3 scripts/watch-native-audio-probe/probe.py`. The script uses a separate temporary compiler cache, never starts a call, and never touches shared native build products. It reads the installed XCFramework/podspec, typechecks `SystemAPIs.swift` for `arm64_32-apple-watchos10.0`, and attempts to link the matching-arm64 iOS simulator WebRTC slice against watchOS simulator. [Machine-readable result](watch-v2/native-audio-capability.json): system API typecheck exit 0, media link exit 1 with the concrete error:

```text
ld: building for 'watchOS-simulator', but linking in dylib (...) built for 'iOS-simulator'
```

The dependency remains `FishjamReactNativeWebrtc 0.29.0` → `FishjamWebRTC ~>124.0.2.3`; the only installed library platforms are iOS device and iOS simulator, and `vtool` reports the device dylib's `LC_BUILD_VERSION` platform as `IOS`. CPU architecture compatibility does not change that platform identity. The probe reports `nativeWatchMediaAvailable: false` and no capability flag was enabled.

Current official-source verification:

- The maintained [Fishjam React Native WebRTC podspec](https://raw.githubusercontent.com/fishjam-cloud/fishjam-react-native-webrtc/master/FishjamReactNativeWebrtc.podspec) still declares iOS/macOS/tvOS and React-Core/JSI dependencies, with the same FishjamWebRTC dependency and no watchOS platform.
- The [Fishjam VoIP guide](https://fishjam.swmansion.com/docs/how-to/client/voip-calls), currently labeled 0.30.0, explicitly scopes its integration to React Native mobile clients. It provides iOS PushKit/CallKit and Android Telecom setup, not a supported Swift watch client.
- The old [native mobile repository](https://github.com/fishjam-cloud/mobile-client-sdk) is archived as of 2026-02-10 and directs maintained work to the web/mobile monorepo. Its [Swift Package manifest](https://raw.githubusercontent.com/fishjam-cloud/mobile-client-sdk/main/packages/ios-client/Package.swift) specifies iOS and WebRTC 114.5735.08; its CocoaPods manifest uses iOS 15.1 and WebRTC 125.6422.06. Neither is an established watch build. The [current WebRTC-SDK package manifest](https://raw.githubusercontent.com/webrtc-sdk/Specs/main/Package.swift) lists iOS/macOS/Catalyst/tvOS/visionOS and a binary distribution, without a watchOS target. Upgrading a package version therefore does not establish a supported watch transport.
- [Apple DTS](https://developer.apple.com/forums/thread/822739) and [TN3135](https://developer.apple.com/documentation/technotes/tn3135-low-level-networking-on-watchos) distinguish legitimate watch CallKit VoIP from arbitrary background low-level networking. These support implementing a future watch client, not relabeling an iOS binary or promising a raw socket relay will work on hardware.

There is also a concrete backend integration boundary: `_shared/call-media.ts` provisions peers with `type: "webrtc"`, removes the user's previous peer before minting a replacement, and confirms the peer through `finish_call_media`. Migration `20260905121000_call_admission.sql` keys `call_media_peers` by room/user. Calling that endpoint from a speculative watch client would replace phone media rather than prove a seamless handoff. The watch currently receives no reusable Better-Auth credentials or provider peer tokens.

To complete wrist audio while retaining Fishjam, supply a supported Fishjam-compatible watchOS media implementation: device and simulator binaries/build path, capture/playback/echo-control integration, protocol-compatible signaling, secure scoped peer-token bootstrap, and an explicit phone↔watch replacement protocol respecting the existing admission lease. Then verify bidirectional microphone/remote audio, headset routing, background/lock/interruption behavior and 2/3/4-person admission on hardware. Porting an unsupported WebRTC dependency or bridging raw PCM through a new relay would be new transport engineering; the checks above provide no evidence that such a replacement is production-ready. No placeholder “native audio” provider was added.
