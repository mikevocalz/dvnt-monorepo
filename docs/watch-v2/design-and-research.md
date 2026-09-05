# DVNT watch v2: design and research record

This is an implementation handoff, not a report of user interviews or a passed visual review. Native build evidence is separate from runtime evidence. No watch screenshots, rendered treatment comparison, physical scans or device performance measurements were produced in this environment.

## Operating roster and actual work

The brief's author-tier responsibilities were applied as bounded engineering/design passes: watchOS design direction; wearable interaction research; SwiftUI state/navigation; WatchConnectivity/CallKit/PushKit; Wear Compose/Data Layer; Expo target regeneration; real-time media; Postgres/edge APIs; React Native/Zustand; independent accessibility/performance/release review. Three real collaborating agents owned environment/native integration, messaging/Wear, and calls/events. The primary agent integrated contracts, transport, notifications, tickets and review. These are responsibilities, not claimed professional credentials. Independent cross-reviews and their findings are recorded in the evidence files; CodeRabbit authentication was available but its account had no review seat.

## Moments of use and journey map

The following jobs and constraints come from the supplied brief, not an invented study. Interaction counts are code-path expectations requiring native usability validation.

| Journey / moment | Entry and job | Actions / data boundary | Recovery and interruption |
|---|---|---|---|
| Read/reply while moving | Inbox → person/group; read what actually happened | Bounded chronological pages; authorized membership and blocking; compose → explicit Send | Persist draft/outbox/anchor; transport receipt never means sent; retry keeps operation ID |
| Inspect a photo | Tapped attachment in thread | Same tapped image, position/count, Crown zoom; HTTPS bounded rendition | Caption remains on failure; retry refreshes URLs; Done returns to thread; wrist-down hides media |
| Act on an alert | System notification → exact conversation/event/call | Category-specific actions; recipient identity and expiry checked for message writes | Phone foreground required for JS action path; duplicate reply identity maps to one backend message; hardware delivery not proved |
| Respond to an invitation | Events → invitation/status | Real invite, RSVP, saved and waitlist sources; free RSVP or exact phone continuation | Server confirmation only; pending/uncertain writes are not silently replayed |
| Coordinate tonight | Event → permitted people/chat/call | Crew membership must come from authorized data; never auto-call a group | General call picker exists; event-specific Crew/chat/highlight integration remains incomplete |
| Make/receive a call | Inbox Calls or incoming overlay | Explicit ≤3 other recipients; four total enforced transactionally; companion audio stays on phone | 30s commands and ring expiry; ended tombstones; live transport required for connected; preserve underlying view |
| Enter the venue | Now / Tickets / exact complication link | Current pass ID resolves fresh ticket status; canonical QR matrix; one pass at a time | Stable pass ID survives reorder; removal hides QR; wrist-down placeholder; physical scanning unverified |
| Work the door | Now host row → counts/notice | Existing aggregate door source and permission-checked notice endpoint | Timestamp distinct from connectivity; pending notice cannot silently duplicate; permission tested at server |
| Reconnect/change account | Any cached view | Outer session generation gates every domain; retired generations rejected | Clear account stores/media/outbox and widget state on received transition; disconnected devices cannot be wiped immediately |

Now's job is to get the wearer to the next relevant action. Inbox's job is communication, with requests separated from primary conversations. Events contains intent and invitation state even without tickets. Tickets presents admission state. Calls remain inside Inbox rather than creating a fifth root destination.

Assumptions awaiting evidence: 40% Door headers leave sufficient first-frame content at all four sizes; explicit Send remains fast enough with native text entry; the selected pass and media anchor survive real incoming system-call interruptions; a paired phone's foreground request latency is acceptable; round Wear layouts and largest text retain every primary action. None is marked user-validated.

## Sources and applied skills

Read inline; no plugin installation is claimed:

