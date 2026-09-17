# Game Night PROMPT 0 — entry points

Where the destination is reachable from, per platform and width, and why the
narrow-web case is answered with "nowhere" for now.

## What exists today

| Surface | File | Behaviour |
|---|---|---|
| Mobile drawer | `packages/app/features/navigation/app-drawer-host.tsx` | `Drawer` from `react-native-drawer-layout` wrapping the protected `Stack`; rows from `drawer-destinations.ts` |
| Web rail ≥1024 | `packages/app/components/app-shell.web.tsx:13` | rail expanded, labels shown (`expanded = width >= 1024`, `:88`) |
| Web rail ≥768 | `app-shell.web.tsx:14` | rail icon-only |
| Web <768 | `app-shell.web.tsx:15`, `:86` | **rail is not rendered at all** — the bottom `WebTabBar` takes over |
| `WebTabBar` | `web-tab-bar.web.tsx:19-33` | fixed 5 slots: Home, Events, (Create), Activity, Profile |
| `WebTopBar` | `web-top-bar.web.tsx` | **zero matches for "menu"** — there is no overflow menu to extend |

So on web below 768 there is no rail, no top-bar menu, and a tab bar whose five
slots are the app's primary navigation.

## Decision

**Mobile drawer:** a gated `"game-night"` row, rendered only when
`useFeatureAccess("game_night")` grants. Ordinary peer row — icon, label,
detail line — not a badge or a promoted card.

**Web ≥768:** a gated rail item, same position logic as the existing ones.

**Web <768: no entry point is rendered.** `/feed/game-night` resolves for an
allowlisted account that arrives by URL or invite link; nothing advertises it.

### Why not force one in

The three candidates and why they lose, for two accounts:

1. **A sixth `WebTabBar` slot.** The bar is a fixed five-slot primary nav
   (`web-tab-bar.web.tsx:19-33`). Adding a conditional sixth changes the slot
   arithmetic for every user on narrow web to serve two of them, and a party
   game is not peer to Home and Events.
2. **A row in the profile screen.** No layout risk, but it files a live game
   under account settings, which is where features go to not be found.
3. **Invent an overflow menu in `WebTopBar`.** The prompt forbids inventing a
   secondary menu, and rightly — a new navigation primitive built for a
   two-person alpha is a permanent surface with a temporary reason.

Nothing is lost: the allowlisted pair reach the room by link, which is how a
party game is actually started. When the allowlist widens, the row moves into an
overflow — see the references below, which is what the apps that outgrew a flat
rail did.

## References (Mobbin)

- [YouTube — iOS drawer](https://mobbin.com/screens/b005e9fd-a9fb-4b00-beaa-59a826264aa7) —
  "Gaming" and "Playables" sit as ordinary rows among Live, News, Sports.
  **Borrow:** a game destination does not need to announce itself; an icon and a
  label in the same rhythm as its neighbours is enough. **Reject:** YouTube's
  drawer is a directory of products; DVNT's is short and task-shaped, so the row
  belongs with destinations, not in a new "more from DVNT" group.
- [X — web rail](https://mobbin.com/screens/2f5725c8-aef0-4c57-b31c-13173382a96a) —
  a flat rail of icon+label rows ending in **More**. **Borrow:** the overflow
  row is the idiomatic home for secondary destinations once the primary list is
  full — that is the widening path. **Reject:** X's rail is ten items deep;
  DVNT's is seven and should stay legible.
- [Threads — web](https://mobbin.com/screens/0db0ea31-1837-4a35-98c8-dbb2d460b0e1) —
  same pattern, "More" pinned at the bottom under a short primary list.
  **Borrow:** confirmation that "More" is where a gated extra goes, not the
  primary rail, when it stops being for two people. **Reject:** the pinned
  composer treatment; DVNT already has its own Create affordance.
- [Circle — web](https://mobbin.com/screens/65a159ee-6b2f-4408-98e9-a1975d5ecf80) —
  grouped sidebar with section headers. **Reject wholesale:** sections are for a
  workspace with dozens of destinations; adding headers to a seven-row rail to
  place one gated item would be scaffolding for a single occupant.

## Tokens

The row reuses `drawer-theme.ts` for the drawer and the existing `NavRow` in
`app-shell.web.tsx:113` for the rail — no new colour, spacing or type value. The
icon is lucide `Gamepad2`, mapped through the existing
`ICONS: Record<DrawerRow["icon"], LucideIcon>` rather than imported at the call
site, so the registry stays the only place icons are resolved.

## Copy

- Label: **Game Night**
- Drawer detail line: **Party card game**

Not "Games", which implies a section with more than one; not "Beta", which
labels the member rather than the thing.

## Accessibility

- The row is a standard drawer/rail row and inherits their existing 44pt target
  and focus handling; nothing bespoke is introduced that would need its own
  audit.
- Denial is silent by design: a non-allowlisted account gets the app's
  `+not-found` behaviour, with no toast and no explanation. A screen reader
  therefore encounters a missing route, not a locked door, which is the intent —
  the feature's existence is not disclosed.
- The absence of a narrow-web entry point must not be communicated as an error
  state; there is simply no row.

## Status — DEFERRED 2026-09-17

Nothing in this document is built. Verified by sweep, not inferred: no
`/feed/game-night` route, no `useFeatureAccess` hook, no `game_night` gate, no
rail or drawer row, and no room or game-state tables under
`apps/mobile/supabase/migrations`. The only `game_night` identifier in the repo
is the event CATEGORY enum at `packages/app/lib/constants/event-categories.ts:18`
— unrelated to this feature.

The entry points are deferred rather than struck: the design above stands, and
what blocks it is a set of decisions, not a missing subsystem. They are the three
that `00-versions.md` leaves open under "Open questions, not assumptions":

1. Which `three` the monorepo pins — 0.171.0 installed, 0.184.0 in the
   reference, and `@types/three` at 0.184.1 describing APIs the runtime may not
   have.
2. Which `typegpu` line, given `@typegpu/three` and `@typegpu/react` are NOT
   INSTALLED and `@typegpu/react ≥ 0.11.2` imports `react-native-webgpu` under
   its current name.
3. Whether `react-native-webgpu` goes 0.8.2 → 0.10.2. APPLIED 2026-09-17,
   both manifests, pinned exact. Native remains unverified.

Multiplayer has no transport: `y-protocols` is absent and `yjs` is
transitive-only via Payload's `@lexical/yjs`, so no workspace package may import
it.

The deferral is recorded a second time at the nav site itself —
`packages/app/features/navigation/drawer-destinations.ts`, in the
`STRUCK_DESTINATIONS` block — so the next person to ask "why is there no Game
Night row" starts from the blocker instead of adding a row to nowhere.

**Order when it resumes:** close the three version questions first (they decide
what the table can be built with), then the `game_night` gate and the room
tables, then the Skia/Reanimated table, which `00-versions.md` names as the
guaranteed path. The rail and drawer rows land last, in the same change as the
route.

## Open

When the allowlist widens beyond two accounts, revisit the narrow-web case with
the "More" overflow pattern above rather than reopening the tab-bar question.
