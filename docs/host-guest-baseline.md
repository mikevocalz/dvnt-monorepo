# Host & Guest Experience — Phase 0 baseline

Status: **awaiting approval.** Nothing in WS-1…WS-8 is implemented. Per §4.3 no
location-permission change has been made or staged.

Everything below was read out of the working tree on this branch. Where the spec's
ground truth and the code disagree, the code is quoted and the difference is called
out — there are two such cases, and one of them changes a Phase-0 answer.

---

## 0 · Two findings that come before the decisions

### 0.1 The scanner payload does not contain what its comment says

`supabase/functions/get-event-tickets/index.ts` documents the scanner redaction as:

> `// Scanner role: name + tier + add-on info only. No emails, no purchase amounts, no Stripe references.`

The object it actually returns for a scanner has **neither a name nor add-on info**:

```ts
const base = {
  id, event_id, ticket_type_id, status, qr_token,
  ticket_type_name: t.ticket_types?.name || "General",
  checked_in_at, checked_in_by,
};
if (isScanner) return base;
```

`ticket_type_name` is the *ticket type* ("General"), not the holder. So a scanner
today gets no holder identity at all. This matters for §4.2: the question is not
"should we add membership tier to the scanner payload" but "the scanner payload is
already more redacted than its stated policy — which is correct, the comment or the
code?" **That is a decision, not a bug fix**, and it is listed below.

### 0.2 There is no plan→colour map to import

§WS-1 says to use "the shared plan→label/color map (same map the watch ring uses —
import it, don't restate it)". That map does not exist. `lib/theme/tier-colors.ts`
is the **ticket-tier** axis (`free | ga | vip | table` → cyan / cyan-blue / purple /
magenta) and the watch's `Theme.swift` `tierAccent(_:)` mirrors that same ticket
axis. Nothing maps `dvnt_insider`/`dvnt_vip`/`sneaky_tier_1` to a colour or label.

Given the spec's own law — *"Two different 'tier' axes — never merge them"* —
reusing `tier-colors.ts` for subscription tiers would be exactly the merge it
forbids. A new `lib/theme/plan-colors.ts` has to be authored, and its palette is a
design decision (below).

---

## 1 · Perk matrix — **decision required (Mike)**

Verified taxonomy from `lib/subscription/plans.ts`:

| Plan key | Family | `PLAN_RANK` |
|---|---|---|
| `free` | `dvnt_membership` | 0 |
| `sneaky_tier_1` | `sneaky_lynk` | 1 |
| `sneaky_tier_2` | `sneaky_lynk` | 2 |
| `dvnt_core` | `dvnt_membership` | 3 |
| `dvnt_insider` | `dvnt_membership` | 4 |
| `dvnt_vip` | `dvnt_membership` | 5 |
| `dvnt_founders_circle` | `dvnt_membership` | 6 |

Proposed default — **per-family, then rank**, because the spec notes Sneaky Lynk is
a different product line that may confer nothing at a door:

| Perk | Default grant | Rationale |
|---|---|---|
| Skip the line | `dvnt_insider`+ (rank ≥ 4) | Keeps the lane small enough to be a perk |
| Early entry | `dvnt_vip`+ (rank ≥ 5) | Scarcer than skip-the-line |
| Guaranteed entry | `dvnt_founders_circle` (rank 6) | The one that costs the host capacity |
| Comp / drink | off by default, host opt-in per tier | Real money — never a silent default |
| Table priority | `dvnt_vip`+ | Pairs with the `table` ticket tier |
| Any `sneaky_lynk` tier | **no door perks** | Different product line |

Host-overridable surface: a per-event matrix in `event-edit` keyed
`{ perk → minimum PLAN_RANK | explicit plan key set }`, defaulting to the above.

**Needs your answer:** accept this matrix, or give the one you want. Also confirm
Sneaky tiers confer nothing at a door.

## 2 · Roster data contract — **one decision required**

Current server behaviour, verified:

- Role ladder: `owner` (event owner) → else `event_co_organizers` with accepted
  role in `(admin, editor, scanner)`. Response carries `role: effectiveRole`.
- Owner/admin/editor get the full joined row; scanner gets `base` (see §0.1).
- Sort is fixed: `.order("created_at", { ascending: false })`.
- Pagination is **offset-based**: `.range(offset, offset + pageSize - 1)` with
  `pageSize` clamped 1…200, default 50.

Proposed extension:

- Add `membership_tier: { planKey, rank, label } | null`, resolved server-side per
  §4 of the spec, for `owner | admin | editor`.