- [User research](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/skills/user-research/SKILL.md): jobs, moments and assumptions above.
- [Design system](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/skills/design-system/SKILL.md): component/token audit below.
- [UX copy](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/skills/ux-copy/SKILL.md): action and recovery wording below.
- [Design handoff](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/skills/design-handoff/SKILL.md): sizes, states and input ownership below.
- [Accessibility review](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/skills/accessibility-review/SKILL.md), [watchOS accessibility](https://raw.githubusercontent.com/CharlesWiltgen/Axiom/main/.claude-plugin/plugins/axiom/skills/axiom-accessibility/skills/watchos-a11y.md): semantic labels, scalable custom type, contrast and wrist-down privacy. Manual assistive-technology gate remains open.
- [Design critique](https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/design/skills/design-critique/SKILL.md): code-level hierarchy review only; critique → capture → recapture is blocked without rendered captures.
- [Frontend design](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md): retained DVNT identity, image-in-place and clear failure states. The required two **rendered native** treatments have not been produced; no phone reference or drawing is substituted for them.
- Local Axiom watchOS references, Axiom SwiftUI/Design/UX-flow, Expo native target guidance and React Native skills informed native structure and integration. Exact applications and installed SDK checks appear in the slice evidence. OS27-only APIs are not inferred from SDK26.4.
- No verified Wear-specific agent skill was available; official Android documentation and installed AndroidX sources are the implementation authority.

Fresh Mobbin references and observed/rejected patterns are in [navigation evidence](../watch-v2-navigation-evidence.md). Fresh lookup coverage now includes all twelve B§7 screen contexts. Mismatched references are explicitly qualified; notification-banner and group-invitation references do not prove OS inline reply or ringing behavior. These are phone references; they are not evidence of DVNT watch rendering.

## Wearable tokens and component anatomy

`Theme.swift` remains authoritative: black canvas; #3FDCFF cyan, #8A40CF violet, #FF5BFC magenta, #FC253A signal, #F5C518 gold. Space Grotesk titles, Republica Minor stamps, Space Mono numerals and the existing Inter content face are preserved. Custom fonts now specify semantic `relativeTo` styles. Radii: chip8, control12, card20, hero24; space:2/4/6/8/12/16. Native platform controls retain their semantics.

The old 40%-white faint text on black computes to 3.66:1, insufficient for ordinary small text. Faint text is now 50% white, 5.32:1 on black. Dim text is 7.37:1; cyan12.89:1; violet3.72:1. Violet remains a brand/ring accent, not the small pass-status foreground. These are mathematical flat-color checks, not measurements of composited artwork or real displays.

| Component | Anatomy and state | Semantics / input |
|---|---|---|
| Door | Art/mosaic, title, wordmark on Now, mono stub; first scroll item | No whole-page link; shares destination Crown owner; no replayed entrance on wrist raise |
| Row | Rounded-square identity, name, preview, local time, unread state, media indication | One native navigation target; full identity in accessibility label; request category preserved |
| Bubble | Sender for groups, text, chronological media, time, reaction counts | Body and media privacy-sensitive; reaction set is 😂 😢 😊 😈 🥵 💝 ❤️ |
| Media thumb/viewer | Bounded aspect-correct decoded image; explicit retry and Done | Tapped attachment identity, count, Crown zoom and button alternatives; never zoom controls/text |
| Status | Text plus optional glyph/color | Never color-only; cached time independent of phone link; no optimistic backend success |
| Button/filter | Native action, explicit verb; compact filter menu | 44pt target intention; largest text/VoiceOver/TalkBack still needs device checks |
| Pass/ring | Current ticket lookup, tier label, canonical QR, state caption | Crown pages by stable pass ID; no stale captured QR; wrist-down hides it |

## Copy deck and state rules

| State | User copy / action |
|---|---|
| Loading history | Loading messages |
| Empty conversation | Say hi to [name] |
| Failed inbox refresh | Couldn’t refresh messages. Open DVNT on your phone and retry. |
| Phone unavailable | Cached messages remain here / Retry |
| Durable send | Queued · Sending… · Sent · Failed; Retry keeps identity, Cancel only while queued |
| Photo failure | Retry; retain caption and a way back |
| New while reading older | New / Read new messages; no forced jump |
| Reply phrase | On my way · I'm outside · Save me a spot · Call you after; editable on phone |
| Unavailable membership | Conversation unavailable |
| Ringing | Answer on iPhone / Answer as audio on iPhone / Decline |
| Companion handoff | Connecting on iPhone…; never Connected on watch |
| Expired active status | Status unavailable / Check your phone for the current call |
| Events | Events not synced / No events yet / Retry sync |
| Unconfirmed write | Result not confirmed. Check on your phone. |
| Wrist down | Raise to show pass / Raise to read messages |
| Missing pass | Pass unavailable |
| Account/privacy | Clear on received account transition; phone settings explain disconnected-cache retention |

## Screen handoff and accessibility gate

The same semantic layout applies at40/41/45/49mm; no device-specific pixel offsets are assumed. Door artwork is a compact first scroll row and may grow with text. The actual pass screen omits decorative artwork so its QR/ring can lead the scan view; branding remains in the ticket list. Text content wraps; preview truncation is confined to rows. Thread/media/pass identity persists separately from presentation. Root tabs own one stack each, list/detail owns its scroll, the pass stack owns vertical pass paging, and the media viewer owns Crown zoom. The existing pass-page inner scrolling requires native Crown behavior validation.

Motion tokens retained: enter240ms, settle280ms, quick180ms, cubic(0.22,1,0.36,1). Repeating state animation pauses when inactive/reduced luminance/reduced motion. No physical timing claim is attached to these design constants. Haptics: page click; incoming-call notification; authoritative new used-ticket success; authoritative sent-message success. Transport receipt and opening a composer do not fire success.

| Screen | Code inspection | Runtime gate |
|---|---|---|
| Now / Inbox / Events | Native scroll, explicit destination, no Door gateway | Four sizes, largest text, first-frame content, VoiceOver: unverified |
| Conversation | Sender/text/media/counts, persistent draft and anchor, explicit send | Crown, VoiceOver action order, interruption: unverified |
| Viewer | Done, selected image, zoom alternatives, wrist-down placeholder | Image framing and escape at all sizes: unverified |
| Call picker / incoming / active | Explicit phone route and recipient bound; call overlays | Watch system call interruption, audio route, mute/end: unverified |
| Tickets | Fresh ID lookup, blocked QR, wrist-down placeholder | Real scan/contrast/quiet zone/dark venue: unverified |
| Host / venue | Server permission boundary and explicit state words | Dynamic Type, notice entry, true staff accounts: unverified |
| Widgets / controls | SDK gates, private preview, scoped deep links | Smart Stack relevance, control invocation, face privacy: unverified |
| Wear | Native Material3 screens, Data Layer, ambient privacy | Round devices, rotary, TalkBack, ongoing activity: unverified |

Release remains blocked on these runtime gates. A successful compiler run is not a visual/a11y pass.


## Completion-pass native visual review

Actual watchOS 26.4 captures now exist at 40, 41, 45 and 49 mm; see [native verification](final-native-verification.md) and [capture directory](captures/). Unpaired states use the app without account data. A/B treatments and actual-screen fixture stores are explicitly synthetic, do not send commands and do not establish hardware or backend acceptance.

The initial 40 mm A/B comparison favors the compact Door artwork: proportional treatment A consumes the useful first screen. Actual 41 mm Event detail keeps the exact Show pass action above metadata. Inbox compact layout exposes the start of the first conversation but still requires scrolling. Conversation uses the production message/composer structure, not a decorative header. The fixture exposed an initial-scroll issue; the bound latest-message target was corrected, and the fresh 41 mm capture now displays the newest message. The actual Ticket fixture exposed a more serious issue: most of its QR was below the initial viewport. The corrected pass layout removes decorative artwork and puts the ring/QR before metadata. Fresh 40, 41, 45 and 49 mm captures show the whole scan surface, and Apple Vision decodes all four native screenshots to the explicit non-ticket fixture payload. QR rendering now reserves a four-module white quiet zone with pixel-aligned modules.

These captures provide layout evidence only. Largest-type wrapping, VoiceOver order, Crown behavior, real venue scanning and physical performance retain their separate acceptance gates. Synthetic QR content is explicitly invalid for redemption.
