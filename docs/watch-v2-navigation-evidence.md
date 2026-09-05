# Watch v2 navigation and freshness evidence

Scope: navigation/freshness and subsequent messaging, session, widget integration, 2026-09-05. Native source files only; no generated Xcode project changes. Environment captured in [watch-v2-environment.json](watch-v2-environment.json).

## Findings and implementation

| Finding | Source evidence before change | Result |
|---|---|---|
| A: Door gateway | `MarqueePage.body` wrapped every page in `NavigationStack` and whole-page `NavigationLink`; each destination supplied another stack. | `RootTabs` owns exactly four stacks, ordered Now · Inbox · Events · Tickets. `DoorHeader` has no navigation or scroll container; it is the first item inside each destination's native scroll. |
| I: reachability-as-freshness | `StalenessFooter.body` selected `"Live"` solely from `connectivity.isReachable`. | `SnapshotFreshness` always displays snapshot date and time, or `Not synced yet`. `PhoneLinkStatus` independently says `iPhone reachable` / `iPhone not reachable`. Inbox reports conversation and host-notice snapshot dates separately. |

The header uses the actual content viewport's 40% minimum height. It grows for Dynamic Type instead of clipping or shrinking text. Now displays the existing DVNT image asset above its mono stub; its title is in native navigation chrome and the event title immediately follows in the hero. Artwork retains `EventArt` fallback and the bounded rounded-square mosaic. Removed entrance animation from headers, mosaic tiles and root list rows. The rail's page-change animation respects Reduce Motion and wrist-down.

Populated Inbox rows need no gateway tap. Now places Show ticket immediately after the event title, ahead of countdown and venue. Empty states are in the same scroll hierarchy. Unknown snapshot state says not synced; reachability never certifies a successful fetch. Missing ticket/event destinations show an unavailable screen rather than an empty navigation destination.

## Native interaction map and limits

| Page | First scroll item → content | Primary route | Crown owner |
|---|---|---|---|
| Now | Wordmark Door → focused event hero → host row → snapshot/link | Show ticket → existing `TicketStackView` | ScrollView; pushed pass screen owns vertical paging |
| Inbox | Avatar Door → conversation/host rows → snapshot/link | Row → existing conversation or broadcast detail | List; destination owns its own scrolling |
| Events | Flyer Door → independent EventStore sections (Tonight, Invitations, Going, Interested, Waitlist, Saved, Hosting, Past) → snapshot/link | Event row → EventDetailView; eligible server-confirmed actions and ticket route | List |
| Tickets | Nearest live pass with Door header inside TicketStackView; All tickets chooser | Direct current pass; chooser opens another event stack | One vertical pass pager; no enclosing scroll |

Current integration: Tickets presents the nearest live pass directly, with Door header and an All tickets chooser. Ticket selection persists stable ticket IDs and resolves the current store on every render, so removed, scanned or refunded passes cannot keep a captured valid QR. Always On hides pass contents. Events now has an independent authorized EventStore and detail/action surface; it is no longer ticket-derived. The earlier group-only Tickets and ticket-derived Events were intermediate baseline limitations, now resolved in source. Native first-frame and QR scan validation remain unperformed.

Full navigation-path restoration across process death is not implemented. The selected root tab and ticket ID use SceneStorage; thread anchors persist in account-scoped state. Theme neutral faint text is 0.50 (reported black-background contrast 5.32:1), and custom font styles now declare relativeTo categories for Dynamic Type. No invitation, presence, RSVP, Wallet or QR state is invented.

## Fresh Mobbin searches, images inspected

These are phone references, not native watch validation. One fresh search was run for each root screen; all four returned images were visually inspected.