- **Decision required — scanner.** Three coherent options:
  1. **No tier for scanner** (most private; consistent with §0.1's actual payload).
  2. **Tier badge only, no holder name** — works the priority lane without
     identifying anyone; consistent with the code as written.
  3. **Name + tier** — matches the comment's stated intent, and is the biggest
     PII expansion of the three.
- Sort keys: `tier_rank`, `ticket_tier`, `checked_in`, `purchased_at`, `name`.
- Segments: `tier >= X`, VIP ticket holders, checked-in, not-yet-arrived, add-on
  holders, comped, waitlisted — composable with the existing `status` + `search`.

**Pagination must change.** Offset pagination over a live roster duplicates and
skips rows as tickets are inserted mid-scroll, which is precisely what §WS-2's
accept criterion forbids. Keyset on `(sort_key, id)` is required, and it is a
breaking change to the function's request shape — `page` becomes `cursor`.

## 3 · Presence architecture — recommendation, **approval required before any code**

Baseline, verified: `lib/hooks/use-device-location.ts` requests **foreground**
permission and calls `getCurrentPositionAsync` **once**. A repo-wide search for
`requestBackgroundPermissionsAsync`, `startGeofencingAsync`, and
`watchPositionAsync` returns **zero hits**. There is no background location, no
geofencing, and no server-side coordinate storage today.

**Recommendation: do not add *Always* authorization.** Least-privileged design that
still delivers the feature:

- **Foreground + watch only.** The guest gets presence when the app is open near the
  venue, or from the wrist (WS-6 reuses the watch geofence that the watch prompts
  already establish). No `Always`, no background geofencing on the phone.
- What this gives up: a guest with the app closed and no watch will not auto-report
  `approaching`. They arrive and scan like anyone else. Given the door is the truth
  (spec law) and presence only stages the line, that is an acceptable loss and it
  keeps the App Review / Play justification trivial.
- If `Always` is later judged necessary, it needs its own approval round — the
  review bar is high and the justification must name the user-visible benefit.

State machine and retention (proposed): `approaching` (≤ 500 m) → `arrived`
(≤ 75 m) → `checked_in` (set by `ticket-scan`, never by the device) → `departed`
(> 500 m for ≥ 10 min). Table `event_presence(event_id, ticket_id, state,
updated_at)` — **no latitude, no longitude, no accuracy, no history**. TTL: rows
deleted at `event_end + 6h`. Revocation from the ticket screen deletes the guest's
rows immediately.

Consent copy (per-event, off by default, refusable at no cost):
> "Let the host know when you're close so they can move you through the line. Your
> location never leaves your phone — the host only sees that you're nearby."

## 4 · Guest-checkout identity — no decision needed

`orders` carries `guest_email`, `guest_name`, `guest_phone`, and
`20260806100300_guest_claim.sql` lets a guest later claim the order by email
(setting `user_id` while keeping `guest_email` — the migration's comment notes the
claim is deliberately visible, never silent).

A guest therefore has no `user_id` → no `membership_subscriptions` row → no tier.
`membership_tier: null` renders as **nothing at all** — no badge, no "Free" chip, no
grey placeholder. Per §WS-8 the guest ticket must contain no negative framing, so
the absence must be genuinely absent, not a styled empty state.

## 5 · Scale check — **the numbers do not yet justify the fear, but the indexes do**

Measured today: `tickets` = **21 rows** across **14 events**; `orders` = 45. The
largest realistic roster is therefore nowhere near the 5,000 the spec targets, and
current timings are meaningless as a baseline.

That said, `tickets` has exactly **one** index in the migration history:

```sql
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type_id ON public.tickets(ticket_type_id);
```

There is **no index on `event_id`** — the column every roster query filters on.
Before any of the new sorts ship:

- `tickets(event_id, created_at desc, id)` — the default roster order + keyset
- `tickets(event_id, status)` — the status filter
- `tickets(event_id, checked_in_at)` — the checked-in / not-arrived segments
- whatever the tier join lands on in `membership_subscriptions(user_id, status)`

These are cheap now and painful later; they should land with WS-1, not after.

---

## Approval gate

Blocking answers needed before WS-1:

1. **Perk matrix** (§1) — accept the proposal or replace it; confirm Sneaky tiers
   confer no door perks.
2. **Scanner tier visibility** (§2) — option 1, 2, or 3; this also settles whether
   §0.1's comment or its code is the intended policy.
3. **Presence authorization** (§3) — confirm foreground + watch only, accepting
   that a closed app does not report `approaching`.

Non-blocking but worth confirming: the new `plan-colors.ts` palette (§0.2), and
that the keyset-pagination break to `get-event-tickets`' request shape is acceptable
(§2).
