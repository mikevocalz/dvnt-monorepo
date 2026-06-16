# DVNT Apple Watch — Fit Doc (PROMPT 7)

> Step 0 deliverable. The as-is ticket / QR / scan / sync contract in the live
> `dvnt-monorepo`, and exactly what the watch reuses **verbatim**. The QR payload
> spec is the non-negotiable part — get it wrong and hosts cannot scan.

## TL;DR for the watch engineer

| Question | Answer | Source |
| --- | --- | --- |
| What does the host scanner read off a screen? | The **`qrToken`** string, rendered as a **QR code** (2D), error-correction **level H**. | `packages/app/src/ticket/ui/TicketQRCode.tsx`, `packages/app/components/qr-code.tsx` |
| What is `qrToken`? | A **64-char lowercase hex** string (`encode(gen_random_bytes(32),'hex')`), unique per ticket, **static for the ticket's lifetime**. | `tickets.qr_token` column |
| Do codes rotate / expire? | **No.** No TOTP, no TTL, no rotation. The token is invalidated server-side by *state change* (scan/refund/void), not by time. | `ticket-scan/index.ts` |
| So the watch renders… | `QR(value = ticket.qrToken, ecl = "H")` — **byte-identical** to what the phone already shows. Nothing derived, nothing re-signed on the watch. | this doc |
| How does "used" propagate? | Phone polls `get-my-tickets` (~5 s); on status change the phone pushes the new ticket set to the watch over **WCSession**. No Supabase realtime today. | `packages/app/lib/hooks/use-tickets.ts` |

**The watch holds no auth and signs nothing.** It is a *presenter*: it displays a
string the phone already minted. This sidesteps the entire HMAC-secret problem —
the watch never needs `TICKET_HMAC_SECRET`.

## 1. QR payload contract (critical)

There are two payload representations in the backend, but the **client display path
uses exactly one**, and that is the one the watch must match:

- **Display path (what the phone shows, what the watch must show):**
  [`TicketQRCode.tsx`](../packages/app/src/ticket/ui/TicketQRCode.tsx) renders
  `<QRCode value={ticket.qrToken} ... ecl="H" />`. The value is the raw
  **`qrToken`** — a 64-char hex string. No prefix, no JSON, no base64.
- **Modern signed path (`qr_payload`, base64url HMAC-JSON):** generated at checkout
  and *accepted* by the scanner as a fast path, but the RN ticket UI does **not**
  display it. To stay byte-identical with the phone and avoid shipping the HMAC
  secret to a credential-less device, **the watch renders `qrToken`, not `qr_payload`.**

Symbology / rendering parameters the watch must reproduce:

| Param | Value | Why |
| --- | --- | --- |
| Symbology | QR (2D) | scanner is `html5-qrcode` (web) / native barcode scanner (mobile), both QR-capable |
| Error correction | **H** (~30%) | the phone overlays the DVNT wordmark on the QR; level H tolerates the obscuration. The watch shows the wordmark in chrome (not over the code) but keeps **H** for scan robustness at arm's length on a ~40 mm OLED. |
| Foreground / background | black on white | máx contrast; do not tint the modules |
| Quiet zone | generous (full-bleed card with white margin) | small-screen scan reliability |

CoreImage equivalent on watchOS:
`CIFilter.qrCodeGenerator()`, `inputMessage = qrToken.data(.ascii)`,
`inputCorrectionLevel = "H"`, then nearest-neighbour upscale (no smoothing).

## 2. Rotation / anti-screenshot

Not implemented. Anti-fraud is **server-side state mutation** + audit trail
(`checkins`) + scanner rate-limit (30/60 s), not short-lived codes. Consequences
for the watch:

- No countdown ring is needed (the spec's "if rotating" branch is **N/A** — note
  it and move on).
