# Messages + Sneaky Lynk — Completeness Punch List (Prompt 14)

> **Bar:** a feature present in the native screen but absent on web is a defect.
> Native is the spec. This doc is the inventory + the closeout.
>
> **Date:** 2026-06-18 · **Gate:** `pnpm verify:parity` green · `turbo typecheck` 13/13.

## TL;DR — the prompt's premise was largely stale

The prompt assumed the web side was "not existent / half-built / thin shells." It is
not. Every messages + lynk screen already has a **real** `web.tsx` (not a
`WebScreenFallback`, not a native re-render), data-wiring is at 100% parity per the
verifier, and the Sneaky Lynk inbox tab was already wired on web (commit `5c00a37`).
This is the same pattern the Prompt 13 audit found — far more built than assumed.

The genuine defects were narrow, and are now fixed. The one large, real gap — the
Sneaky Lynk **room** web UI — has been deep-ported per the owner's explicit decision.

### Architecture note that resolves the prompt's central question

There are **two** distinct "Lynk" subsystems. They are NOT the same feature:

| Subsystem | Path | Transport | Shape |
|---|---|---|---|
| **Sneaky Lynk** (this prompt) | `src/sneaky-lynk/`, `features/sneaky-lynk/`, route `(protected)/sneaky-lynk/` | Fishjam WebRTC (`@fishjam-cloud/react-client` on web, `…react-native-client` on native) | Multi-party rooms: speakers/listeners/hand-raise |
| **Lynk Live** (Prompt 6) | `lib/lynk/`, `features/screens/(protected)/lynk/[roomId]` | **MoQ** (`useMoqToken`, `relay.fishjam.io`, `lynk-moq-token` edge fn) | Broadcast livestream: host/cohost → many viewers |

**Decision (owner, 2026-06-18): deep-port the existing Fishjam Sneaky Lynk room UI to
web now.** No MoQ migration is in progress for the multi-party room concept (zero
`MoQ/WHIP/WHEP` references in `src/sneaky-lynk/`); the MoQ build is a separate
broadcast feature with its own `web.tsx`, tracked under Prompt 6 (web route wiring
still owed there — out of scope here). So porting the Fishjam room UI is **not**
throwaway work.

### Nav decision (owner): keep Sneaky Lynk as a Messages tab

Native exposes Sneaky Lynk as the **3rd tab inside the Messages screen** on both
platforms (not a standalone bottom-tab / rail item). Per owner choice we **match
native** — Sneaky Lynk is reachable via Messages → Sneaky Lynk on web (`SneakyLynkTab`
in `messages.web.tsx`) and native. No redundant top-level rail item was added (that
would diverge from the source of truth). The web AppShell rail keeps its existing
Messages item (`app-shell.web.tsx`).

---

## Punch list

Legend: ✅ complete · 🔧 fixed this pass · ⌛ accepted deferral (justified) · ⚪ N/A.

### Messages — conversation list (`messages.web.tsx` ← `(protected)/messages.tsx`)

| Feature | Status |
|---|---|
| Conversation list (DMs + groups), virtualized | ✅ |
| 3 inbox tabs (Inbox / Requests / **Sneaky Lynk**) | ✅ |
| Unread badges (inbox + requests), last-message preview, timestamps | ✅ |
| Presence dot, search/filter, group 2×2 avatar + badge | ✅ |
| Mark-as-read, delete/leave conversation, empty/loading states | ✅ |
| Realtime INSERT subscription (identical channel to native) | ✅ |
| Sneaky Lynk live-rooms tab (`getLiveRooms` → room cards) | ✅ |
| `useLynkHistoryStore` local-room history in the Lynk tab | ⌛ web fetches **live** rooms on demand instead of replaying local history — a deliberate web adaptation; itemized in the verifier debt ledger. |

Data layer: 100% parity (verifier section 4 clean). Typing indicators/tier-badges/
archive/mute/block/error-UI are **absent in native too** → not web defects.

### Messages — conversation thread (`chat.web.tsx` ← `(protected)/chat/[id].tsx`)

