# G0 typography decision — BC Barell

The printed deck sets display type in **BC Barell Extended Black** and body
type in **BC Barell Regular** (embedded subsets in `Deckpdf.pdf`; the licence
for app embedding is unconfirmed).

Until Mike confirms an app-embedding licence and supplies the font files, card
faces render in the repo-licensed SpaceGrotesk family:

- `SpaceGrotesk-Bold` — display (`KEEP IT 100`, `THE COOKOUT`, `PROMPT:`,
  question body)
- `SpaceGrotesk-SemiBold` — labels, options, captions
- `SpaceGrotesk-Regular` — long body copy

Sizes derive from the printed card (header ~5 % of card height, body ~6–7 %,
labels ~4 %) and are defined once in
`packages/app/features/game-night/decks/blue-100-the-cookout/theme.ts`.

Swap path: drop the licensed Barell files into `apps/web/public/fonts` +
`apps/mobile` font loading, register `BCBarellExtended-Black` /
`BCBarell-Regular`, and point `COOKOUT_THEME.fonts` at them — no layout code
changes.
