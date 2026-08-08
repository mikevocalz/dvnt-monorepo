# Apple Surfaces — Phase 0 Baseline (Widgets · Live Activities · Watch · App Clip)

**Method:** five parallel read-only audits, skills-first (each read its apple-targets reference + the official expo-widgets docs). **Date:** 2026-08-08. **Status:** Phase 0 — **STOPS for approval** before any feature code, per the prompt's §4.

> ⚠️ **Branch-base / integration reality (read first).** These audits ran on `modernization-baseline` (off master), which has SDK 57 but **not** the events work. Two "missing" findings are branch artifacts, not project gaps: `claim_guest_orders` and `lib/outbox` **exist on `events-premium-bar`** (events WS-7 guest claim + WS-12 durable outbox). This prompt leans on events guest-checkout **and** modernization SDK 57 — so Apple execution needs **both** merged. **Decision needed:** an integration branch (events + modernization) or land both on master before WS-1/2/3 execution. Nothing here is committed to any feature branch yet.

> **Autonomy reality.** Unlike events/modernization, this prompt is largely **hardware- and Apple-portal-gated by design**: the watch unblock is Mike's manual App-ID registration; acceptance requires EAS multi-target signing + device QA + TestFlight. Agent-autonomous scope = this Phase 0 + the JS/TS scaffolding that doesn't need device signing to *write* (expo-widgets install/config, widget React components, the live-surface→expo-widgets adapter preserving the hook API, the push-to-start edge fn + token table, App-Group snapshot writers, AASA/associated-domains edits). Swift targets, EAS pipeline, and device sign-off are Mike's to drive.

---

## 1 · WS-2 Watch — the blocker + the App-ID checklist (Mike's manual action)

Team **436WA3W63V**. `@bacons/apple-targets` is commented out (`apps/mobile/app.config.js:283`) over the complication App ID. Targets are ready and internally consistent (13-Swift-file watch app + a **WidgetKit** complication — no ClockKit migration needed; data flows phone→watch via `WCSession.updateApplicationContext` → App Group `group.com.dvnt.app.watch` keys `dvnt.tickets.envelope`/`dvnt.broadcasts.envelope`, which the complication reads via `UserDefaults(suiteName:)` — verified consistent).

**REGISTER on the Developer portal, in order:**
1. App Group `group.com.dvnt.app` — exists, confirm.
2. **App Group `group.com.dvnt.app.watch` — NEW, create it.**
3. **App ID `com.dvnt.app.watchkitapp`** — register + App Groups → `group.com.dvnt.app.watch`.
4. **App ID `com.dvnt.app.watchkitapp.complication`** — register + App Groups → `group.com.dvnt.app.watch`. *(the one the disable comment blamed.)*
5. `com.dvnt.app` (main, exists) — confirm App Groups / Associated Domains / Apple Pay / Push / Sign-in-with-Apple.

**⚠️ Flags that likely save you a migration:**
- **(e) The "Individual account can't register the complication App ID" claim is doubtful.** Individual accounts *can* register nested watch/complication App IDs + App Groups. The original block was probably a not-yet-created App Group or an EAS credential-sync error misread as an unregistered-App-ID error. **Try registering on the current Individual team first** — the Organization move may be unnecessary.
- **(d)** `docs/watch-eas-signing.md` lists `com.dvnt.app.ShareExtension` as an apple-targets target — it's actually the `expo-share-intent@7` plugin's own generated extension, independent of the watch re-enable. Don't conflate.
- **(f)** Both watch targets floor at watchOS 10.0 — confirm target hardware.

**Re-enable path (after registration):** uncomment `app.config.js:283` → `pnpm install` → `expo prebuild -p ios --clean` → `eas credentials -p ios` (base `com.dvnt.app` cert/profile/push key carry over; only new bundle ids need profiles) → `eas build -p ios` → Xcode: confirm the complication widget-ext is embedded in the **watch** app, not the phone → device proof on a real paired Watch+iPhone.

---

## 2 · WS-1 Live Activities engine — DECISION: migrate to expo-widgets

