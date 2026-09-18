# 08 — Code review

A review pass over the full diff (`27cd9a5..HEAD`, 39 files). Each finding and
what was done about it. Findings that were fixed during the work are recorded
here because how they were found matters more than that they were found.

## Fixed

**1. A network failure rendered as a refusal.** `getEventTicketsPaginated`
caught every error, including a dropped connection, and returned `role: null` —
so `useEventRole` resolved successfully with "no role" and the gate told a
staffer in a basement they were not on the door. Same bug patch 01 removed from
`scanTicket`, in the access path. Fixed by splitting an answered 401/403 from a
transport failure. *Found by writing a spec that drove both.*

**2. An unknown token while offline rendered red.** The downloaded list is
active tickets as of the last refresh and freezes while the door is offline, so
a ticket sold at the door is absent from it. That produced "Not a valid ticket"
— a refusal the server never made, against a paying guest, on a stale cache.
Now amber. *Found by grepping every path that can render a rejection.*

**3. `already_scanned` never reached the title mapping.** It short-circuits to
`DuplicateFlash`, so the most common rejection bypassed the contract entirely
and gave no instruction beyond two words. *Found by an e2e that could not locate
the card it was asserting on.*

**4. The amber verdict failed AA.** White on `#D97706` measures 3.19:1, against
a rule `05-a11y.md` states explicitly. Now 8.15:1 / 5.56:1. *Found by looking at
a 375px screenshot.*

**5. `ScanResult` had no `reason`.** Introduced by the title work: every
rejection would have fallen through to "Not a ticket for tonight". *Caught
before it shipped by checking the type rather than assuming it.*

**6. The camera decoded while the guest list was showing.** Only the container
is `hidden`, so `QrScanner` stayed mounted, re-armed the scan guard and
swallowed the list's check-in — intermittently. *Found by chasing a 1-in-3 flake
instead of accepting a green run.*

**7. The PWA install prompt covered the door.** A full-screen `aria-modal` at
z-1500 over the verdict card and the check-in button. *Found when an e2e click
was intercepted by it.*

**8. `onCameraReady` is not a readiness signal on web.** Patch 05 read the video
track inside it; it fires on failure and before frames exist, so torch, zoom and
the track-`ended` recovery never worked. *Found by verifying the seam against
installed source.*

**9. `zoom={0}` is a no-op**, so un-zooming did nothing. Same source read.

**10. `next start --webpack` exited 1** — a dev/build-only flag.

## Accepted, not fixed

**No undo on a check-in — and it is not a safe pre-Saturday change.** The
largest remaining gap against the product bar (Luma flips its primary to "Undo
Check In"), and a mis-tap on the guest list is currently unrecoverable from the
scanner.

It is not built because there is nothing to build it on. Nothing server-side
reverses a check-in: grepping every edge function for `checked_in_at` returns
only reads, analytics, export and refund — no un-redeem, no `action` parameter
on `ticket-scan`, no migration that clears the column. Undo would mean a NEW
write path against check-in state, two days before a door, in the neighbourhood
the brief marks do-not-touch (`redeem_ticket` / `redeem_addon`), with no way to
exercise it end-to-end before Friday's freeze. The brief's own rule — never add
a second way to mark a ticket scanned — points the same way about its inverse.

The correction path at the door is therefore the host, out of band. That is
worse than Luma and it is a real gap; it is recorded as one rather than closed
badly. Build it after Saturday, server-side first.

**The guest list caps at 200**, the server's `pageSize` clamp. Surfaced on
screen rather than silently truncating.

**The verdict overlay sits below the app header and tab bar.** `z-[60]` loses to
SiteChrome, so navigation stays tappable during a verdict. Legible, but the
overlay is not as modal as it looks.

**The duplicate flash announces via `aria-live` on a container that also holds a
`<style>` tag.** Works, but the live region is coarser than the standard card's.

## Verified, no change needed

- Only the server can produce a red verdict. Every client-side path now renders
  amber or a typed rejection carrying a server `reason`.
- One check-in path: camera, typed code and guest-list row all go through
  `useScanTicket` → `ticket-scan` → `redeem_ticket`.
- Zustand only in the scanner screen; the single `useState` match is the rule
  stated in a comment.
- `packages/ui/src/media/qr/` is byte-identical to the patch, so the browser
  lab's 8/8 still describes these bytes.
