# DVNT Design System — events + ticketing (web + native)

> Wave 1 deliverable for the UI/UX prompt. One source of truth both platforms
> consume: tokens live in `packages/app/lib/theme/` and feed NativeWind (native)
> + the web Tailwind/raw-tag layer. Same names, same scale, same semantics.
> **Grounded in the real codebase** — fonts installed in `apps/mobile/assets`,
> palette already used 1,800+× across `packages/app`/`apps/web` (cited below).

## Aesthetic thesis (one paragraph)

DVNT is **after-dark**. It's the walk up to the door of the right party — nightlife,
shows, culture, a little spicy, a little exclusive. The product's one job is to make
*seeing an event and grabbing a ticket* feel effortless and slightly illicit: the flyer
pulls you in, the **blurred faces of who's already inside** tease you past the velvet
rope, and the ticket in your wallet feels like a real stub you'd hand to a doorman. The
surface is near-black and quiet; the only thing that glows is the gradient — spent
deliberately on the few moments that matter (the price, the "going" ring, the primary
action). Everything else stays disciplined so the neon means something.

**Aesthetic risk (justified):** transactional data is set in **monospace** (Space Mono)
and ticket surfaces carry a **perforated ticket-stub** motif — a real dashed tear line
with notch cut-outs. Risk: skeuomorphism can read kitschy. Contained to ticket/wallet
surfaces only, monochrome, one per ticket, it becomes DVNT's tactile signature that
neither Posh (flat gradient cards) nor Eventbrite (utilitarian) commits to.

## Why this isn't an AI default
- Not **cream-serif-terracotta** — we're near-black, neon, image-forward.
- Not **black + single acid accent** — we run a **tri-hue gradient** (cyan→violet→magenta)
  plus rose + gold, multi-stop, never one flat acid color.
- Not **broadsheet hairline columns** — rounded, flyer-first, mobile-first.

---

## 1. Color tokens (named hex — all already in code)

| Token | Hex | Usage | In-code count |
|---|---|---|---|
| `ink` | `#06070D` | base background (app) | 249× |
| `ink-deep` | `#02030A` | deepest bg, scrims, OG cards | 215× |
| `surface` | `rgba(255,255,255,0.04)` | cards, rows | — |
| `surface-2` | `rgba(255,255,255,0.08)` | pressed/hover, chips | — |
| `hairline` | `rgba(255,255,255,0.10)` | borders, dividers | — |
| `cyan` | `#3FDCFF` | gradient stop 1, primary accent | 871× |
| `violet` | `#8A40CF` | gradient stop 2 | 601× |
| `magenta` | `#FF5BFC` | gradient stop 3, likes/social | 366× |
| `signal` | `#FC253A` | live/destructive/close-friends | 148× |
| `gold` | `#F5C518` | ratings, Early-Bird "price goes up" urgency | — |
| `text` | `#FFFFFF` | primary text | — |
| `text-dim` | `rgba(255,255,255,0.60)` | secondary | — |
| `text-faint` | `rgba(255,255,255,0.40)` | captions, meta | — |

**The Deviant Gradient** (the one brand stroke): `linear-gradient(100deg, #3FDCFF 0%, #8A40CF 52%, #FF5BFC 100%)`.
Spent ONLY on: primary CTA, price-from chip, the unseen "going" ring, the 2px gradient
hairline under the header, and the boost "Promoted" hairline. Never as a section background.

## 2. Typography (fonts already installed — `apps/mobile/assets`)

| Role | Face | Treatment | Why (not a default) |
|---|---|---|---|
| **Display** | **Space Grotesk** (Bold/SemiBold) | event titles, eyebrows UPPERCASE +0.08em tracking; flyer-poster title at 28–40px | characterful geometric grotesque, already the brand's — carries personality; Inter does not |
| **Body** | **Inter** (Regular/SemiBold) | descriptions, labels, controls; 15–16px | quiet workhorse — deliberately *not* the personality |
| **Data / utility** | **Space Mono** | prices, totals, countdowns, hold timer, ticket code, "3/5 checked in", order index | the "ticket-stub machine" voice — the deliberate non-default move; gives numbers a physical-ticket texture |
| Wordmark | BraveGates (existing) | logo only | reserved for the mark |

Type scale (rem): `11 · 13 · 15 · 17 · 20 · 24 · 28 · 34 · 40`. Display uses 20+, body 13–17, mono 11–20.

## 3. Spacing / radius / elevation

