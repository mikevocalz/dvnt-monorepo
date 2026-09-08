# Events & tickets — source audit

Run 2026-09-08 against `master` @ `0866208`, on branch `events-tickets-drawer-premium`.
Every finding below was reproduced by reading the code path end to end and is
cited to the line it lives on. Findings the brief listed that turned out to be
partly wrong are marked and corrected.

Classification: **CONFIRMED** (reproduced from source) · **CORRECTED** (real
defect, but not the one described) · **PARTIAL**.

---

## Critical

### C1 — A pass could change identity on refetch · CONFIRMED · fixed

Three navigation call sites addressed a credential by `event_id`, and the API
returned "the first matching row":

| Call site | What it did |
|---|---|
| `events/my-tickets.tsx:111-112` (old) | `setQueryData(myTicketForEvent(eventId), ticket)` then `push('/ticket/' + eventId)` |
| `checkout/success.tsx:115-119` (old) | same pattern from the confirmation screen |
| `events/[id]/index.tsx:1121-1125` (old) | prefetched the event-keyed query, pushed the event id |
| `lib/api/tickets.ts` `getMyTicketForEvent` (old) | `return data?.ok ? (data.tickets?.[0] ?? null) : null` |

`get-my-tickets` orders by `created_at DESC` and filters only on `event_id`
(`functions/get-my-tickets/index.ts:69,74`). One event can hold an admission
ticket, a coat-check claim, add-ons, and several holders' passes — `tickets[0]`
picks among them by whatever the server happened to return. Seeding the cache
with the tapped ticket masked it until the next refetch replaced the seed.

**Fixed.** `tickets.id` is `uuid` and `events.id` is `integer`
(`migrations/20260313_catchup_all.sql:88-90`), so one route carries both without
breaking the `dvnt://ticket/<event_id>` links already in the wild.
`lib/tickets/ticket-identity.ts` classifies the param: a uuid resolves to that
exact ticket, an integer resolves to the event's group and opens a pass only
when the group holds one. Nine tests in `ticket-identity.test.ts`, including a
reordered-refetch case.

### C2 — A locally manufactured QR rendered as a valid pass · CONFIRMED · fixed

`events/[id]/index.tsx:1081-1092` (old):

```ts
id: rsvpTicket?.id ? String(rsvpTicket.id) : `tkt_${Date.now()}`,
status: "valid",
qrToken: rsvpTicket?.qr_token || btoa(JSON.stringify({ eid: eventId, uid: user?.id })),
```

When `issueRsvpTicket` returned null, the handler wrote a local ticket with a
fabricated id and a base64 payload, marked `valid`. That record fed
`useMyTicketForEvent`'s `placeholderData` and the `useMyTickets` merge, so it
rendered as a pass with a scannable-looking code.

The render side had its own half: `TicketQRCode.tsx:82` drew
`value={ticket.qrToken || ""}` — a QR encoding the empty string, which scans
cleanly and fails at the door.

**Fixed.** The RSVP handler no longer writes a credential; it invalidates the
tickets query and says issuance is pending. `TicketQRCode` renders an explicit
"Issuing your pass" state when there is no server token, and the pass screen
takes `dbTicket` only.

---

## High

### H1 — A failed read rendered as an empty library · CONFIRMED · fixed

`getMyTickets` swallowed every error and returned `[]`
(`lib/api/tickets.ts`, old). Because the query then succeeded with an empty
array, `isError` was never true for a request failure, so `my-tickets.tsx:386`
showed **"No tickets yet"** — not the error branch below it. The error branch
that did exist said "Pull down to retry" while `refreshing={false}` was
hardcoded (`my-tickets.tsx:441`) on a list that only rendered when data existed.

**Fixed.** `getMyTickets` throws `TicketsUnavailableError`, carrying the
cold-start auth race as a flag so it retries quietly instead of alarming.
`libraryViewState` in `lib/tickets/ticket-library.ts` distinguishes
loading · ready · empty · failed · **stale** — the last being a failed refresh
over loaded passes, which keeps them on screen behind a banner rather than
clearing them.

### H2 — "Tickets Ready" over a pending issuance · CONFIRMED · fixed

`checkout/success.tsx:166` rendered the title and a green check
unconditionally, above a body that could read "Ticket issuance is still
processing" (`:179`), with `0 admission · 0 coat check` while loading. It
polled every 3s forever with no terminal state.

The server already returns what was needed —
`get-cart-status/index.ts:142,188` sends `cart.status` and `completed` — and
the screen read only `completed`.

