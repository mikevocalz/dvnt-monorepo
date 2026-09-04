# Sneaky Lynk web room → MoQ migration plan

Status 2026-09-04. The web product room (`features/sneaky-lynk/screens/room.web.tsx`,
1,749 lines) is the ONLY Lynk surface still on Fishjam. Genesis rooms
(`/feed/lynk/[roomId]`) are MoQ on both platforms; the native product room is MoQ
on branch `ws3b-lynk-moq-product-screens` (unmerged, needs a dev build).

## What the web room uses from Fishjam (all direct, no adapter)
`@fishjam-cloud/react-client`: `FishjamProvider`, `useConnection`
(join/leave/`peerStatus`), `useCamera`, `useMicrophone`, `usePeers`
(`remotePeers` with `.cameraTrack`/`.microphoneTrack`/`.metadata`), **`useVAD`**.
Session machine is fed from `peerStatus`; participant tiles read `peer.cameraTrack`.

## What the web MoQ hooks already provide (proven in the genesis room)
`lib/lynk/useLynkBroadcast.web.ts` + `useLynkViewer.web.ts`:
`goLive`, `cameraEnabled`/`micEnabled` + setters, `localStream` (MediaStream for
the local `<video>`), `coPublishers` (discovery-driven), `attachCanvas(path, el)`
for remote tiles, and a `deriveLynkState` machine. Identity comes from the
Supabase roster joined on peer id (mirrors native `lynk-participants.ts`).

## The mechanical part (doable)
- Drop `FishjamProvider`; the MoQ hooks own their own session.
- `useConnection`/`useCamera`/`useMicrophone` → `useLynkBroadcast(id, canPublish)`.
- `peers.remotePeers` (+ metadata) → roster × `coPublishers` join, same shape as
  the native `mergeParticipants`.
- Tiles: `peer.cameraTrack` → `attachCanvas` for remote, `localStream` for self.
- Session machine: `peerStatus` → `deriveLynkState` (already the genesis pattern).

## VAD — SOLVED (was mis-flagged as a blocker)
MoQ carries no `useVAD`, but it doesn't need to — the audio is right here, so
speaking detection is a client-side RMS computation, not a missing feature:
- **Web**: `lib/lynk/useSpeakingDetection.web.ts` (built + tested) — a Web Audio
  `AnalyserNode` on any MediaStream (the local capture, or a remote publisher's
  decoded audio), RMS + hysteresis so a ring doesn't flicker between words. Zero
  new deps.
- **Native**: `react-native-moq`'s `useAudioChunks({ format: 'pcm-f32' })`
  delivers decoded PCM per publisher → same RMS. Zero new deps. (`react-native-
  audio-api` is the native `AnalyserNode` analog but is not needed and not
  installed.)
The pure decision (`decideSpeaking`) has a node:test covering threshold, the
hang window, and word-gap anti-flicker.

## Recommendation
Given the web room is 1,749 lines of direct Fishjam coupling AND the VAD gap,
the cheaper path may be **convergence**: the genesis web room
(`/feed/lynk/[roomId]/web.tsx`) already runs the MoQ web experience. Evaluate
making it the canonical product room and retiring `room.web.tsx`, rather than
porting 1,749 lines. That is a bigger product/routing decision (the product room
has host-mute, eject, hand-queue, capture-protection, billing timer the genesis
room may not) — so it needs a deliberate comparison, not a blind rewrite.

## Not started here — why
This is its own PR. Executing a 1,749-line rewrite of a LIVE web room with a
known feature-loss (VAD) inside an unrelated batch would be reckless. The plan +
the VAD decision come first.