- **Spacing** (4-base): `2 4 8 12 16 20 24 32 40 56`.
- **Radius:** `sm 8 · md 12 · lg 16 · xl 20 · 2xl 24 · pill∅` — **buttons / chips / CTAs use `sm` (8)** (locked on-device review); cards `xl`/`2xl`; **no pills** for content; circles only for status dots + the camera shutter. **Avatars are rounded squares** (`rounded-xl`), never circular, anywhere — including the going-row stack.
- **Elevation:** flat. Depth = hairlines + the liquid-glass header (`backdrop-filter: saturate(160%) blur(18px)`, `bg ink/72`). One glass surface, not drop-shadows everywhere.
- **Motion:** 200–280ms, `cubic-bezier(0.22,1,0.36,1)`. The blur→clear "going" reveal on auth is the one orchestrated moment. All of it honors `prefers-reduced-motion` (video flyers → poster, blur → static frosted overlay, transitions → instant).

## 4. Signature element — "The Door"

The recurring composition across feed card, event hero, and boost slot:
```
flyer (video→poster→static→generated)   ← never an empty box
   └ steep bottom scrim (ink-deep, 0→90%)
        title (Space Grotesk)  ·  date·venue (Inter, dim)
        [ price-from chip — gradient ]      [ ◧◧◧◧◧ +42 going ]  ← blurred when logged-out
```
The **going-row** is the heartbeat: 5 rounded-square avatars overlapped −8px, a count
pill, a chevron. Logged-out → frosted blur over the faces + the gradient ring still
glowing ("people are inside"); tapping → the auth sheet, never the identities. Logged-in
→ crisp, dropdown opens the list. The blur→clear transition *is* the brand.

---

## 5. ASCII wireframes — key screens

### Discovery feed card (web + native)
```
┌───────────────────────────────┐
│            ▶ video flyer        │   autoplay muted; poster on load;
│                                 │   generated gradient+title if no media
│   ░░░░░ scrim ░░░░░             │
│   MIDNIGHT AURA                 │  ← Space Grotesk, uppercase
│   Fri Jun 20 · Elsewhere        │  ← Inter dim
│   [ from $25 ]      ◧◧◧◧◧ +42 ▾ │  ← mono chip (gradient) · blurred going-row
└───────────────────────────────┘
   …interleaved every 6th card, a PROMOTED slot (gradient hairline + "Promoted" eyebrow)
```

### Event detail — the conversion surface
```
┌───────────────────────────────┐
│        ▶ HERO flyer (live)      │  back ·  ⋯
│   MIDNIGHT AURA                 │
│   Fri Jun 20 · 10pm · Elsewhere │  ← live from server (reflects edits)
│   ◧◧◧◧◧  +42 going         ▾    │  ← going-row (blur gate)
│  ── tiers ──────────────────    │
│  GA            $25   [ − 2 + ]  │
│  Early Bird  $20→$30 ⏳ 12 left │  ← gold "price goes up" urgency (mono)
│  VIP table   $400   ● 1 left    │
│  Hidden       (unlock code…)    │
│  ── add-ons ────────────────    │
│  Coat check  $5  [ add ]        │
│  Tee  S·M·L·XL × blk/wht [pick] │  ← variant matrix
└───────────────────────────────┘
   ▣ sticky buy bar:  from $20   [ Get tickets ]   ← gradient CTA, always reachable
```

### Going-row states
```
logged-out:  [▓▓▓▓▓] +42 going ▾     tap ▾ → auth sheet "Sign in to see who's going"
logged-in:   [◧◧◧◧◧] +42 going ▾     tap ▾ → full list (mutual friends first)
0 going:     "Be the first in"        1: "Ava is going"   2: "Ava & Mateo are going"
private/spicy: identities never exposed (blurred or not) outside allowlist
```

### Wallet — group order is the hero (collapsed → expanded)
```
┌─ MIDNIGHT AURA ──── Fri Jun 20 ─┐        ┌─ MIDNIGHT AURA · 5 tickets ──┐
│  ▣ flyer    5 tickets        ▾  │   →    │  ⌁ Ticket 1 of 5 — Jane   ███ │
└─────────────────────────────────┘        │  ⌁ Ticket 2 of 5 — Mateo  ███ │
   ·······perforated tear······            │  ⌁ Ticket 3 of 5 — claimed by Sol
                                            │  ⌁ Ticket 4 of 5 — (add name) │
                                            │  ⌁ Ticket 5 of 5 — (send ▸)   │
                                            └───────────────────────────────┘
   each child: large QR · attendee name (editable) · tier · live event time · [send]
```

### Guest ticket-view (`/t/{token}`, no login)
```
┌───────────────────────────────┐
│        flyer (live)             │   DVNT mark (first impression)
│   MIDNIGHT AURA · Ticket 2 of 5 │
│   Fri Jun 20 · 10pm · Elsewhere │  ← live; reflects organizer edits
│        ███ QR ███               │
│   Mateo · GA                    │
│   + Coat check                  │
│   [ Add to Apple Wallet ]       │
│   Save your tickets → create acct
└───────────────────────────────┘
```

