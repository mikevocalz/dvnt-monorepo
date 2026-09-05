# Watch v2 native completion verification

2026-09-05. Native build and capture evidence from the completion pass. This record distinguishes compiler results, synthetic visual fixtures, unpaired simulator states, and physical acceptance.

## Reproducible generation

A separate `/tmp/dvnt-v2-clean-prebuild` tree copied the current mobile configuration, plugins, targets, wear and modules. Installed dependency directories were symlinked; native `ios`/`android` directories were initially absent. The current dirty native projects were preserved. This Expo version clears/regenerates native directories for these runs, so the twice-run result establishes regeneration repeatability, not incremental in-place plugin idempotence.

`CI=1 pnpm --dir /tmp/dvnt-v2-clean-prebuild/apps/mobile exec expo prebuild --no-install` passed twice; a later refresh added the notification service. The generated project has exactly one DVNTWatch target, DVNTWatchComplication target, `include ':wear'`, and `WearBridgePackage()` registration, with generated phone Data Layer source. This verifies real Expo regeneration and repeatability, not dependency installation or complete phone packaging. Logs: `/tmp/dvnt-v2-clean-prebuild.log`, `/tmp/dvnt-v2-clean-prebuild-second.log`, `/tmp/dvnt-v2-clean-prebuild-final.log`; checks `/tmp/dvnt-v2-prebuild-checks.json`.

## Builds

| Check | Evidence |
| --- | --- |
| Apple Watch + complication Debug simulator build, current source including quick actions | Passed, including incremental final update. `/tmp/dvnt-v2-watch-render-final.log`; app `/tmp/dvnt-watch-v2-native-products/Debug-watchsimulator/DVNTWatch.app`. |
| Newly generated iOS notification-service target | Passed. `/tmp/dvnt-v2-notification-build.log`; product `/tmp/dvnt-v2-notification-products/Debug-iphonesimulator/DVNTNotificationService.appex`. Generated Info.plist resolves `$(PRODUCT_MODULE_NAME).NotificationService`, extension point `com.apple.usernotifications.service`. |
| Watch device Release without signing | Passed arm64_32 against watchOS 26.4. `/tmp/dvnt-v2-watch-release-final.log`; product `/tmp/dvnt-v2-watch-device-products/Release-watchos/DVNTWatch.app`. Binary string inspection finds no `watch-qa` launch flags or `DESIGN FIXTURE` text. |
| Watch device signing | Failed locally: missing provisioning profiles for `com.dvnt.app.watchkitapp` and `.complications`. Retried with `-allowProvisioningUpdates`; Xcode reports **No Account for Team 436WA3W63V**. Two valid Apple Development certificates exist, but do not establish authenticated team access or matching profiles. `/tmp/dvnt-v2-watch-signing.log`, `/tmp/dvnt-v2-watch-signing-online.log`. |
| Full Android phone arm64 Debug | Interrupted to protect disk after native codegen/metadata stages; no complete artifact. `/tmp/dvnt-v2-full-android.log`. |
| Full iOS phone simulator Debug | Interrupted to protect disk during MoQ Swift package binary resolution; no complete artifact. `/tmp/dvnt-v2-full-ios.log`. |

The signed build was a local development signing check. No store upload or production deployment occurred.

## Native captures

[`scripts/watch/capture-native-v2.py`](../../scripts/watch/capture-native-v2.py) renders the actual compiled SwiftUI app on watchOS 26.4 at 40, 41, 45 and 49 mm. It creates one disposable simulator at a time, captures four states, then deletes only that simulator. The preexisting 41 mm simulator remains available. Captures are in [`captures/`](captures/) with a machine-readable manifest.

The `unpaired` image is the real Now recovery screen without account data. `largest-type` forces SwiftUI `accessibility5` in a DEBUG-only launch branch; this is a layout stress test, not proof that watchOS exposes that category in Settings. `simctl ui content_size` reports unsupported for this watchOS runtime. Treatment A/B are explicit **DESIGN FIXTURE** synthetic examples using the native DoorHeader and a fictional After Hours event. They do not demonstrate backend connectivity, real tickets, or a paired session. Release builds exclude every capture branch.

Initial 40 mm review: the unpaired layout fits its width and leaves the system time unobstructed. Largest-type text wraps within the content column and requires vertical scrolling. Large treatment A spends substantially more of the first screen on the artwork; compact B reveals the next content sooner. Final comparison and all-size inspection are recorded after capture completion below.

## Physical connection and external dependencies

Argent reports iPhone 14 Pro and iPhone 17 Pro as paired, Developer Mode enabled, but neither connected. CoreDevice discovers an Apple Watch Ultra 2 and iPhone 17 Pro as available/paired. Read-only installed-app queries fail: iPhone connection reset by peer; Watch rejects connection with `RemotePairingError 1007` and asks to ensure Mac pairing. No app was installed or launched on those devices in this pass, and no real ticket, message or call action ran.

For physical acceptance the user must connect and unlock the paired iPhone, trust this Mac, keep the paired Watch unlocked/nearby, and authenticate the configured development team in Xcode. Paired notifications, account switching, process-death delivery, wrist privacy, QR scanning, calls/audio routing and measured battery/transfer/performance acceptance remain unverified until those connections and signed installations succeed. Simulator install/build duration is not reported as application launch performance.

## Disk constraint