**Fixed.** `lib/tickets/checkout-outcome.ts` maps the real
`carts.status` enum (`draft|holding|paying|completed|abandoned`,
`migrations/20260516150000:74-75`) to six outcomes. Only `issued` gets the
green check. A 90-second grace window resolves to a stated answer instead of an
endless spinner. A test asserts no copy in any state claims the member was not
charged.

### H3 — Status model disagreed with the database · CORRECTED

The brief describes `payment_pending` as a ticket state the code models
inconsistently. It is not a ticket state at all: `tickets.status` is
`('active','scanned','refunded','void','transfer_pending')`
(`migrations/20260334_tickets_nullable_ticket_type.sql:15`). `payment_pending`
belongs to `orders.status` (`20260310_payments_ui_tables.sql:14`).

So `my-tickets.tsx:54-58` carried a `payment_pending` badge that could never
render — a dead branch that looked like handled behaviour. **Fixed** by typing
the map as `Record<TicketRecord["status"], …>`, which makes the compiler reject
states the table cannot hold.

`transferable: true` (`ticket/[id].tsx:91`, old) was a display claim, not a
security hole: `transfer-ticket/index.ts:166` rejects anything that is not
`active` server-side. The UI offered a button the server would always refuse.
**Fixed** by mirroring the server's rule.

### H4 — Ticket caches were not account-scoped · CONFIRMED · fixed

`ticketKeys.myTickets()` → `["tickets","mine"]` and
`myTicketForEvent(eventId)` → `["tickets","mine",eventId]` carried no viewer.
A logout or account switch left a previous member's passes readable in cache,
which `lib/query-persistence.ts:50` persists to disk by design for the offline
door flow. Every ticket key now carries `viewerId` (`lib/query/keys.ts`).

### H5 — Same bug class, live in bookmarks · FOUND · fixed

Not in the brief. `useBookmarks` read `bookmarkKeys.list()` with no argument —
key `["bookmarks","list","__no_user__"]` — while every mutation wrote and
invalidated `list(viewerId)` (`use-bookmarks.ts:87,96,117,147`). The read and
the write were on different keys, so optimistic bookmark toggles never reached
the Saved tab and the invalidation cleared a key nothing read. Fixed in
`use-bookmarks.ts:29` and `use-boot-prefetch.ts:233`.

---

## Medium

### M1 — Continuous animation beside a code being scanned · CONFIRMED · fixed

`TicketQRCode.tsx:51-75` ran two pulse rings at `repeatCount: Infinity`,
ignoring Reduce Motion, on the screen a member holds up at a door. The QR also
carried `logo={true} logoSize={48}` on a 220pt code with no scan test on
record. Both removed; the reason is in the file.

### M2 — Unbounded index-keyed entrance delays · CONFIRMED · fixed

`my-tickets.tsx:64,117` used `delay(index * 45)` and `delay(index * 60)` with
no cap, so the fortieth pass waited 2.4s. Now capped at six items and skipped
entirely under `useMotionTier() === "lite"`, which already resolves Reduce
Motion, Low Power Mode, and low-memory devices
(`lib/navigation/use-motion-tier.ts:12-24`).

### M3 — Server state in `useState` · CONFIRMED · fixed

