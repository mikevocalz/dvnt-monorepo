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