| Destination | Reference | Observed | Adaptation / rejected pattern |
|---|---|---|---|
| Now | [Luma event ticket](https://mobbin.com/screens/867a69c9-44c8-4daf-bc71-289ab6bb87ac) | Flyer, title, date and going status precede a prominent My Ticket button; venue/weather below. | Keep ticket action ahead of secondary details. Reject the four-button horizontal action bar on the wrist. |
| Inbox | [WhatsApp chats](https://mobbin.com/screens/14fcc4ed-fecf-4f61-b99a-2b2b76b7332b) | Conversation rows are already visible under title/search/filter chrome. | Open directly on real rows, no category gateway. Reject Meta AI/search-heavy chrome and circular avatars. |
| Events | [Facebook past events](https://mobbin.com/screens/bd6f3120-7d10-432d-90a5-8e97e7d33a6b) | Repeated compact image/date/title rows and attendee faces under a Past events heading. | Keep temporal sections. Reject public attendee faces without permission and phone bottom navigation. |
| Tickets | [Eventbrite tickets](https://mobbin.com/screens/0d04ebee-04f4-44ce-95f5-9d388307461a) | The first ticket card appears immediately, followed by Coming up; ticket count/QR glyph distinguishes it. | Direct ticket content after header. Reject a full-screen brand gate and order-management controls. |

## Applied skills and verification boundaries

Read local `axiom-watchos`, `design-for-watchos`, `platform-basics`, `watchos-design-guidelines`, `building-native-ui`; opened Axiom SwiftUI/navigation/UX-flow, Design, watchOS accessibility and Expo native-UI sources. Applied shallow native stacks, one Crown owner, content-first hierarchy, readable Dynamic Type, no wrist-raise choreography, and source-owned target files. The locked horizontal root overrides generic vertical-tab guidance. The Expo UI guidance does not replace this SwiftUI target with React Native.

No simulator or native preview capture is claimed: Argent returned no watch simulator, and Xcode listed only generic watch destinations plus an ineligible physical Watch (`doesn’t have a known architecture`). 40/41/45/49mm, largest Dynamic Type, VoiceOver, wrist-down privacy, and actual first-frame visibility require rendered checks. No two-treatment comparison or measured performance claim was fabricated.

Initial navigation-slice validation (superseded by the successful linked builds below): `xcrun swiftc -frontend -parse` over the four edited Swift files passed (exit 0). Full installed-SDK typecheck passed (exit 0): `xcrun swiftc -typecheck -target arm64_32-apple-watchos10.0 -sdk /Applications/Xcode.app/Contents/Developer/Platforms/WatchOS.platform/Developer/SDKs/WatchOS26.4.sdk apps/mobile/targets/watch/*.swift`. It reported one Swift 6 isolation warning in `DMStore.init` default arguments, forwarded to the integrating agent. This is typechecking, not a linked build or rendered run. QR rendering and scanning are unchanged and unverified in this slice.

Gradle task discovery failed during configuration (exit 1): `No space left on device` while instrumenting react-native-moq AGP 9.1.1 dependencies. Wear compilation was not reached. An initial partial-header typecheck was invalidated by a concurrent whitespace edit; the subsequent full-target typecheck above is the valid result.

## Conversation imagery and interruption follow-up

`DMListView.swift` now uses a shared actor cache in `WatchMediaLoader.swift`. Image bytes stream through `URLSession.bytes(for:)`, checked before appending beyond 2 MiB; decoding uses ImageIO thumbnail creation on the cache actor, away from MainActor. Display sizes are 64 px for inbox previews, 256 px for thread thumbnails, and at most 512 px for the viewer. The decoded-image LRU budget is 8 MiB; at most two transfers run concurrently. These are configured resource limits, not measurements of total process memory. The ephemeral session disables URLCache, cookies and credential storage; no images persist to disk. Each cache key includes account generation; `purge()` clears images, cancels active transfers and prevents earlier requests from repopulating the cache.

Thumbnail Retry is independent of Open photo: only a loaded image is a button, eliminating nested buttons on failures. A failed image retains the message caption. Retry also requests a refreshed thread, and the viewer resolves attachments from the live page so renewed URLs are used. The viewer has a native Done action, tapped-image identity/count, horizontal attachment paging, Crown zoom and accessible +/- alternatives. Zoom transforms only image pixels. Wrist-down replaces the viewer with a privacy label.

New message IDs set a visible `↓ New` affordance rather than scrolling away from older content; following it is an explicit action. Initial load/restored anchors are handled separately. Date separators derive from canonical timestamps using the current calendar and localized dates. Missing conversations/media show an unavailable state. Native runtime confirmation of anchor behavior, Crown ownership and retry hit targets remains blocked by the missing Watch destination.

Host fixture command (no network, synthetic image data only):

```sh
xcrun swiftc -parse-as-library apps/mobile/targets/watch/WatchMediaLoader.swift scripts/watch-media-check/main.swift -o /tmp/dvnt-watch-media-check
/tmp/dvnt-watch-media-check
```

Both exited 0. Assertions cover 4000 px downsample to 512 px, header and streaming body limits, malformed images, 403/expired response, HTTP rejection, cache hits, account separation, decoded LRU eviction, two-transfer ceiling, and account-reset cancellation without stale cache repopulation. Final all-source watchOS 10 / SDK 26.4 typecheck with `-whole-module-optimization` exited 0 without diagnostics. This does not establish frame rate, physical-device memory plateau or scanning performance.

Follow-up fresh searches, returned images inspected:

- [Instagram conversation](https://mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7): an image remains in the chronological thread alongside text and a timestamp. Applied image-in-place and retained caption; rejected its voice recording controls because DVNT has no voice-message contract.
- [WhatsApp image selection/editor](https://mobbin.com/screens/3c665ae6-7282-4aef-ab1f-6db99d8a78a8): the search returned an editor rather than a pure received-photo viewer. The inspected image shows one selected photo, three thumbnails and a back affordance; it does **not** provide evidence of a numerical photo count. Applied explicit escape and selected-image identity; rejected editing/generation/send controls. Count/Crown behavior comes from the watch brief, not this phone reference.

## Linked native build

The explicit native watch target built successfully on 2026-09-05 (exit 0), including the embedded complication:

```sh
xcodebuild -project apps/mobile/ios/DVNT.xcodeproj -target DVNTWatch -configuration Debug -sdk watchsimulator -arch arm64 -jobs 2 SYMROOT=/tmp/dvnt-watch-v2-native-products OBJROOT=/tmp/dvnt-watch-v2-native-intermediates CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO build
```

Product: `/tmp/dvnt-watch-v2-native-products/Debug-watchsimulator/DVNTWatch.app`. Build log: `/tmp/dvnt-watch-v2-native-build.log`. The log explicitly compiles both `WatchProtocol.swift` and `WatchMediaLoader.swift`; the existing PBXFileSystemSynchronizedRootGroup includes them automatically. No generated project edit was needed. That initial build reported manual target ordering and skipped AppIntents metadata extraction. The later widget/control build adds a real AppIntents dependency and is tracked below.

Earlier, `xcodebuild -project ... -scheme DVNTWatch -destination 'generic/platform=watchOS Simulator'` failed with exit 65 because the implicit companion scheme also built the **phone** target without the CocoaPods workspace dependency graph (`Expo`, `React`, `EXUpdates` missing). That failure is recorded in `/tmp/dvnt-watch-v2-build.log`; it is not a watch source failure. The successful explicit-target build above establishes watch+complication compilation/linkage only. Phone integration, regenerated clean-prebuild equivalence, signing, installation and physical-device acceptance remain separate checks.


## Session isolation and thread actions

- `WatchSessionGate` accepts protocol 2 nonempty generations, persists retired generations and a pending-reset journal. A new generation resets Tickets, Broadcasts, Door, Calls, Events and DMs before applying any domain payload; interrupted resets resume on cold launch. Unscoped domain data is rejected after v2; command/event results retain their own generation validation. Thread replies and unsolicited pushes follow the same session scope.
- DM reset uses a zero snapshot timestamp so a valid cached envelope can populate the new session. Image cache purge is attached to reset. Call decline now writes the existing ended-call tombstone before removing presentation.
- Threads expose explicit Mark read and React actions, seven required reactions (`😂 😢 😊 😈 🥵 💝 ❤️`), server-provided counts, backend-confirmed update status and retry retaining desired reaction presence. No optimistic unread/reaction mutation. Active scene and changed last-message ID request current thread data; an arriving newest message retains reading position and exposes the New button.
- Account reset dismisses media and reaction dialogs and clears action, draft, scroll and outbox state. Failures from an older request cannot mark the new account successful.
- `scripts/watch-session-check/main.swift` passed: same-second account transition, delayed old generation with newer timestamp, cold restart retired generation rejection, interrupted reset recovery, invalid protocol/generation/time.
- `apps/mobile/targets/watch-tests/DMStoreTests.swift` passed with added reset/next-snapshot, backend result, reaction desired-state retry and stale completion isolation checks. Command: `xcrun swiftc -parse-as-library apps/mobile/targets/watch/DMModels.swift apps/mobile/targets/watch/WatchProtocol.swift apps/mobile/targets/watch/DMStore.swift apps/mobile/targets/watch-tests/DMStoreTests.swift -o /tmp/dvnt-watch-dm-check && /tmp/dvnt-watch-dm-check`.
- Full watchOS SDK source typecheck passed with Events integration. Native target build was repeated successfully after session, Events transport and thread action integration (same `/tmp/dvnt-watch-v2-native-build.log`). Earlier standalone `DVNTWatchComplication` target build also passed (`/tmp/dvnt-watch-v2-complication-build.log`). Generated project remained untouched; synchronized source group included new files.
- Runtime reading-position behavior, seven-emoji picker sizing, paired account transitions, haptics and real device interaction remain unverified because no eligible Watch destination is available. These builds are unsigned simulator products, not release archives or runtime captures.


## Complications, links and verified watchOS 26 surfaces

- Read `axiom-watchos/skills/smart-stack-and-complications.md` and `controls-and-live-activities.md`; inspected installed WatchOS26.4 SDK Swift interfaces before implementing APIs. `RelevanceConfiguration`, `RelevanceEntriesProvider`, native `StaticControlConfiguration` and control widgets are watchOS 26.0+; `WidgetCenter.invalidateRelevance(ofKind:)` exists since watchOS 11. New relevant/control bundle entries are gated at watchOS 26. The existing circular/inline/rectangular timeline widget remains deployable on watchOS 10.
- `ComplicationCache` reads App Group data only, rejects an interrupted session reset, and creates an encoded `dvnt-watch://ticket?id=…&accountGen=…` link for the exact valid pass or `event` fallback. It contains no QR token or credentials. The canonical watch Info.plist registers the scheme. `WatchDeepLinks` verifies current generation, resolves current stores, handles removed targets, selects exact ticket ID, dismisses for account changes and yields to an incoming call. App applies this modifier inside environment injection.
- Gallery snapshots/placeholders never read account data. Details are hidden by default; an actual native watchOS 26 control changes the App Group privacy preference via SetValueIntent. The identical intent declaration is compiled into both app and widget targets. Widget details also honor privacySensitive and wrist-down state; no broadcast/message text appears on the face. A generation reset hides details again.
- Widgets show a dated Synced/Cached label (one-hour stale threshold), or Open app to sync. Circular countdown remains available when details are enabled; otherwise the glyph is generic. The system may defer timeline refresh; none of these labels claims transport reachability or guaranteed refresh timing.
- The relevant widget supplies ONLY the next cached event's actual published date as `.date(date, kind: .scheduled)` and uses `.associatedKind("DVNTWatchComplication")` to deduplicate the timeline card. No fabricated event intervals, venue geofences, alarm schedules, APNs enrollment or Smart Stack placement guarantees. Accepted domain changes reload timelines and invalidate relevance; privacy changes do the same.
- `scripts/watch-complication-check/main.swift` passed cache/encoded exact target, generation/reset privacy gate, stale timestamp, event fallback and invalid scheme/missing scope cases. Host compile includes `ComplicationCache.swift` and pure `WatchDeepLink.swift`. Both complete app and complication SDK typechecks passed with watchOS 10 deployment target.
- Unsupported/unverified: actual Smart Stack suggestion eligibility and placement, Control Center/Ultra Action Button gallery, Double Tap, all watch sizes, preview/privacy rendering, native URL launch, paired transitions, APNs widgets and Live Activities. No eligible Watch simulator/device exists here; source compilation is not proof of these interactions. Native watch audio remains separately gated.
- Inbox error envelopes now preserve existing threads, pages, drafts, outbox and snapshot time; failed refresh displays error/retry instead of a false empty/fresh state. Added regression assertion passed. Call Directory transport now participates in the same session reset and generation validation as Events.

Final integration native target build exited 0 after the complication/control/deep-link and Calls Directory changes. `/tmp/dvnt-watch-v2-native-build.log` ends `BUILD SUCCEEDED` and includes successful `ExtractAppIntentsMetadata` for both DVNTWatch and DVNTWatchComplication plus compilation of both privacy intent copies. Product Info.plist contains the registered `dvnt-watch` URL scheme. No signing, installation, archive or distribution submission was attempted.


## Venue actions and backend source correction

- Ticket pages expose RSVP/event detail navigation plus explicit approaching / arrived / departed / revoke controls. Presence sends only a state word and event/ticket IDs, never coordinates; explanatory copy distinguishes sharing from admission. `event-presence` independently verifies the ticket belongs to the authenticated caller and event. No late state, location permission or background tracking was added.
- Door exposes an explicit notice draft, audience (all/scanned/unscanned), 400 UTF-16-unit limit and Send. Source verification: `apps/mobile/supabase/functions/event-broadcast-message/index.ts` accepts event_id, body, optional audience/title; it has NO intent argument. Owner or accepted admin authorization stays server-side. No fabricated intent is sent.
- `watch-venue-actions.ts` validates exact fields, current generation, UUID operation identity and <=60s expiry. `use-watch-venue-actions.ts` captures credentials and guards account identity around every await. A persisted phone journal records pending before mutation; a repeated/uncertain operation never sends again, including after relaunch. The journal is bounded at 500 operations per account generation and fails explicitly to phone continuation when full; entries are not silently evicted and replayed.
- Watch venue state persists draft and pending operation. Cold launch turns an interrupted send into unconfirmed, disables repeating an uncertain notice, and requires an explicit new-notice confirmation after checking iPhone. Only backend confirmation updates success copy. Zero recipients displays No attendees matched this audience. Account transitions clear action state; late failures cannot replace confirmation.
- Backend schema references (`20260708173743_get_event_detail_add_tz.sql`, `20260613005000_event_edit_aggregate.sql`) establish `events.end_date`. `event-presence` previously selected nonexistent end_time and added six hours twice on missing dates. It now selects end_date and uses the tested helper `presenceExpiry`: end+6h, otherwise now+6h. No database migration or production invocation was performed.
- `event-broadcast-message` previously ignored the notification insert error and could return ok without saved notifications; it now returns an error before attempting push when persistence fails. A transport/backend failure is still treated as uncertain on the watch, not automatically repeated.
- Four TS tests pass via `pnpm exec tsx --test packages/app/features/watch/watch-venue-actions.test.ts`: validation/state/expiry limits, persisted duplicate/restart protection, confirmation/account transitions, and expiry boundaries. `VenueActionStoreTests.swift` passes explicit send, cold pending lock, backend-confirmed status, late timeout, invalid state and account clear assertions. All watch sources typechecked successfully with the installed SDK after Venue/ActiveCall wiring. Manual backend behavior and Watch interaction remain unverified; no production API calls were made.

Venue/ActiveCall integration native target build exited 0 with the same explicit-target command and log. Subsequent same-generation conversation authorization changes filter all cached pages, drafts, anchors, loading state, actions and outbox against each successful Inbox envelope. Removed conversations purge the image cache and dismiss open media/reaction sheets; delayed pages cannot repopulate an omitted conversation. Error snapshots preserve caches. The focused DMStore regression preserves another conversation while removing the revoked one and passes; the all-source SDK typecheck passed after this change. This intentionally evicts conversations omitted by the bounded authorized Inbox envelope, even if an older omitted conversation is still valid, in preference to retaining unverified authorization.


## Host Door final integration

DoorStore now accepts scoped protocol-2 ready/error envelopes, persists retired generations, rejects older ready snapshots and preserves previous aggregate counts/time on failed refresh. Missing or negative counts fail decoding instead of becoming zero. Host Door displays cached error + Retry and separate dated freshness/link status; initial failure displays Door unavailable. WCM requests requestDoor, resets DoorStore on account changes and enforces session generation. `DoorStoreTests.swift` passed count/error/order/account/cold-replay assertions.

Fresh Host Door lookup: the first search returned [MacroFactor strategy](https://mobbin.com/screens/215233aa-292a-42c2-aa5a-d8740ade221c), which shows a nutrition check-in countdown and was rejected as unrelated to venue attendance. A deep follow-up returned [Partiful Manage Guests](https://mobbin.com/screens/875b0f88-f827-413b-af4e-e8316e1fd76b): Going/Maybe/Can't Go counts above guest rows and a bulk-actions sheet with Check in guests/Download CSV. Adapted compact labelled aggregate hierarchy; rejected guest editing, bulk check-in and CSV on the wrist. This reference is RSVP/guest management, not proof of live scanned counts; DVNT's scan counts come from the authorized backend summary.

Final explicit DVNTWatch target native build exited 0 after Now invitation/weather fallback, IncomingCall, ActiveCall, Venue and Door integration. Complication embedded and linked successfully. `/tmp/dvnt-watch-v2-native-build.log` ends BUILD SUCCEEDED. Session-owned native intermediates were removed afterward to recover build space; product `/tmp/dvnt-watch-v2-native-products/Debug-watchsimulator/DVNTWatch.app` and all logs are preserved. No generated project edits or device installation were performed.


## Remaining per-screen reference lookups (follow-up review)

Fresh searches were run for every remaining B§7 context, returned images inspected, and weak first-pass matches retried with deep search. This completes lookup coverage across the twelve named contexts; it does not establish native visual acceptance or imply every requested interaction appeared in a reference.

| Context | Fresh inspected reference | Actual observation | Watch adaptation / rejected pattern |
|---|---|---|---|
| Recipient picker (7.5) | [WhatsApp Add people](https://mobbin.com/screens/2b6c9bb7-6b12-423e-9b95-8198d78e513c) | Header count 1/30, selected John chip with remove affordance, search, Frequently contacted, row checks and Add to call. | Apply explicit selected count/chips and final action; DVNT limit is three others, not the phone's 30. Reject alphabet rail and automatic group-wide calling. |
| Incoming call (7.6) | [WhatsApp group call invitation](https://mobbin.com/screens/015c34fb-3854-43a9-b803-c9171ce6ac9b) | Two participant names, Group call label, layered avatars, Alex joined status, Ignore/Join buttons. | Apply caller identity, explicit call context and clearly separated primary/decline actions. This is a join invitation, not proof of ringing/accept/expiry behavior; those contracts come from backend/native sources. Reject phone wallpaper and large circular avatar composition. |
| Event detail (7.8) | [Partiful event information](https://mobbin.com/screens/b6e0629b-9518-42b6-8c4a-b1ad83ecbf53) | Host identity, Central Park location, suggested price, available spots, RSVP-by deadline and bottom host Edit/Text Blast/Invited/Invite/More bar. | Apply scannable venue/host/status metadata and permission-bound host notice route. Reject five-action floating bar, suggested payments and public counts without an authorized source. This frame does not show the Going/Maybe/Can't Go picker. |
| Reconnect/account states (7.11) | [Waymo offline](https://mobbin.com/screens/66ee96c8-a0e3-401b-a8d2-d7c80dbdaae7) | Offline heading, network unavailable explanation and Retry action. | Apply explicit unavailable explanation + Retry alongside last-known watch data. Reject replacing usable cached tickets/messages with a full blank offline screen. |
| Notifications (7.12) | [Tolan notification banner](https://mobbin.com/screens/da5875fb-c10e-43f9-ae8b-dce0fcc8e658), [Meetup in-app Reply sheet](https://mobbin.com/screens/8ab0b5a2-76ee-4c8d-89e0-a33fcb1f890d) | Tolan shows a compact title/body banner; Meetup shows a reply sheet with parent message context, close and message field. | Apply concise category identity, context and explicit close/reply. Neither returned frame proves an OS inline reply notification; notification-category behavior remains grounded in Expo/native APIs and unverified on device. Reject decorative notification art and exposed sensitive message previews. |
| Media viewer (7.4 follow-up) | [Careem photo viewer](https://mobbin.com/screens/303977eb-2a8c-4a2e-ab2e-d0d9e0ec562c) | One large photo, upper-left close, June 2024 caption and 5/12 counter. | Apply explicit close and selected image count while retaining thread position. Reject unrelated branding and phone geometry; Crown zoom is from watch guidance, not this reference. |

Rejected first-pass matches: [WhatsApp Group info](https://mobbin.com/screens/fe36a6c4-14d5-4ae9-aa30-7f307ab83266) lacked a selection list; [WhatsApp conversation call records](https://mobbin.com/screens/ff7ec209-6c71-4eef-9df6-c5667fd27a49) was neither a ringing screen nor photo viewer; [Partiful host settings sheet](https://mobbin.com/screens/fe7d3123-5e28-4be9-9ee1-c720d69ed3a5) lacked guest RSVP controls; [WhatsApp device status](https://mobbin.com/screens/2b63d664-eed1-46b4-a87f-1dd662dcc492) showed Active/Log out rather than offline/retry. No behavior is inferred from search metadata alone.
