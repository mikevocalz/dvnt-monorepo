# Game Night Rive HUD brief

This is the authored-motion contract for the Game Night score rail, leaderboard,
match-result panel and primary game buttons.

The React surfaces already expose the state needed by the animation. The final
`.riv` file should replace decorative motion only; semantic text, button
actions, keyboard focus and server-authoritative game state stay in React.

## Runtime target

Use the current Rive runtime generation when the authored asset lands:

- Web: Rive React v4.36.x with the WebGL2 renderer for the richest renderer
  feature set.
- Native: Rive React Native v0.5.x, after validating it against DVNT's pinned
  React Native / Nitro versions in a device branch.
- Generate typed schemas for the final `.riv` file before wiring native inputs.

Do not add a Rive dependency until the `.riv` binary exists and the pnpm
lockfile can be updated in the same change. A package-only change would make
frozen-lockfile installs red without shipping any visible animation.

## Asset

Planned path: `/rive/game-night-hud.riv`

Artboards:

1. `Score HUD`
2. `Leaderboard`
3. `Game Button`
4. `Match Result`

State machine: `DVNT HUD`

The canonical input names live in
`packages/app/features/game-night/motion/rive-hud-contract.ts`.

## Visual direction

- Near-black base; violet/purple energy, not generic casino green.
- Warm gold is reserved for first place, winner and the highest-value score.
- Score changes should feel like a physical counter settling, not a slot
  machine.
- The winning state may bloom/glow once, then settle to an idle loop.
- Buttons get a quick press compression + sheen response. No permanent looping
  on ordinary controls.
- Leaderboard row movement should interpolate rank changes rather than hard
  cut.
- Motion must survive narrow phone widths and scale with the existing
  responsive card-table layout.

## State-machine behavior

### Score HUD

Inputs: `score`, `targetScore`, `rank`, `playerCount`, `isLeader`,
`isWinner`, `isMe`.

- Score number rolls only when the numeric value changes.
- Progress line maps `score / targetScore`.
- `isLeader` enables the crown treatment.
- `isWinner` fires the one-shot gold celebration.
- `isMe` keeps a purple identity ring even when the player is not leading.

### Leaderboard

Reuse the score identity language. Rank 1 = gold, 2 = silver/white, 3 = bronze,
remaining rows = purple/neutral. The React list remains the accessibility tree;
Rive should decorate or animate, not replace readable standings.

### Game Button

Inputs: `disabled`, `pressed`, `ctaKind`.

`ctaKind` values:

- 0 primary
- 1 secondary
- 2 danger
- 3 ghost

The React `button` remains the actual hit target.

### Match Result

Inputs: `isWinner` and the same score/rank values used by the score HUD.
Winner celebration is one-shot and should respect reduced motion.

## Accessibility and fallback

- `prefers-reduced-motion`: no celebration loop, rank sliding or idle camera
  motion. Values may crossfade/snap.
- Rive failure must never hide a score, leaderboard entry, or CTA.
- Rive canvas is decorative unless a future interaction explicitly adds an
  accessible DOM/RN equivalent.
- Never make the Rive state machine the source of truth for points, rank, game
  phase or button availability.

## Mobbin benchmark set

Use these as shipped-product references during visual review. They are not
templates to clone; they are a sanity check on hierarchy, ranking density,
live/social discovery and result-state clarity.

Discovery / live-social:
- Azar: https://mobbin.com/screens/4e12dc6b-0451-4cd8-b6bb-86ab0709d4ce
- Yubo: https://mobbin.com/screens/4f06f8d7-5575-4fc6-93fe-8b3041120436
- Twitch: https://mobbin.com/screens/b499a80c-089d-4355-a203-97f96a21b13e
- Twitch Search flow: https://mobbin.com/flows/da6876d8-4ef3-44a1-af56-36e7f6a817b4
- Twitch Stream detail flow: https://mobbin.com/flows/4bb5108b-1a03-4a48-919f-36304102a1c7

Leaderboard / rank:
- Duolingo: https://mobbin.com/screens/3ca570fe-9e97-4e65-85eb-3e544a7eacab
- Mimo: https://mobbin.com/screens/80bf7a7f-9251-454f-8a73-045dab21b334
- Uxcel Go: https://mobbin.com/screens/8baf7fae-7014-4821-bc86-766c38f3635d

Result / completion:
- Quizlet: https://mobbin.com/screens/22670919-b826-45b1-94f7-0f29d33a45ef
- Duolingo: https://mobbin.com/screens/53b4c9d8-be76-4f1b-90de-8dc2fcb525f7
- Yubo: https://mobbin.com/screens/71059bf5-887f-4332-b42d-4c06da54c2cf

The actual DVNT implementation should keep its own black/violet/gold system,
square/rounded avatar conventions where already established, and the existing
server-authoritative game model.