| Feature | Status |
|---|---|
| History (TanStack Virtual), send text, optimistic send | ✅ |
| Attachments (file picker), media grid in bubbles | ✅ |
| Read receipts, typing indicator, reactions (double-tap + sheet) | ✅ |
| Edit / unsend, mentions (suggest + navigate) | ✅ |
| Shared-post / event-share / story-reply bubbles | ✅ |
| Realtime message subscription | ✅ |
| **Audio/video call buttons** (1:1 + group) | 🔧 were dead UI on web — now wired to `/feed/call/[roomId]` with the same outgoing-call params as native (`startCall`). |
| **Group header avatar** | 🔧 was a single avatar — now a 2×2 member stack (parity with native's multi-avatar header). |
| Media preview lightbox (`useFeedPostUIStore`) | ⌛ web opens media via `window.open` rather than the native Galeria lightbox — justified web adaptation; itemized in the debt ledger. |
| Camera capture, keyboard-avoiding, swipe-to-delete | ⚪ native-only mechanisms (web has file-input + Enter-to-send + click-to-unsend). |

### Messages — new DM / new group / settings

| Screen | Status |
|---|---|
| `new-message.web.tsx` (user search → resolve/create convo) | ✅ real, full parity |
| `new-group.web.tsx` (multi-select, name, create, debounced search) | ✅ real, full parity |
| `settings/messages.web.tsx` (all prefs toggles, mutation) | ✅ real, full parity |

**Note on the `Toggle` "violation":** the initial audit flagged `settings/messages.web`'s
custom `Toggle` as a Law-2 violation (should be `@dvnt/ui` `Switch`). This was a **false
positive.** Every web screen in the repo (`notifications.web`, `privacy.web`,
`likes-comments.web`, `create-post.web`, `room.web`, …) uses a custom HTML
`role="switch"` toggle, and **zero** import `Switch` from `@dvnt/ui`. The kit `Switch`
is a react-native `Pressable` with NativeWind classes; these web screens deliberately
run with **NativeWind interop off** (raw HTML — Law 3). Swapping it in would break
styling and violate the web convention. Left as-is by design.

**On the broader "@dvnt/ui substitution" requirement:** the prompt assumed native
screens render directly on web (so raw `react-native` `Text` would render wrong). They
do not — each screen has a dedicated `.web.tsx` that metro/webpack resolves on web. Web
correctness is achieved by the platform split, not by kit substitution in the native
file. The new verifier **REAL-WEB CHECK** asserts each web screen has **zero**
`react-native` imports, locking this in.

### Sneaky Lynk — room (`room.web.tsx` ← `(protected)/sneaky-lynk/room/[id].tsx`)

Deep-ported this pass. All wired to the **same** shared stores / Supabase channels /
edge fns the native room uses (no forked data layer):

| Feature | Status | Wiring |
|---|---|---|
| Join + media (mic/cam), pre-join anon gate, leave/end | ✅ | `sneakyLynkApi.joinRoom/leaveRoom/endRoom`, Fishjam web SDK |
| Speaker/video stage + listener row (virtualized) | ✅ | `usePeers`, TanStack Virtual |
| Raise hand (self) | ✅ | `sneakyLynkApi.toggleHand` + `useRoomStore` |
| **Room chat** | 🔧 | side-panel ← `fetchRoomComments` + `subscribeToRoomComments` + `postRoomComment` (native ChatSheet's exact data layer), optimistic send |
| **Reactions** (bar + floating overlay) | 🔧 | `useRoomReactions` (shared broadcast channel) |
| **Hand-queue moderation** (host, FIFO) | 🔧 | `useRoomStore.raisedHandOrder` fed by `videoApi.subscribeToMembers`; promote via `videoApi.changeRole` |
| **Participants panel** (mute / promote / remove) | 🔧 | `videoApi.mutePeer` / `changeRole` / `kickUser`; mute-all via `videoApi.muteAll` |
| **Connection banner** | 🔧 | Fishjam `peerStatus` → web banner |
| **Free-host timer + duration paywall** | 🔧 | `sneaky_subscriptions` lookup → 5-min `WebRoomTimer`; time-up dialog routes to `/feed/sneaky-lynk/billing` (the existing web checkout) |
| **Eject** (kicked / banned / room ended) | 🔧 | `videoApi.subscribeToRoomEvents` → eject banner → leave |
| Screen-capture protection / broadcast | ⚪ | native-only (no web screen-capture API); intentionally skipped |

Web presentation (Law 3): native bottom-sheets (ChatSheet / HandQueueSheet /
RoomParticipantsSheet / EjectModal / SneakySubscriptionModal) become web **side-panels
and dialogs**; RTC video uses the imperative `<video>` `VideoTile` (web) vs native
`RTCView`. The 20 RN components in `src/sneaky-lynk/ui/` stay native-only by design —
web reimplements the same behavior over the shared stores, exactly as `chat.web.tsx`
reimplements the native ChatSheet.

### Sneaky Lynk — create / billing

| Screen | Status |
|---|---|
| `create.web.tsx` (title/topic/video/public, invite search, create) | ✅ real, full parity |
| `billing.web.tsx` (subscription read, realtime, portal + checkout) | ✅ real, full parity |

---

## Verification

- `pnpm verify:parity` → **exit 0**. 111/111 routes ported · 0 data-wiring diffs ·
  0 web-data-parity failures · **REAL-WEB CHECK** (new, Prompt 14) green for all 8
  messages+lynk web screens (no fallbacks, no `react-native` imports, no thin shells).
- `turbo typecheck` → **13/13** tasks successful (incl. `apps/web`, `mobile`).
- Verifier extended (`scripts/verify-port-parity.mjs`): added section 6 REAL-WEB CHECK;
  cleared the now-paid `sneaky-lynk/room.web.tsx` `useRoomReactions` debt.

### Accepted deferrals (justified, itemized in the verifier debt ledger)

1. `chat.web` media lightbox (`useFeedPostUIStore`) — web uses `window.open`; native
   uses Galeria. Web adaptation, not a missing feature.
2. `messages.web` Lynk-tab local history (`useLynkHistoryStore`/`chat-store`) — web
   fetches live rooms on demand. Web adaptation.

These do not fail the gate and represent presentation differences, not dropped
functionality.
