# Lynk · MoQ Livestream Fit (PROMPT 6 — Step 0 audit)

**Status: AS-IS captured · transport RESOLVED (Fishjam MoQ, see §6) · role model
DECIDED (multi-speaker, see §5.2) · mobile native client = gated spike.**
Source of truth: `../deviant`. Verifier: `pnpm verify:parity`. This doc is the
mandated Step-0 gate — no MoQ media code lands until the §6 fork is decided.

Sneaky Lynk is **not greenfield**. It is a shipped, branded feature ("Private
Lynk") with a full room/membership/privacy model, billing, screens, stores,
navigation, deep-links, notifications and marketing chrome. PROMPT 6 is a
**media-transport migration of an existing feature**, not a new build. The media
layer underneath is the *only* thing changing; everything that encodes
host/viewer/invite/privacy semantics is reused.

---

## 1. What Lynk already is (as-is)

There are **two layers** under the "Sneaky Lynk" / "Private Lynk" name:

| Layer | Where | What it is |
|---|---|---|
| **Product / room model** | `packages/app/features/sneaky-lynk/` (create, billing, room + web stores), `lib/branding/lynk-branding.ts`, `lib/subscription/*`, routes `(protected)/sneaky-lynk/**` | "Private Lynk": invite-gated live rooms with optional video, subscription-tiered (free 5-min/5-ppl → paid). `getLynkDisplayName() → "Private Lynk"`. |
| **Media engine** | `packages/app/src/sneaky-lynk/` (ui, hooks, `rtc/fishjamClient.ts`, `api/supabase.ts`, types, stores), `src/video/hooks/useVideoRoom.ts`, `features/call/video-room.web.tsx` | Twitter-Spaces-style host/co-host/moderator/speaker/listener rooms. Built on Fishjam WebRTC. **The `rtc/fishjamClient.ts` is still a MOCK** (`// TODO: Replace with actual @fishjam-cloud/react-native-client`); web `video-room.web.tsx` wires real `@fishjam-cloud/react-client` hooks. |

User-facing identity: branding has consolidated to **"Private Lynk"** in-app
(landing/marketing still says "Sneaky Link — anonymous video calling"). Avatars
are rounded squares everywhere (never circular).

### Backend / data model (KEEP — unchanged by MoQ)

Tables (`../deviant/supabase/migrations/`): `video_rooms` (uuid, created_by,
is_public, has_video, status open|closed|ended, fishjam_room_id,
sweet_spicy_mode, participant_count), `video_room_members` (role
**host|co-host|moderator|speaker|participant**, status active|left|kicked|banned,
hand_raised, is_anonymous/anon_label), `video_room_invites`, `video_room_tokens`
(jti + revoked_at — revocation tracking), `video_room_bans/kicks/events`,
`room_comments`, `sneaky_usage_tracking`, `sneaky_subscriptions` /
`membership_subscriptions`.

**Privacy model (already exactly what PROMPT 6 wants for private rooms):**
private room join is allowed only for host / co-host / prior member (non-kicked,
non-banned) / row in `video_room_invites`. Enforced server-side in
`video_join_room`. Public rooms (`is_public=true`) also exist — see §5 tension.

**Two-tier token pattern (the seam MoQ must mirror)** —
`../deviant/supabase/functions/video_join_room/index.ts`:
1. Read Better Auth session from `session` table by bearer JWT; check `expiresAt`.
2. Authorize against room membership / invite / ban (privacy gate above).
3. Mint a short-lived **Fishjam peer token** via raw `fetch` POST to
   `https://fishjam.io/api/v1/connect/${FISHJAM_APP_ID}/room/${id}/peer` with
   `Authorization: Bearer ${FISHJAM_API_KEY}` (the management key — **server only**).
   > Note: there is **no `@fishjam-cloud/js-server-sdk`** in the repo; the
   > existing backend uses raw REST. Record token jti in `video_room_tokens`.
4. Response shape: `{ ok:true, data:{ token, peer:{id,role}, room, user, expiresAt } }`.

Refresh (`video_refresh_token`) revokes prior active tokens, re-mints, returns
same shape. Kick/ban/end revoke tokens + delete Fishjam peer/room.

### Roles → publish/subscribe (today vs PROMPT 6 broadcast model)

| Role (today) | Can publish media today | PROMPT 6 MoQ broadcast role |
|---|---|---|
| host | yes | **publisher** (`host` path) |
| co-host | yes | **publisher** (`cohost` path) |
| moderator | no | viewer (subscribe) |
| speaker | yes (Spaces model) | **viewer** in broadcast model — see §5 |
| participant/listener | no | viewer (subscribe) |

### Shared seams to REUSE

- **`@dvnt/network apiFetch`** (`packages/network/src/client.{web,native}.ts`):
  web `credentials:"include"` + 401→`tokenRefresh()`→retry; native nitro/fetch
  with same retry. Better Auth JWT attached. MoQ token fetch goes through this.
- **VideoTile** — **does NOT yet exist at the prompt's path** `packages/ui/src/video/`.
  Today there are 3 divergent tiles: `src/video/ui/VideoTile.tsx`
  `{participant,isLarge?,onPress?,onLongPress?}`; `src/sneaky-lynk/ui/VideoTile.tsx`
  `{participant,isSpeaking,tileWidth,tileHeight,isHost,onPress?}`; and an inline
  web `{stream,muted,mirror?,className}` in `features/call/call.web.tsx`.
  **A shared `packages/ui/src/video/VideoTile.{tsx,web,native}` is net-new** and
  must be reconciled to one contract (add a `MediaStream | canvasRef` source +
  `mirror?/objectFit?/className?`).
- **Config:** `EXPO_PUBLIC_FISHJAM_APP_ID` (default `28026441819941d78c40584fb830f851`),
  server `FISHJAM_APP_ID`/`FISHJAM_API_KEY`. `../deviant/.env` canonical.
- **Entry points / nav / deep-links / privacy** (all KEEP): Messages 3rd tab
  "Private Lynk"; routes `(protected)/sneaky-lynk/{create,billing,room/[id]}`;
  share `https://dvntapp.live/sl/{roomId}` (+ `/sneaky-lynk/room/:id`, `/sneaky/:id`),
  all auth-required; activity/notification types `sneaky_lynk`|`room_invite`;
  legacy `(video)/rooms`→redirect.

---

## 2. Keep / adapt / replace ledger

| Artifact | Verdict | Reason |
|---|---|---|
| `video_rooms`/`members`/`invites`/`bans`/`kicks`/`events` schema + RLS | **KEEP** | Room/membership/privacy model is the feature's identity. MoQ swaps transport only. |
| `video_room_tokens` (jti/revoked_at) | **KEEP** | Token revocation model carries over to streamer/viewer or publish/subscribe tokens. |
| Privacy gate in `video_join_room` | **KEEP, REUSE** | Same authorization logic feeds the new MoQ/livestream token endpoint. |
| Two-tier token mint (raw REST, mgmt key server-side) | **ADAPT** | New endpoint `lynk/moq-token` (or `lynk/livestream-token`) mints a role-scoped token (publish vs subscribe / streamer vs viewer) but mirrors the exact auth+shape. |
| `rtc/fishjamClient.ts` (MOCK) | **REPLACE** | Becomes the real transport client behind the hooks. Never ships as mock. |
| `useSneakyLynkRoom` / `useVideoRoom` peer-sync | **ADAPT** | Keep participants/store shape + state machine; swap peer/track source for the few→many publisher discovery. |
| `useRoomEvents` (Supabase realtime: eject/end/hand/role/comments/viewer presence) | **KEEP** | Moderation/presence are transport-independent. Viewer count + presence stay Supabase-driven. |
| UI: `RoomStage`/`SpeakerGrid`/`ListenerGrid`/`VideoStage`/`ControlsBar`/`HandQueueSheet`/capture-protection | **KEEP** | Layout/role/anim/privacy chrome are transport-agnostic; tiles just take a new media source. |
| `room-ui-store` (web: phase, isMicOn/isCameraOn), shared `room-store` | **ADAPT** | Map to MoQ `enabled` toggles + new `lynkState` machine; do **not** create a parallel store. |
| create/billing/entitlements/branding/nav/deep-links/notifications | **KEEP** | No media coupling. |
| 3 divergent `VideoTile`s | **REPLACE → consolidate** | One shared `packages/ui/src/video/VideoTile.{tsx,web,native}` taking a transport-neutral source. |
| New `packages/app/lib/lynk/{useMoqToken,useLynkBroadcast,useLynkViewer,lynkState}.ts` | **NET-NEW (justified)** | These EXTEND/REPLACE the specific media hooks above — they are the universal seam, not a second parallel Lynk. `lynkState`: idle→requesting-token→connecting→live→reconnecting→ended→error. |

No net-new file may stand beside an existing one that already encodes
host/viewer/invite semantics — the new hooks replace the media internals of the
existing hooks, screens reuse the existing room model.

---

## 3. Topology (agreed shape, transport-independent)

- Host + optional cohost = publishers; room of viewers = subscribers (few→many).
- Role → path/token is **single-purpose** (a viewer token can never publish):
  - host → publish `lynk/${roomId}/host`
  - cohost → publish `lynk/${roomId}/cohost`
  - viewer → subscribe `lynk/${roomId}` (namespace; discovers both publishers)
- Viewers discover publishers reactively (announced set / stream-id list) and
  mount one tile per live publisher — 1 when only host, 2 when cohost joins, with
  no reload. Server authorizes the single cohost publish slot on promotion.

---

## 4. Platform reality (depends on §6)

- **Pure MoQ path:** web = `@moq/publish` (camera/mic → `Publish.Broadcast`) +
  `@moq/watch` `Watch.MultiBackend` decoding via **WebCodecs → `<canvas>`**.
  **Native has no first-party MoQ client** → gated spike required (WebView-hosted
  `@moq` player most likely v1 viewer path; native QUIC+WebCodecs module is the
  long-term answer). Host/cohost-from-mobile likely **web-first** in v1; mobile
  viewer-first. This is the prompt's "hard part" — and it is real on this path.
- **Fishjam Livestream path:** `useLivestreamViewer` returns a **plain
  `MediaStream`** → mounts in `<video>` (web) / `RTCView` (native) with **no
  canvas/WebCodecs/WebView spike**. Native publish + view both work today via the
  already-installed `@fishjam-cloud/react-native-client`. The "hard part"
  largely evaporates — at the cost of being WHIP/WHEP, not MoQ.

Either way the transport hides behind the **same VideoTile + `useLynkBroadcast`/
`useLynkViewer` seam**, so screens stay transport-agnostic.

---

## 5. Reconciliations the migration forces

1. **Public vs private.** PROMPT 6 says Lynk is strictly private (invite/DM-gated,
   no public discovery). The schema supports **both** `is_public` true/false and a
   public discovery list. In-app branding already reads "Private Lynk".
   **Decision:** MoQ broadcast targets the **private** room path first; public
   discovery is out of scope for this prompt (left as-is, not extended).
2. **Roles → publishers (DECIDED: keep multi-speaker Spaces semantics).** We do
   **not** cap publishers at host+1 cohost. Any role with publish rights today
   (host / co-host / moderator-as-promoted / speaker) gets a **publisher token**;
   participants/listeners get a **subscriber token**. This maps *more naturally*
   onto MoQ than a 2-publisher cap, because of prefix-scoped namespace discovery:
   - Each publisher publishes to its own sub-path: `lynk/${roomId}/${peerId}`
     (host/cohost/speaker alike). Token: `createMoqToken({ publishPath: "lynk/${roomId}/${peerId}" })`
     — *specific* path, so a speaker can only publish as itself.
   - Viewers subscribe to the room namespace: `createMoqToken({ subscribePath: "lynk/${roomId}" })`
     — *broad*, so `connection.announced` surfaces **every** live publisher and
     the viewer mounts one tile per announced path (1, 2, … N speakers) with no
     reload. "Promote listener → speaker" = server issues that user a publish
     token for `lynk/${roomId}/${peerId}` (existing `video_change_role` +
     hand-raise flow drives it).
   - A subscriber token can never publish (single-purpose, server-enforced).
3. **VideoTile consolidation** (3 contracts → 1 shared) is a prerequisite, not
   optional, and is shared with the calling feature.

---

## 7. Build status — what landed vs what needs a device/browser

**Landed + typechecks clean (0 TS errors across `@dvnt/app` and `@dvnt/ui`):**

| Piece | Path |
|---|---|
| Edge Function (createMoqToken, role-scoped, reuses video_join_room gate) | `apps/mobile/supabase/functions/lynk-moq-token/index.ts` |
| State machine | `packages/app/lib/lynk/lynkState.ts` |
| Token hook (intent-scoped, 1h refresh) | `packages/app/lib/lynk/useMoqToken.ts` |
| Shared hook contracts | `packages/app/lib/lynk/types.ts` |
| Signals→React bridge | `packages/app/lib/lynk/moq-signals-react.ts` |
| Broadcast hook (web: @moq/publish camera+mic) | `packages/app/lib/lynk/useLynkBroadcast.web.ts` |
| Viewer hook (web: Connection.Reload + announced discovery + per-path canvases) | `packages/app/lib/lynk/useLynkViewer.web.ts` |
| Native viewer (WebView token bridge) | `packages/app/lib/lynk/useLynkViewer.native.ts` |
| Native broadcast (honest web-first boundary) | `packages/app/lib/lynk/useLynkBroadcast.native.ts` |
| Shared VideoTile (canvas/stream/webview + avatar) | `packages/ui/src/video/VideoTile.{tsx,web,native}.tsx` |
| WebView MoQ player + JS-bridge contract | `packages/ui/src/video/moqPlayerHtml.ts` |
| Screens (broadcaster+viewer web / viewer native) | `packages/app/features/screens/(protected)/lynk/[roomId]/{web,native,index*}.tsx` |
| Native route | `apps/mobile/app/(protected)/lynk/[roomId].tsx` |
| Deps | `@moq/lite`, `@moq/publish`, `@moq/watch` in `@dvnt/app` |

**Deliberately NOT done (needs a device/browser or product sign-off — cannot be
faithfully verified in this environment, so not claimed):**
- **Real-device/browser topology proof** (host web + cohost web publishing,
  viewers on web AND a phone; cohost join/leave flips a tile via `announced` with
  no reload; path-scoped token cross-purpose rejection; expiry mid-stream re-auth;
  background/nav teardown; reconnect after a blip). The prompt's verification is
  explicitly device-gated.
- **Web-vite / Next route wiring** for `lynk/[roomId]` (no existing sneaky/lynk
  route was found under `apps/web-vite`; the web screen component is ready).
- **`FISHJAM_API_KEY` / `FISHJAM_APP_ID`** must be set in the Edge Function env;
  `@fishjam-cloud/js-server-sdk` resolves at deploy via the `npm:` specifier.
- **Replacing the existing Fishjam room's media internals.** To avoid
  destabilizing the shipped `sneaky-lynk/room/[id]` before device verification,
  the MoQ experience lands at the new `lynk/[roomId]` route; once verified, that
  route REPLACES the media layer of the existing room (per §2) rather than
  standing beside it permanently. Tracked, not forgotten.
- **Native publish** (host-from-phone) — web-first in v1 by design (§6.1).
- **`pnpm verify:parity` manifest rows** for the new route — pending the web
  route wiring above.

## 6. Transport — RESOLVED: Fishjam MoQ (the prompt is accurate)

An earlier draft of this doc wrongly called the prompt's stack fictional — that
was an error from incomplete search results that surfaced Fishjam's WHIP/WHEP
page but missed its dedicated **MoQ tutorial** (`/docs/tutorials/moq`) and
explanation (`/docs/explanation/moq-streaming`). Verified against those pages,
the prompt matches Fishjam's MoQ product essentially verbatim:

- **Client libs (installed):** `@moq/lite` + `@moq/publish` (publisher),
  `@moq/lite` + `@moq/watch` (subscriber); `@moq/watch/ui` + `@moq/watch/element`
  web components for pure-viewer embeds.
- **Server token:** `@fishjam-cloud/js-server-sdk` →
  `createMoqToken({ publishPath })` / `createMoqToken({ subscribePath })`
  (Deno edge import: `npm:@fishjam-cloud/js-server-sdk`).
- **Relay:** `https://relay.fishjam.io/${FISHJAM_ID}?jwt=${token}`. The
  `FISHJAM_ID` is the automatic root namespace — never included in paths.
- **API:** `Publish.Broadcast({ connection, name: Moq.Path.from(path), enabled, video, audio })`,
  `Watch.Broadcast(...)`, `Watch.MultiBackend({ element: canvas, broadcast })`,
  `connection.announced` (reactive Set of live publisher paths) for discovery.
- **Paths are prefix-scoped:** broad `publishPath: "lynk/${roomId}"` permits
  publishing sub-paths; broad `subscribePath: "lynk/${roomId}"` discovers all
  publishers in the namespace. We use **specific** publish paths per peer
  (`lynk/${roomId}/${peerId}`) + **broad** subscribe (`lynk/${roomId}`) — see §5.2.
- **Forbidden:** the sandbox flow `fetch(${SANDBOX_API_URL}/moq/${PATH}/publisher)`
  / `…/subscriber`. Production = `createMoqToken()` behind our authorization.

**Decision: build the prompt as written** — MoQ via Fishjam relay. Web is
fully supported now (WebCodecs → `<canvas>` via `Watch.MultiBackend`; publish via
`@moq/publish`).

### 6.1 Native transport — RESOLVED: Fishjam WHIP/WHEP livestream (true native)

`@moq/*` are browser-only (WebTransport + WebCodecs + canvas) and there is **no
native RN MoQ client**. The WebView-hosted `@moq` player works but is a webview.
The installed `@fishjam-cloud/react-native-client@0.27.0` ships first-party
`useLivestreamStreamer` / `useLivestreamViewer` that publish/return a **real
native `MediaStream`** rendered in `RTCView`. **Decision (user): native uses
Fishjam WHIP/WHEP livestream; web stays pure MoQ.** Same product (host/cohost/
speaker publish → many viewers, private, token-gated), two transports behind one
seam (`useLynkBroadcast`/`useLynkViewer` + `VideoTile`) — screens unchanged.

Reality of WHIP/WHEP that shaped the design: a Fishjam livestream room is **one
streamer → many viewers**, so multi-speaker = **one livestream room per
publisher**. We persist each publisher's livestream id on
`video_room_members.livestream_id` (migration `20260614000000_lynk_livestream_id`)
and a viewer gets a viewer token **per active publisher**, rendering one `RTCView`
tile each. Discovery is poll-based on native (the analogue of MoQ's reactive
`announced`); Supabase realtime on members is the enhancement.

Native pieces (typecheck clean): Edge Function
`apps/mobile/supabase/functions/lynk-livestream-token/` (`createRoom({roomType:
'livestream'})` + `createLivestreamStreamerToken`/`ViewerToken`, reusing the same
gate); `lib/lynk/livestreamToken.ts`; rewritten `useLynkBroadcast.native.ts`
(camera/mic + `useLivestreamStreamer`) and `useLynkViewer.native.ts` (poll +
per-publisher tokens); `LivestreamTile.native.tsx` (one `useLivestreamViewer` →
`VideoTile stream` → `RTCView`); `VideoTile.native` now renders `stream` via
`RTCView`; native screen wraps `FishjamProvider`.

The WebView `@moq` player (`moqPlayerHtml.ts`, `VideoTile.native` `moqViewer`
branch) is retained as the pure-MoQ-on-native fallback but is no longer the
default path. Native publish-from-phone is now **supported** (was web-first in the
prior draft). Token-response shapes differ by transport (MoQ: single scoped token;
livestream: per-publisher list) — both behind the hook seam, screens unaffected.
