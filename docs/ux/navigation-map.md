# Navigation map — drawer, tabs, ticket routes

Branch `events-tickets-drawer-premium`, 2026-09-08.

## Ticket routes

`/ticket/:id` accepts both shapes, disambiguated by type. `tickets.id` is
`uuid`, `events.id` is `integer` (`migrations/20260313_catchup_all.sql:88-90`),
so nothing had to be renamed and no existing link broke.

| Param | Meaning | Resolves to |
|---|---|---|
| uuid | canonical — one credential | that ticket, plus its group for the "Ticket N of M" switcher |
| integer | event id (legacy links) | the event's group; opens a pass only when the group holds exactly one, otherwise a chooser |
| anything else | invalid | not-found, never a substitute pass |

Legacy producers left working unchanged: `dvnt://ticket/<event_id>` from
`features/watch/watch-notification-actions.ts:138`,
`features/ticket/helpers/add-to-calendar.ts:156`,
`lib/calendar/cart-ticket-calendar.ts:139`.

Updated to emit ticket ids: `events/my-tickets.tsx`,
`checkout/success.tsx`, `features/events/my-tickets.web.tsx:323`,
`features/events/checkout-success.web.tsx:142`, `debug/transitions.tsx`.

`ticket/upgrade/[id]` now resolves the same way. An upgrade is a charge against
one ticket; taking "the first ticket for this event" could have billed an
upgrade onto a different pass than the one on screen.

## Drawer

Left-side panel over the protected Stack. Trigger is a visible menu button in
the tab header — the edge swipe is an accelerant, never the only way in.

```
Identity        avatar · name · @handle          → Profile
Next event      only with an eligible pass       → that ticket, or the event's group

My Tickets      "2 events · 3 passes"            → /(protected)/events/my-tickets
Orders & receipts                                → /settings/purchases
Sneaky Lynk     "Private rooms"                  → /(protected)/sneaky-lynk

HOSTING         only when the server says so
Host dashboard  "Guests, check-in, payouts"      → /(protected)/events/host

ACCOUNT
Membership                                       → /settings/membership
Settings & privacy                               → /settings
Help & support                                   → /settings/faq
```

Hosting is gated on `getHostDashboard()` returning at least one manageable
event — a server-resolved capability, not a client comparison of `user.id`
against `event.host_id`.

### Rows the brief asked for that are not shipped

Recorded in `features/navigation/drawer-destinations.ts` as
`STRUCK_DESTINATIONS` so the next person starts from the blocker.

| Row | Disposition | Blocker |
|---|---|---|
| Saved | DEFER | `bookmarks` is post-only (`bookmarks.post_id`; `get-bookmarks/index.ts:59-60`) and already renders in the Profile tab. Saved *events* are a different read path (`qk.events.liked`). "Events and posts inside" needs a merged read path that does not exist — the blocker is that decision, not a missing screen. |
| Scan tickets | DEFER | The scanner is `events/[id]/scanner`, which needs an event id. A top-level row needs a "which event am I working tonight" resolver keyed on event-scoped staff roles. Reachable today via Host dashboard → event. |
| Blog / editorial | DEFER | Web-only (`apps/web/src/app/(frontend)/(marketing)/blog`). No native route, so a native row would open a browser — a product call, not a navigation gap. |

### Gesture ownership

The drawer's edge swipe yields to any screen that owns the horizontal gesture:
checkout, scanner, stories, camera, calls, Lynk rooms, crop, chat, comments,
and every editor (`drawerGestureEnabled`, tested). The drawer itself is only
offered from top-level surfaces — a pushed screen already uses that corner for
back.

Dismiss: scrim tap, row tap, Android hardware back, web Escape, edge swipe.
Rows close the drawer before navigating, so two surfaces never animate at once.

### Why `react-native-drawer-layout`, not the bundled `Drawer`

`expo-router/drawer` is a route layout. Adopting it would mean restructuring
`(protected)` and pushing `(tabs)` down a level, which breaks every
`/(protected)/(tabs)/...` path, every deep link, and the TransitionStack's
shared-element screen names.

`react-native-drawer-layout@4.2.5` is the layout that
`@react-navigation/drawer` — and therefore the bundled `Drawer` — is built on,
and it was already resolved through expo-router. As a controlled component it
wraps the existing Stack as `children`, so the Stack's element identity is
stable across open/close: opening the drawer cannot remount the feed, reset
scroll, drop a call, or duplicate a query. One NavigationContainer, still
expo-router's. §8 of the brief permits "its supported underlying layout"; this
is that.

Now declared explicitly in `apps/mobile/package.json` and
`packages/app/package.json` at the version already in the lockfile, rather than
relying on a transitive hoist.

## Tabs — unchanged this pass

Still **Home · Events · Create · Activity · Profile**.

The brief specifies renaming Activity to Inbox and moving Activity to a header
button. **DEFERRED**, for a reason the brief itself supplies: it says to treat
the IA as "a hypothesis to validate against real journeys and available
analytics", and there are no analytics in this repo to validate it with — zero
posthog/mixpanel/amplitude, confirmed in
`docs/ux/prompt-ground-truth-reconciliation.md`. Renaming a tab in a shipped
app costs every existing member their muscle memory, and nothing here can tell
us whether it buys anything.

The §18 acceptance targets do not depend on it: "My Tickets in two taps from
any root screen" is met by the drawer, and prominent ticket access is met by
the drawer's first row. Revisit when there is a way to measure.

An Activity header button was deliberately *not* added alongside the Activity
tab — one destination, one affordance.
