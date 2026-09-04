# Sneaky Lynk web room → MoQ migration

Status 2026-09-04: **DONE**. `features/sneaky-lynk/screens/room.web.tsx` — the
Sneaky Lynk product room, the surface `/feed/sneaky-lynk/room/[id]` renders — is
on MoQ. The native product room is MoQ on this same branch
(`ws3b-lynk-moq-product-screens`, still awaiting a device test).

Still on Fishjam, and NOT in this change: `features/video/video-room.web.tsx`
(a parallel web port of the same native room, served at `/video/room/[id]`) and
`features/call/call.web.tsx` (1:1 calls). The video-room twin is the next
candidate — decide whether to port it or retire the route, since it duplicates a
screen that is now on a different transport.

## What moved

Media only. Join/leave, roles, ejection, host mute, chat, reactions, hand queue,
capture protection and billing are Supabase and are untouched.

| Was (`@fishjam-cloud/react-client`)      | Is                                              |
| ---------------------------------------- | ----------------------------------------------- |
| `FishjamProvider` wrapper                | none — the MoQ hooks own their session          |
| `useConnection` (join/leave/peerStatus)  | `useLynkBroadcast(id, canPublish)` + `.end()`   |
| `useCamera` / `useMicrophone`            | `lynk.setCameraEnabled` / `setMicEnabled`       |
| `usePeers().remotePeers` + metadata      | roster × `lynk.coPublishers`, joined on peer id |
| `peer.cameraTrack` → `<video>`           | `attachCanvas(path, el)` → `<canvas>`           |
| `useVAD`                                 | `useSpeakingDetection` + `useSpeakingPresence`  |
| `peerStatus` → session machine           | `lynk.state` → `TRANSPORT_STATUS_BY_LYNK_STATE` |

## The three decisions worth knowing

**Identity.** A MoQ path (`lynk/<roomId>/<peerId>`) carries no metadata, so a
remote tile is a Supabase roster row joined to a discovered publisher on the peer
id. `peerIdForMember` (`features/video/lynk-participants.ts`) is in LOCKSTEP with
`peerIdFor` in the `lynk-moq-token` edge function — drift is silent, so change
both in the same PR.

**Voice activity.** MoQ carries no VAD, and `@moq/watch` exposes no analyser on a
remote publisher's decoded audio, so a remote ring cannot be measured locally.
The direction that works is the one every client already has: measure your OWN
microphone (`useSpeakingDetection`, RMS + hysteresis on `react-native-audio-api`)
and broadcast the boolean on the room's existing Supabase channel
(`useSpeakingPresence`) — the same mechanism as `useRoomReactions`, so no new
dependency and no server work. Sends are edge-triggered: one message when you
start talking, one when you stop. The merge rule is pure and tested
(`lib/lynk/speaking-presence.test.ts`).

**Remote tiles always mount their canvas.** Mounting the canvas is what
subscribes to a publisher — audio included — so it is never conditional on
knowing whether their camera is on. The avatar sits BEHIND the canvas and shows
through, because an untouched canvas is transparent. That also sidesteps the
fact that web MoQ discovery announces a path, not a track list. The path and the
attach function are passed to `StageTile` separately and memoized into one ref
there: `attachCanvas(path, null)` closes the subscription, so a ref that changed
identity every render would tear the stream down on every chat keystroke.

## Fixed on the way through (both platforms)

- **Listeners were stuck at "Connecting…" forever.** `canPublish` false means no
  publish token is requested, so `deriveLynkState({ hasToken: false })` sat at
  `requesting-token` permanently. Both `useLynkBroadcast` hooks now report the
  composed viewer's state for a non-publisher, which is the connection they
  actually have. This also affected the native room on this branch.
- **The web hook opened the camera on mount**, regardless of role, so a listener
  in an audio-only room got a camera permission prompt for a device they can
  never publish. The sources are now constructed disabled and one effect drives
  `enabled = flag && !ended && canPublish` — the rule the native hook already had.
- **The room phase no longer gates on media.** Being in the room is a Supabase
  fact; a listener whose room has nobody on air yet had a working roster and chat
  behind a full-screen spinner. Transport health is `ConnectionBanner`'s job.

## Known gaps (deliberate)

- A remote tile's camera/mic badges read "on" for any publisher: web MoQ
  discovery gives no track list. The speaking ring is the signal that is real.
  If the muted badge lies too often, broadcast mic state on the `speaking`
  channel — it is the same shape.
- A client that vanishes mid-word leaves its last `speaking: true` behind until
  the roster drops the member (which removes the tile with it). Add a TTL +
  heartbeat if it ever reads as stuck.
- Screen share: no room publishes one yet, on either platform.

## Verified

`tsc --noEmit` clean on `packages/app`, `packages/ui`, `apps/web`;
`pnpm --filter web build` green; `node --test` on the speaking-detection and
speaking-presence units. **Not yet run against a live relay with two clients** —
that is the remaining check, same as the native leg.
