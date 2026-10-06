# Game Night — Rive room reactions

This is the interaction layer for the Game Night room. It keeps the same social
energy as a live-room product while the card table remains the visual focus.

The transport already exists: reactions are normal `game_night_messages` rows
with `kind = 'reaction'`, realtime delivery, and the existing backend limit of
30 reactions per user per 60 seconds.

## Player-facing interaction

The reaction dock is always available to both seated players and watchers:

- ❤️ love
- 😂 laugh
- 🔥 fire
- 💀 dead
- 👀 eyes
- 💯 hundred

Tapping a reaction should feel instant locally. The reaction is emitted into
the room animation stream immediately, while the same emoji is sent to the
server so every other connected member sees the same event.

Remote reactions are driven by the realtime message insert, not by polling.

## Rive asset contract

Asset: `/rive/game-night-hud.riv`

Artboard: `Room Reactions`

State machine: `Room Reactions`

Inputs:

- `reactionKind` number
  - 0 love
  - 1 laugh
  - 2 fire
  - 3 dead
  - 4 eyes
  - 5 hundred
- `burst` trigger
- `isSelf` boolean
- `lane` number (0–2)
- `seatIndex` number (-1 watcher/unseated, 0–3 seated player)
- `intensity` number (1–3)

The JS contract lives in
`packages/app/features/game-night/motion/room-reactions.ts` and
`rive-hud-contract.ts`.

## Motion behavior

All reactions are one-shot animations. None should idle-loop after the burst.

- **Love** — elastic heart pop, short violet/gold particle trail, float upward.
- **Laugh** — quick squash/stretch and side wobble, two tiny tear accents.
- **Fire** — upward flame lick with a brief purple-hot core, then dissipate.
- **Dead** — skull pop with a tiny overshoot and one shake, then drift away.
- **Eyes** — peek in, widen, small lateral glance, fade.
- **Hundred** — stamp/slam in, gold spark edge, then rise slightly and dissolve.

`isSelf` may add a thin DVNT violet ring so the sender gets immediate feedback.
Do not make self reactions visually louder than remote reactions after the
first 150–200 ms.

`seatIndex` should choose the launch origin when the sender is seated:
reaction motion begins near that seat/avatar and curves into a safe side lane.
Watchers (`seatIndex = -1`) launch from the room/spectator rail instead.

## Safe areas

Reaction particles must never cover:

- the active prompt text,
- the player's selectable hand,
- judge pick controls,
- the timer,
- accessibility focus rings.

The authored Rive composition should reserve a right-side vertical reaction
lane plus short seat-origin arcs. On narrow phones, collapse to two visual lanes
while keeping the numeric lane input unchanged.

At most ~7 reaction particles should be visible at once. New bursts may replace
the oldest visual particle; they must never queue long enough to replay stale
reactions after the social moment has passed.

## Reduced motion

With reduced motion enabled:

- no long upward travel,
- no wobble/shake,
- no continuous particles,
- show the reaction as a short 250–400 ms scale/fade near its origin.

The reaction is still sent and still appears in chat history.

## Fallback

The current web/native fallback already consumes the final event stream and
shows short-lived animated emoji. It exists so transport and UX can be tested
before the authored `.riv` binary lands.

Once the Rive asset/runtime adapter is added, replace only the visual renderer.
Do not change:

- backend reaction transport,
- event mapping,
- room membership rules,
- chat history,
- rate limits,
- game/scoring state.

## Mobbin benchmark set

These are interaction references for visual review only:

- Whatnot live screen: https://mobbin.com/screens/96f375a4-ec2f-4063-b65b-aaf1a6031f4a
- Weverse live screen: https://mobbin.com/screens/a7971332-55a7-4865-a533-bea8d0fc9326
- Azar live room: https://mobbin.com/screens/939b6b09-2a1c-442c-ad1f-d42de7172900
- YouTube live interaction: https://mobbin.com/screens/6f96f21c-16f6-4bb2-b8f4-54409146d1e5
- TikTok live/watch interaction: https://mobbin.com/screens/89f7f3a3-39b7-4b23-af1f-5f965b099082

Use them to judge density and immediacy, not to copy artwork or layout.