The pass started with 3.6 GiB free. Native dependency resolution/codegen and one disposable simulator reduced this to 207 MiB. Full phone builds were deliberately interrupted before disk exhaustion, preserving their logs. Only this pass's canceled redundant Swift package checkout and completed notification/signing intermediate directories were removed. After disposable simulator cleanup about 1 GiB was available. Complete phone builds require substantially more free space; this is not a successful packaging check. Shared dependencies, user files and the preexisting simulators were retained.

## User-authorized cache cleanup and resumed builds

After the user authorized freeing space and clearing caches, removed obsolete Gradle version caches (9.2/8.x/7.x/4.x), their unused wrapper distributions, npm download cache, pnpm v10/v11 download stores, and uv/bun package caches. Installed `node_modules`, active Gradle 9.3.1 transforms/module downloads, source files and user data remain intact. Actual free space rose from roughly 0.4 GiB to 12 GiB (about 11.6 GiB reclaimed; `du` sums are not used as the reclaimed figure). Full phone builds resumed sequentially. The final outcome is recorded below when complete.

## Real-view A/B fixtures

Additional 41 mm captures exercise the production `MessagesView`, `DMDetailView`, `EventDetailView` and `TicketStackView` with explicitly synthetic, memory-only stores. Fixtures attach no command relay and write no App Group data. The QR encodes `QA-FIXTURE-NOT-A-TICKET-…` and is intentionally not a real redeemable ticket or QR parity test. A small footer identifies the fixture without occupying a full list row.

Treatment A retains the original proportional DoorHeader height. B bounds its minimum at 58 points; multiline Dynamic Type can still increase actual height. The conversation has no DoorHeader and is deliberately unchanged between A/B, preserving its native message/composer layout rather than adding a decorative gateway. The selected compact header applies to the production first-scroll-row artwork, keeping the same brand, content and navigation.


## Final native visual and QR acceptance

The final render set contains real unpaired recovery and largest-type stress captures for **40/41/45/49 mm**, plus actual native **Inbox/Conversation/Event detail/Ticket A/B** fixtures at 41 mm. The manifest identifies synthetic and unpaired states explicitly. These captures are not paired interaction acceptance for every screen/state.

Capture review produced two production changes: compact Door header padding/minimum height reveals content sooner, and the actual pass entry now opens with the existing QR/ring before tier/event metadata. The all-tickets list retains the branded Door. [`apple-watch-41mm-ticket-before-scan-fix.png`](captures/apple-watch-41mm-ticket-before-scan-fix.png) preserves the original below-fold QR problem. [`apple-watch-40mm-ticket-b.png`](captures/apple-watch-40mm-ticket-b.png) and [`apple-watch-41mm-ticket-b.png`](captures/apple-watch-41mm-ticket-b.png) show the complete scan surface on the smallest cases.

`QRCodeView` now guarantees **four white modules on each edge**, with module edges aligned to integer physical pixels and antialiasing disabled. The redundant fixed outer QR padding was removed so the code stays large within the existing rounded white card and ring. The transported matrix/token and error-correction level remain unchanged. The fixture code intentionally encodes non-ticket text.

Apple Vision successfully decoded all four final native Ticket B screenshots to the exact synthetic payload (4/4). Reproduce with `swift scripts/watch/verify-captured-qr.swift docs/watch-v2/captures/apple-watch-{40mm,41mm,45mm,49mm}-ticket-b.png`. Log: `/tmp/dvnt-v2-qr-scan-final.log`. This is actual rendered-image decode proof; a physical wrist-to-door scanner test remains separate.

[`apple-watch-41mm-conversation-b.png`](captures/apple-watch-41mm-conversation-b.png) confirms the latest-scroll correction: opening a preloaded conversation displays the newest outgoing message, preserving the saved-anchor behavior. No header was added to the conversation. Inbox/Event B retain content and actions while tightening the artwork's vertical padding. Ticket B removes artwork from the scan entry; Ticket A keeps the expanded header as the comparison. All interactions in these captures are fixture-only.

## Definitive generated integration setup

Latest targets/plugins were refreshed into the isolated tree and real Expo regeneration rerun. `pod install` completed there with **230 pods**, using an APFS clone of existing Pods and the original lock's versions. All Pod versions/dependency relationships match the original lock. Six podspec checksum differences were inspected and consist solely of relocated filesystem paths or JSON formatting.

For dependency-cache reuse, the isolated workspace references the equivalent existing Pods project read-only; its **main app project is the newly generated project**. The actual Xcode dependency graph includes DVNT, DVNTWatch, DVNTWatchComplication and DVNTNotificationService. The phone's embed phases include the notification service and Watch app, and the Watch app embeds its complication. No user dirty native project was overwritten.

Full iOS builds must select `-destination 'generic/platform=iOS Simulator'` **without** global `-sdk iphonesimulator`: that override incorrectly forces the Watch target through iOS APIs. An earlier command caught this invocation error; it was corrected without adding inappropriate iOS availability to watch-only source. Definitive build log: `/tmp/dvnt-v2-clean-full-ios-final.log`.

Final hardware/signing recheck: iPhone 17 Pro now reaches the developer-image mount, but reports **device locked** (`0xe80000e2`). Watch still rejects Mac pairing (`RemotePairingError 1007`). Xcode still reports **No Account for Team 436WA3W63V** and missing Watch profiles. Logs: `/tmp/dvnt-v2-final-phone-connect.log`, `/tmp/dvnt-v2-final-watch-connect.log`, `/tmp/dvnt-v2-final-signing.log`. No repeated permission prompt was issued; user connection/account requests remain pending.