### Door scanner — group check-in (native)
```
┌── camera ───────────────────┐
│        ⟦ scan ⟧              │   HMAC validated server-side; offline-tolerant
└──────────────────────────────┘
  ✓ Jane's party — 3/5 checked in
    1 Jane ✓   2 Mateo ✓   3 Sol ✓   4 — tap   5 — tap
```

### Organizer edit — full field coverage (built from the field registry)
```
Details ▸ When & where ▸ Flyer ▸ Tiers ▸ Add-ons ▸ Boost
  Flyer: [video→auto poster+color] | [image] | [none→generated preview shown here]
  Tiers: each row editable in place — type · price schedule · sub-allocations ·
         inventory · visibility · sale window · limits          [+ tier]
  Add-ons: type · variant matrix (size×color) · binding · gating · inventory  [+]
  ⚠ changing date/venue notifies holders + may open a refund window (Phase 2)
  [ Save changes ] — complete diff, no field dropped
```

---

## 6. Self-critique pass (per skill)

- **Cut the glow.** First instinct was neon glow on every card/border — that's the
  AI-nightlife default. Revised: glow/gradient spent only on the signature moments
  (price chip, going ring, CTA, one hairline). Cards are flat `surface` + `hairline`.
- **Space Grotesk could read "trendy-default."** Kept it because it's the brand's *real*
  installed face (grounding beats novelty per the skill), but pushed the treatment to be
  distinctive — uppercase tracked eyebrows + large poster-weight titles, not body-sized.
- **The one accessory removed:** dropped a planned secondary "events near you" map-glow
  panel on the feed — it competed with the going-row for the eye. The going-row is the
  single memorable interaction; nothing else gets to glow next to it.
- **Mono-for-data earns its risk:** prices, timers, ticket codes, "3/5" all in Space Mono
  gives DVNT a coherent transactional texture and makes the perforated-stub motif feel
  inevitable rather than decorative.

## 6b. Navigation architecture — spaces, not one overloaded surface

Three audiences must not collapse onto one screen: the **attendee** (browse, see
who's going, buy), the **buyer** (wallet, group tickets, send), the **organizer**
(create/edit, boost, scan, analytics, payouts). Organizer tooling is what bloats
everything — so we separate **spaces**, not decorate.

**Pattern: root drawer = space switcher** (SDK 56 `expo-router/drawer`; CSS-animated
on web, reanimated/worklets on native). Each space keeps its own stack/tabs.

- **Attendee space (default)** — discovery/feed · event detail · cart/checkout ·
  wallet · profile. The conversion funnel: a **flat, thumb-reachable tab/stack**,
  sticky-buy-bar driven. The drawer is essentially never opened here — an attendee
  completes browse→detail→buy without touching it. Event detail + checkout are
  NEVER behind the drawer.
- **Organizer space** — create/edit · boost · scanner · analytics · payouts. A
  deliberate workspace entered on purpose; the drawer is its natural home. **All**
  organizer tooling lives here, off the attendee event screen.
- A user with no events sees only the Attendee space; the Organizer space appears
  after they create/manage an event (or via a clear "Host an event" entry).
- **Event detail is decongested:** attendee-facing only (flyer, tiers/add-ons,
  going row, buy). The owner sees a single **"Manage this event"** entry into the
  Organizer space — never inline edit/boost/scan controls. A non-owner sees zero
  organizer affordances.
- **Web parity:** public/attendee routes stay flat + crawlable; organizer routes
  live under an authed `/host` section. The drawer renders as a CSS side-nav for
  the organizer space on web; the public/attendee top nav is the header (Surface 1).

```
┌ root drawer (space switcher) ─────────────┐
│  ● Attendee   (feed · detail · cart · wallet)   ← default, flat funnel, drawer rarely opened
│  ○ Organizer  (create/edit · boost · scan · analytics · payouts)   ← appears once you host
└────────────────────────────────────────────┘
```

> **⚠ Stack risk (verify on a real device in Wave 1, not at the end):** native drawer
> animation needs `react-native-reanimated` + `react-native-worklets`. Given this
> stack's prior **Skia Graphite / Dawn worklet-collision** history, confirm the
> worklets version coexists with the existing native graphics deps **before**
> committing — test a drawer open/close on a booted device early. **Blocked on
> mobile-mcp + a dev build** (build-and-test-only until the device is live).

## 7. Cross-platform contract
Tokens → `packages/app/lib/theme/tokens.ts` (single export). Native consumes via NativeWind
config; web via Tailwind `@theme` + the raw-tag convention (NativeWind interop is off on the
Next build — established in the web port). `<EventFlyer>`, `<GoingRow>`, `<TicketStub>`,
`<TierRow>`, `<PriceChip>` are the shared primitives; each gets `.web`/`.native` variants
where rendering must differ, identical prop contracts. A `Ticket` is the same object on both.