- A screenshot of a *valid* code is as good as the watch; fraud prevention is that
  the door scan flips the ticket to `scanned` and any re-present reads as used. So
  the watch's job is to **reflect the used state quickly** (via WCSession push), so
  a member can't unknowingly re-present a dead code.

## 3. Ticket data model (what crosses the bridge)

Canonical TS shape: [`ticket-store.ts`](../packages/app/lib/stores/ticket-store.ts).
DB: `tickets` table (`apps/mobile/supabase/migrations/20260301_events_ticketing_v2.sql`).

Client `TicketStatus` (5 states — the "15-state machine" was aspirational; live code
uses these): `valid | checked_in | revoked | expired | transfer_pending`.
DB stores `checked_in` as `scanned`; the API layer maps it.

Fields the watch needs (subset of `Ticket`, denormalised so the watch is offline-capable):

```
id, eventId, status, qrToken,
tier, tierName, tableNumber,           // per-ticket label in the multi-ticket stack
checkedInAt,
eventTitle, eventDate, eventEndDate,   // list rows + sorting + complication countdown
eventLocation, entryWindow             // glance context
```

**Multi-ticket:** a member can hold several tickets to one event (guests) or to many
events. Group by `eventId` for the list; within a group, each ticket is its own page
in the QR stack with its own `tierName`/`tableNumber` label and its own `qrToken`.

## 4. Sync layer → bridge mapping

As-is: [`use-tickets.ts`](../packages/app/lib/hooks/use-tickets.ts) `ticketKeys.myTickets()`,
`refetchInterval ~5 s`, `staleTime 0`. No realtime subscription.

Watch sync design (the spine):

1. **Phone is the source of truth.** The RN app already polls my-tickets every ~5 s.
2. On every successful fetch, the RN app projects tickets to the compact watch DTO
   (`packages/app/src/watch/watch-payload.ts`) and:
   - writes them to the iPhone App Group via `ExtensionStorage` (for the iPhone-side
     complication/widget that shares `group.com.dvnt.app`), **and**
   - pushes them to the watch with `WCSession.updateApplicationContext` (latest-wins,
     coalesced — perfect for "current ticket set").
3. **Watch side** persists the received context into its **own** App Group
   (`group.com.dvnt.app.watch`, shared with the watch complication) so the watch app
   and its complication both read the same cache, and so tickets survive a phone that
   is unreachable. App Group containers are **per-device** — the watch cannot read the
   iPhone's container — which is exactly why WCSession is the transport.
4. **Independence:** the watch shows the last-synced set when the phone is unreachable,
   with an honest "as of <time>" staleness line. Because codes don't rotate, a stale
   *valid* code still scans — staleness only risks showing a code as valid that the
   phone has since learned is used; we surface the timestamp so the member knows.

## 5. Add-to-wallet (reference, not reused on watch)