`live-surface` (now `packages/app/features/live-surface/` after WS-6) has a **real ActivityKit module** (`DVNTLiveActivityModule.swift`) that is **disabled** — `with-live-activity.js:21-24` comments out all four iOS steps: *"widget extension + native module cause launch crash."* So iOS Live Activities are a **runtime no-op today** (only Android's ongoing-notification path is wired), and push-to-start was declared in Swift but never plumbed (no token listener, table, or APNs fn).

**Migrate.** expo-widgets generates via CNG exactly what crashed the hand-rolled version (extension target + App Group + `aps-environment` + Info.plist flag). Preserve the `useLiveSurface` hook API (`{payload,isLoading,isLiveActivityEnabled,refresh,end}`); swap `native/ios-bridge.ts` for a thin expo-widgets adapter; `use-live-surface`/`api`/`types`/edge-fn/Android untouched; delete the disabled `live-activity-swift` plugin + the four commented steps after the adapter lands. `expo-widgets` is **not installed**; `@expo/ui ~57.0.9` (its peer) already is. Install `npx expo install expo-widgets` (~57.0.x), plugin `groupIdentifier: "group.com.dvnt.app"` (keeps the existing App Group), `enablePushNotifications: true`.

**Push-to-start (new):** `addPushToStartTokenListener` → new `live_activity_push_tokens` table (user_id + tokens) → new `live-surface-push` edge fn sends APNs `liveactivity` pushes (`apns-topic: <bundle>.push-type.liveactivity`) so the 15-min server refresh reaches the Lock Screen / Dynamic Island while backgrounded — which the current foreground-only `updateLiveActivity` cannot.

## 3 · WS-1 Widgets — portfolio feasibility + snapshot-writer

expo-widgets runtime is **sandboxed** (the `'widget'` directive → no network, no RN bridge, no Zustand/MMKV; renders only `props` + `widgetsDirectory` art via `@expo/ui/swift-ui`). So every widget = "phone app computes a small snapshot + downloads any art to the App Group, then calls `Widget.updateSnapshot(props)`." DVNT already ships a hand-rolled App-Group WidgetKit stack (`DVNTHomeWidget.swift` TimelineProvider, `UserDefaults["surfacePayload"]`, hero→`la_thumbs/`) — the reference to replace; on expo-widgets you call `updateSnapshot` and it owns the snapshot store.

All seven are feasible (in-repo source → snapshot):
- **TheScene** (lowest lift — `events.ts` `friends_going` + the existing `live-surface` tile3 reshape), **NextEvent** (90% built — `ticket-store` + `live-surface` weather; in-widget countdown from `startAt`), **YourPeople** (`stories.ts` — **the close-friend + block filter MUST run in the snapshot writer**, never the widget; avatar/frame → `widgetsDirectory`), **Unreads** (`unread-counts-store`; count trivial, avatars need download, count-only on Lock-Screen accessory), **HostPulse** (`event-analytics` scalars; push for door-time freshness), **Interactive RSVP** (`addUserInteractionListener` → `ticketsApi.issueRsvpTicket`; `rsvp-issue-ticket` returns `already_existed` = server-idempotent, double-tap safe).
- **MyTicket** — ⚠️ **must pre-render the QR to a PNG** in `widgetsDirectory` (the sandbox can't render SVG); **security:** a live entry token on the Lock Screen → tonight-ticket-only + short-TTL/rotating `qr_token` + a user toggle (per the Lock-Screen privacy law), not a default.

**Snapshot writer:** one module on the `use-live-surface` triggers (mount / foreground / 15-min + push for host/ticket), fan out the 7 snapshots, download art content-hashed + LRU-evicted to `widgetsDirectory`. (`lib/outbox` for offline RSVP resilience arrives with the events merge; server idempotency covers correctness meanwhile.)

## 4 · WS-3 App Clip — DECISION: SwiftUI-native

RN/Expo can't fit the 15 MB physical-invocation ceiling (Hermes + Reanimated + Skia + VisionCamera + WebRTC + Stripe-RN). **SwiftUI-native `@main App`**, invocation via `NSUserActivity`/`.onContinueUserActivity` → `URLComponents` parsed **before network** for sub-second paint; consumes the same edge functions over HTTPS. **Size-gate CI** on `app-thinning-size-report.txt`: fail >14 MB, warn >9 MB (RN clip only if a measured build fits).

- **4 URL grammars** (Solito-consistent with the app's existing `/e/:id`, `/u/:username`, `/tickets/guest/:token`): (a) flyer→ticket `/e/:id?clip=1&t=:tierId`; (b) shared `/e/:id?ref=`; (c) guest-list `/tickets/guest/:token` + **NEW** `/e/:id/list?g=:token` (no guest-list claim route exists yet); (d) "add me" `/u/:username?add=1`.
- **Reused edge fns:** `get-event-tickets`, `guest-checkout` (returns hosted Stripe Checkout URL → open in `ASWebAuthenticationSession`, **Apple-Pay-first**, no card data in clip), `rsvp-issue-guest`, `get-guest-ticket`, `stripe-webhook` (unchanged). Apple Pay via `merchant.com.dvnt.app`.
- **Install-migration:** App Group `group.com.dvnt.app` key `dvnt.pendingClaims` (guestEmail + orders[guest_lookup_token] + deferredActions[follow]); PII (email/nonce) in **shared Keychain** (`$(prefix)com.dvnt.app.shared`). On install: read pending → BetterAuth magic-link to guestEmail → **`claim_guest_orders`** re-parents tickets → replay deferred follows post-auth → clear (idempotent). *(`claim_guest_orders` already exists on `events-premium-bar` — it's the guest-claim migration; only the App-Group read/replay layer is new.)*
- **Infra:** add `appclips:dvntapp.live` to `app.config.js` associatedDomains + clip entitlements; the AASA route (`apps/web/.well-known/apple-app-site-association`) needs a **new `appclips` key** (`apps:["436WA3W63V.com.dvnt.app.Clip"]`) + widen `applinks` components beyond `/feed/*` to `/e/*,/u/*,/tickets/guest/*,/public/tickets/guest/*` (both spellings — webhook emits `/public/...`, share grammar implies `/tickets/...`); add `apple-itunes-app` Smart Banner meta to the public event/profile/guest-ticket web heads (absent today). Clip bundle id: `com.dvnt.app.Clip`. Depends on the **same `@bacons/apple-targets` re-enable** as the watch.

## 5 · WS-2 Watch companion — DM + notification map (what's built vs the 7 gaps)

**DM system** (`messages`/`chat` — distinct from Sneaky Lynk rooms + Lynk Live broadcast): conversations + messages (server-authoritative unread via `conversation_reads` cursor; `mark-read` returns an authoritative `{inbox,spam}` snapshot). **Reactions exist** (`react-message`, emoji in `messages.metadata.reactions`; tapback set 😂😢😊😈🥵💝, double-tap ❤️) — a watch tapback reuses it directly. `send-message` fires DM push inline via Expo. Messages capped at `limit(50)`, no pagination.

**Push inventory:** two mechanisms — central `send_notification` (writes an in-app row + routes iOS_voip→APNs-VoIP, web→VAPID, else→Expo) and many senders doing **direct inline Expo Push**. APNs is configured **only for VoIP calls**; everything else is Expo Push. Full category table (message, call, room_invite, sale_open, event_changed/cancelled, event_broadcast, ticket_comped/transfer, waitlist_promoted, event_update [host milestones 75/90/100% + disputes/payouts/fraud], social like/comment/follow/mention/tag, co-organizer invite) is in the audit output.

**7 gaps the watch companion (WS-2) needs but that DON'T exist yet — feed the plan:**
1. **Audio/voice messages: absent entirely** → watch **voice-replies are OUT of scope** unless DM audio (schema + edge-fn + upload) is built first. (Biggest gap; WS-2 quick-replies become canned-text + dictation/scribble only, per the doctrine, unless audio is greenlit as new work.)
2. **No interactive notification categories** — `setNotificationCategoryAsync` is never called; `categoryId` values are sent but unregistered → **no action buttons exist**. Watch quick-reply / quick-react needs categories + `UNNotificationAction`s defined.
3. **No `interruptionLevel`** (time-sensitive/critical) on any push — event-day time-sensitive delivery needs it added to payloads.
4. **DM push is bare** — no `categoryId`, no `thread-id`/`apns-collapse-id` → watch grouping/threading needs a stable thread key.
5. **Read receipts are not real-time to the peer** (realtime is INSERT-only on `messages`; `read_at`/`conversation_reads` isn't subscribed) → watch read-on-glance updates the *unread badge* correctly (server-authoritative `mark-read`) but the peer's "Read" lags until refetch. Real-time receipts need a new subscription.
6. **No pagination** (flat 50) — fine for a watch inbox, caps history.
7. **No mute-thread** primitive — a watch "mute conversation" has nothing to bind to.

Also: reactions propagate only via refetch (no realtime UPDATE) — same limitation as read receipts.

---

## 6 · Decisions requiring Mike (Phase-0 gates)
1. **Branch base** for Apple execution — integration branch (events + modernization) vs land both on master first. (Blocks all execution.)
2. **App-ID registration** (§1) — the manual portal action; try the Individual team first (flag e).
3. **Watch voice-replies** — out of scope unless DM audio messaging is greenlit as new upstream work (gap 1).
4. **US external-purchase-link** and the Live-Activity/widget rollout scope are downstream; not in Phase 0.

*Execution begins only after approval of this baseline + the branch-base + the App-ID registration.*
