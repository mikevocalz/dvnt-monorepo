# 01 — Door staff research

Door: Washington DC, Saturday 19 Sep 2026 · ~100+ scans · web scanner on staff iPhones.

Method note: this is a Design-phase question about **behaviour**, not attitude. Two days
out there is no time for a study, so the criteria below are measured, not surveyed.

## Who is holding the phone

Three populations, and the design has to serve the worst one.

| | Host | Hired door staff | Volunteer |
|---|---|---|---|
| Seen the app before | yes | maybe | no |
| Knows what a tier badge means | yes | no | no |
| Will read a paragraph | no | no | no |
| Will hand the phone to someone else mid-shift | yes | yes | yes |

The volunteer sets the bar: link tap → first successful scan with no verbal instruction.
Anything needing a briefing will not survive a door where the briefing happens at 11pm
over a PA.

## The environment, as constraints

- **Dark.** The only light on the guest's phone is their own screen, often at minimum
  brightness with auto-brightness fighting back. Torch is the primary input device.
- **Loud.** Audio cues are unreliable alone. Haptic + visual carry the signal.
- **One-handed.** The other hand holds a stamp, a wristband, or the door. Everything
  touched per-guest lives in the bottom third.
- **Cracked screens, both sides.** Assume some verdicts are read through a spiderweb at
  40% brightness.
- **Bad venue signal.** DC basements. The network round-trip is the part most likely to
  fail, and the part that produces the most dangerous wrong answer.
- **A queue.** Time pressure means staff will act on a card still on screen from the
  last guest.

## How we learn anything

1. **Usability benchmarking, scripted, before the door.** 20 consecutive scans of
   known-good tickets on a real iPhone, throttled network, dark room. This is the only
   thing that produces the ≤1.0s median in §7 of the brief.
2. **Structured field observation on the 19th.** One person with a stopwatch and a
   tally, not scanning. Count stale-card misreads, torch fumbles, typed-code fallbacks,
   handovers.
3. **Server-side scan log as the backstop.** Every verdict is logged to prove the "no
   red without a server rejection" invariant; that log is also the latency and
   duplicate dataset.

**The trap:** 100 scans is not a user sample. It supports latency percentiles and
duplicate counts on the *event*. It does not support "X% of staff struggled" — that
claim needs the observation notes and stays qualitative.

## Failure stories, mapped to heuristics

**F1 — A network timeout renders as red "Invalid Ticket."** (H9, H1.) The scanner
confuses *no answer* with *a "no" answer*. A paying guest is refused and the staffer has
no reason to doubt the screen. This is the worst bug in the system and the reason amber
is a first-class verdict rather than a subtype of red.

**F2 — One presentation, two scan rows.** (H5.) A code held in frame for 800ms decodes
six times. Without a debounce keyed on the code value, the second write returns "already
scanned" — so the guest just admitted now reads as a duplicate.

**F3 — The stale card.** (H1.) The previous guest's green card is still on screen when
the next guest presents. Highest-frequency dangerous failure per guest.

**F4 — The camera never starts.** (H9, H10.) The host sends the link over Instagram DM,
it opens in the in-app webview, `getUserMedia` is blocked, staff see a black rectangle
and conclude the ticket is bad.

**F5 — The volunteer hits the gate and thinks the app is broken.** (H2, H9.) "403" tells
a volunteer nothing. "You're not on door staff — ask the host to add mike@…" tells them
who to walk over to.

**F6 — Torch off in a dark room.** (H3, H7.) Decode never fires, staff moves closer,
which makes the QR too large for the frame, which makes it worse.

**F7 — Amber is invisible on a cracked screen at low brightness.** (H4, 1.4.1.)
Colour-only verdicts fail regardless of contrast ratio.

## Measurable success criteria

Each is a pass/fail assertion, not a goal. Extends §7 of the brief.

| # | Criterion | How measured |
|---|---|---|
| S1 | Valid ticket → verdict **≤1.0s median of 20**, **p95 ≤2.5s**, online | Benchmark, throttled network, dark room, real device |
| S2 | **Zero** red verdicts not carrying a server rejection `reason` | Assert in code: no client path renders red. Audit the scan log after |
| S3 | One presentation of a code = **exactly one** scan row | Log query: group by `(code, staff_id)` in a 3s window; count must be 1 |
| S4 | Every amber leaves the ticket **not** checked in, server-side | Log query: no amber co-occurs with a `checked_in_at` write |
| S5 | Cold volunteer: link tap → first successful scan **≤60s**, no help | Field observation, n≥3 |
| S6 | Torch and typed-code each **1 tap** from the scan screen, one-handed | Static check + thumb-zone overlay at 375×812 |
| S7 | From **any** error or gate panel, ≤1 tap back to live camera or list | Static check, every panel |
| S8 | An amber retried on restored signal gives the right verdict, **no duplicate row** | Airplane mode → scan → restore → rescan |
| S9 | No card outlives its scan unacknowledged | Field observation: stale-card misreads. Target 0 |
| S10 | Full guest-list operation by keyboard alone (laptop door) | Manual keyboard pass, no pointer |