`packages/app/src/ticket/helpers/add-to-wallet.ts` posts `{ticketId, eventId}` to
`ticket_wallet_apple` / `ticket_wallet_google` and opens the returned pass. The watch
does **not** use PassKit — it renders the live `qrToken` directly so used-state can
flip in seconds. (A `.pkpass` on the watch would be a second, staler ticket system —
explicitly out of scope per PROMPT 7 "the watch adds a presentation surface, not a
second ticket system".)

## 6. Edge functions touched

- `ticket-scan` — host scans the watch screen; atomic `status -> scanned`, writes
  `checkins`. The watch never calls this.
- `get-my-tickets` (via `ticketsApi`) — the phone's poll; the only ticket source the
  bridge forwards.
- `ticket-checkout` / `rsvp-issue-*` — mint `qr_token`; irrelevant to the watch beyond
  being where the token the watch displays originates.

## 7. Watch-as-scanner

Out of scope. watchOS has no general camera API, so a watch cannot read codes. The
watch is the **presenter**; the host's existing phone scanner is the **reader**. Noted
and closed.

## 8. Verification contract (what "done" means)

- A member with **3 tickets to one event** pages through **3 distinct** QR screens,
  each encoding that ticket's own `qrToken`.
- The host's existing phone scanner reads each off the watch on the first try; payload
  decodes to the same 64-hex string the phone shows → scanner accepts.
- A code marked `scanned` flips to a greyed "Checked In" state on the watch within a
  few seconds (phone poll → WCSession push) and fires a `.success` haptic.
- Phone unreachable → cached valid tickets still display with an "as of" line.
- Rotation cadence: **N/A** (no rotating codes).

## 9. What was built (file map)

Native watchOS (apple-targets CNG, `apps/mobile/targets/`):

| File | Role |
| --- | --- |
| `watch/expo-target.config.js` | watch app target: bundle id, App Group `group.com.dvnt.app.watch`, brand colors, `dvntLogo` imageset from the real SVG |
| `watch/DVNTWatchApp.swift` | `@main` — brand launch beat → `EventListView`, injects store + WCSession |
| `watch/Models.swift` | `WatchTicket` / `TicketStatus` / `EventGroup` / `WatchTicketEnvelope` (mirror of `watch-payload.ts`) |
| `watch/TicketStore.swift` | `@MainActor` store; reads/writes the watch App Group; groups by event; `nextEvent` for the complication |
| `watch/WatchConnectivityManager.swift` | WCSession delegate; ingests pushed payloads; `.success` haptic on a used-state transition |
| `watch/QRCodeView.swift` | CoreImage QR of `qrToken`, correction level **H**, nearest-neighbour upscale |
| `watch/EventListView.swift` | glanceable carousel: event name, date, count badge, staleness line |
| `watch/TicketStackView.swift` | vertical-paged (Crown) multi-ticket stack, "N of M", per-ticket tier label, card-flip + haptics, state overlays |
| `watch/Theme.swift` / `DVNTLogoView.swift` | exact brand gradients; real wordmark |
| `watch-complication/expo-target.config.js` + `DVNTWatchComplication.swift` | WidgetKit accessory complication (circular/inline/rectangular): next-event countdown, "tap to show ticket" |

React Native bridge (`packages/app/src/watch/`):

| File | Role |
| --- | --- |
| `watch-payload.ts` | projects `TicketRecord[]` → watch DTO/envelope; status + tier mapping; change signature |
| `watch-bridge.ts` | pushes via `react-native-watch-connectivity` (`updateApplicationContext` + `transferUserInfo`) and writes the iPhone App Group via `ExtensionStorage`; all native deps lazy + guarded |
| `use-watch-ticket-sync.ts` | reuses `useMyTickets` poll; pushes on material change; answers the watch's `requestTickets` |

Wiring: `useWatchTicketSync()` is mounted in the protected layout
(`packages/app/features/routes/screens/(protected)/_layout.tsx`) next to `useLiveSurface()`.
Config: `app.config.js` adds the `@bacons/apple-targets` plugin, `ios.appleTeamId`,
and the `group.com.dvnt.app` entitlement. Deps added: `@bacons/apple-targets` (dev),
`react-native-watch-connectivity`.

## 10. Build & verify

```bash
# from apps/mobile
pnpm install                       # pulls @bacons/apple-targets + watch-connectivity
npx expo prebuild -p ios --clean   # links targets/watch + targets/watch-complication
```

Then in Xcode (one-time, per apple-targets codesigning notes):
- confirm `ios.appleTeamId` (436WA3W63V) is applied to **each** target (watch app +
  complication) and signing succeeds;
- confirm the complication's widget extension is embedded in the **watch app**, not
  the phone app.

EAS Build signs the watch + complication targets automatically once the team id is set.

Device proof (Simulator can't prove scan reliability / WCSession edges — use a real
Apple Watch + iPhone): see §8. Held back: the `npx expo prebuild` + EAS build + on-device
scan test must be run by the user (needs Xcode, signing, and the paired hardware).