`my-tickets.tsx:336` held pending transfers in `useState` with a manual
`useEffect` fetch, against `docs/engineering-contract.md` ("Client state:
**Zustand only** — no `useState` for app/business state") and against TanStack
being the server-cache owner. Replaced with `usePendingTransfers()`.

---

### H6 — The two checkout paths offered different wallets · CONFIRMED · fixed

`use-ticket-checkout.ts:135-142` passes `applePay` and `googlePay` and re-runs
`initStripe` with `merchantIdentifier: "merchant.com.dvnt.app"` (`:110-122`).
`use-mixed-cart-checkout.ts:85-108` passed **neither**, and never called
`initStripe` at all — so it had no merchant identifier and could not surface
Apple Pay under any circumstances.

The effect: buying an admission ticket offered Apple Pay; buying that same
ticket together with a coat check did not. `publishableKey` was already in the
cart checkout response (`contracts/dto.ts:179`) and simply unused.

Wallet *availability* detection is absent from both, and that is correct —
Stripe's PaymentSheet hides a wallet the device or account cannot use, which
the ticket hook's own comment records. No change made there.

### H7 — Neither money path guarded a double submission · CONFIRMED · fixed

Both hooks wrote `checkoutLoading` and exposed it as `isLoading`, and neither
read it. A second press while the first was in flight would create a second
hold and a second payment intent; de-duplication rested entirely on every
caller remembering to disable its button. Both now refuse re-entry.

## Not reproduced this pass

The discovery/detail-hierarchy and host/scanner sections of the brief were
delegated to audit agents that failed with API errors before returning. They
are **not** reported as verified here. Checkout-hook parity did return and is
recorded above as H6/H7.

One web finding was reproduced directly rather than delegated:
`features/events/my-tickets.web.tsx:107-117` renders each ticket card as a
`div` with `onClick`, `role="button"` and `tabIndex={0}` but **no `onKeyDown`**.
It takes focus, announces itself as a button, and cannot be activated from the
keyboard at all — WCAG 2.1.1. `events-list.web.tsx:562` has the same shape but
does handle Enter and Space. Not yet fixed. What was changed on web was changed because the compiler pointed at it
while the ticket-identity contract moved — see the navigation map.

Device-measured performance numbers (warm/cold pass access, checkout-to-issuance
latency, drawer responsiveness, scroll percentiles) were **not** collected. No
build was run against a device this session.

---

## Delegated audits that returned (2026-09-08, second attempt)

### Events discovery + attendee detail

| Finding | Verdict | Evidence |
|---|---|---|
| Four overlapping segments | CONFIRMED | `events.tsx:580-585` — Upcoming / For You / All Events / Past Events. Upcoming is a strict subset of All Events (`:546-557`), and For You *returns* All Events whenever a filter is active (`:551-552`) |
| **The event title is the seventh element on the screen** | CONFIRMED | `[id]/index.tsx` — hero (`1832`), cancelled banner (`1931`), sale card (`1990`), tier selection (`2011`), promo-code input (`2031`), "Upgrade Your Ticket" (`2185`), then the title (`2213`). An attendee's first read of an event is a commercial prompt naming the tier they already hold (`2191-2199`) |
| "VIP" is any non-free tier | CONFIRMED | `[id]/index.tsx:1904-1907` — the chip is `FREE` when every tier is free, else the literal string `VIP`. The real tier name is never read |
| Five host actions inline on the attendee page | CONFIRMED | `[id]/index.tsx:2262-2322` — Edit, Dashboard, Scanner, Promote, Download offline. No single "Manage event" entry; the overflow sheet (`2865-2920`) mixes attendee and host verbs |
| Unlabelled My Tickets icon | CONFIRMED · **fixed** | `events.tsx:692` had no `accessibilityLabel` while both neighbours in the row did |
| Uncapped index stagger | CONFIRMED · **fixed** | `events.tsx:109` `delay: index * 0.15` — the fortieth card waited six seconds |
| Bare `useState` holding server data | **REFUTED** | Zero `useState` in either file; both carry explicit "banned pattern" comments. The brief's M3 was specific to `my-tickets.tsx`, now fixed |

### Host dashboard + door scanner

| Finding | Verdict | Evidence |
|---|---|---|
| **A delegated door scanner cannot open the scanner** | CONFIRMED — **highest-severity finding of this pass** | The server admits `admin`/`editor`/`scanner` co-organizers (`get-event-tickets/index.ts:176-195`), but the client gate is owner-only: `scanner.tsx:979-983` `if (String(user.id) === hostId) return true;` → otherwise "Not authorized" (`:997`). Someone given the scanner role is blocked before the server is ever asked. Same owner-only pattern at `[id]/index.tsx:1123`, `scanner.web.tsx:620`, `lib/api/events.ts:1131` |
| The scanner names neither its event nor its readiness | CONFIRMED | `scanner.tsx:824-826` renders only "Scan Tickets". `hasOfflineData` is computed at `:497` and never rendered; the only offline mention is a failure toast (`:747`) |
| Scanner-role PII redaction exists | CONFIRMED | `get-event-tickets/index.ts:404-411` — scanner gets id/status/qr_token/check-in fields plus `holder_name`, owner gets the full row. Note the code has widened past its own comment |
| Duplicate scan returns the original facts | CONFIRMED | `20260806100200_door_single_checkin_cas.sql:64-67` returns the original `checked_in_at`/`checked_in_by`; rendered at `scanner.tsx:293-299` |
| Offline acceptances marked provisional | **REFUTED** | `offline-scanner.ts:144` returns the same `valid: true` an online success produces. No provisional flag, no upload, no conflict comparison — and the file has **zero importers**. The live path is `stores/offline-checkin-store.ts`, whose drain failures only `console.warn` (`:222`, `:227`) and never surface in the scanner UI |

### My own drawer has the same owner-only gap

`features/navigation/app-drawer.tsx:202-207` derives `canHost` from
`getHostDashboard()` returning at least one event. That endpoint is
server-authoritative, but a co-organizer whose only role is `scanner` may own
no events — so the Hosting row does not appear for exactly the person who
needs the door. Recorded rather than patched: the fix belongs with the
owner-only client gates above, as one change to how event-scoped roles reach
the client, not as a special case in a menu.
