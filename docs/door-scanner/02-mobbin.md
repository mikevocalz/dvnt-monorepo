# 02 — Mobbin references, per screen

Five screens, ≥3 references each, all pulled fresh and distinct from the seed set in the
brief's §8. Each entry says what we take and what we reject — a rejection with a reason
is more useful than a compliment.

## Screen 1 — Scan

**[Uber — Scan QR code](https://mobbin.com/screens/c9df75d3-ad98-407a-b196-516df6283491)**
Take: exactly our priority order — corner brackets (not a full box), one torch glyph
under the frame, and **"Enter ID instead"** as a full-width row pinned at the bottom. The
fallback gets the widest, lowest, easiest target. Chrome is nearly nothing.
Reject: the torch is an unlabelled 24px glyph with no on/off state. In the dark a
staffer cannot tell if it is already on, so they toggle twice and lose two seconds per
guest.

**[Lyft — Scan to ride](https://mobbin.com/screens/2c8b6dc6-d08d-4234-b9ef-47859ef77160)**
Take: two large circular buttons in the bottom corners — keyboard left, torch right,
reachable one-handed in either hand, which a centre-bottom stack is not. The subhead
tells you *where to point*.
Reject: a hard-edged rectangle with brackets inside it gives two competing frames. And a
keyboard glyph alone does not read as "type the ticket code" to a volunteer.

**[Weverse — QR Survey](https://mobbin.com/screens/3fa2b35f-fa6f-43d8-bb77-20408a8ca696)**
Take: the **1 / 2x / 3** zoom stepper. Discrete stops beat a pinch gesture — one-handed,
keyboard-addressable, and the answer for a guest holding their phone behind a barrier.
Reject: tiny text labels, no hit padding, active state carried by weight alone. A
swipeable tab bar directly under the thumb next to the zoom is a misfire generator.

**[Luma — Scan to Check In](https://mobbin.com/screens/6f2ca8bd-8c6a-4bf5-9ac7-7e2336d30ef9)**
Take: the closest thing on Mobbin to our screen. The verdict lands as a green pill while
the camera stays live and the frame stays ready — the scanner never leaves scan mode for
a green.
Reject: the pill auto-dismisses out of the thumb zone, too small to read in the dark, and
there is no "type the code" escape anywhere. We keep the stay-in-scan-mode behaviour and
move the verdict down and make it bigger.

**[Wise — QR scan](https://mobbin.com/screens/b23c2805-ad46-4148-90ca-9f19d33b815b)**
Take: accent-coloured corner brackets on near-black read as "this is the live target"
with no instructional text, and survive low brightness better than white-on-black. A
help affordance on the scan screen is right for a volunteer.
Reject: "Import QR code" as a small underlined link — wrong weight for the fallback that
saves the door. Ours is a button.

**[Trip.com — Scan QR Code](https://mobbin.com/screens/05f634b7-46e2-413c-bfe5-2dd1ac05f709)**
Take: **labelled** icon pair — glyph above, word below. Two words remove the
toggle-twice problem Uber and Lyft both have.
Reject: the animated scanning laser. It implies the scanner is working through the code,
which is false, and it is a motion loop to kill under `prefers-reduced-motion` for no
benefit.

**[Meetup — Scan tab](https://mobbin.com/screens/31e93f37-6471-40fc-969c-e2396f9ad6a4)**
Take: the torch-off state explicitly drawn as a slashed glyph — the detail Uber misses.
Reject: List/Scan in the *header* puts the most-used toggle out of thumb reach. Luma's
bottom-centre placement is correct.

## Screen 2 — Verdict card

The weakest area, and it got the most search budget. **Nobody on Mobbin has solved the
amber/no-verdict case for a scanner.** Everything found is a success card, a hard
rejection, or an ID-verification retry. The three-state model is ours to design. Below is
the best structural precedent per state.

**[Luma — post-scan guest sheet](https://mobbin.com/screens/c79be8a7-a525-40ab-87d7-3167e2180b63)** — the structural model
Take: bottom sheet over a paused camera. Name as the largest element, then standing, then
one action. Every target in the thumb zone.
Reject: the verdict is one green word in a metadata row, six points tall. Unreadable at a
dark door, and colour-plus-tiny-text only. Also "Going" is RSVP status, not a scan
verdict — conflating them is how F1 happens.

**[Luma — sheet with ticket tier](https://mobbin.com/screens/a779f7d7-ecb5-4080-8bcd-b05cc92b30d4)**
Take: tier on its own line rather than crammed into the metadata row — correct for DVNT
where the tier drives what the door does next.
Reject: four metadata fields before the action button. Ship name + tier + verdict; put
email and registration time behind the overflow.

**[Luma — Check In Successful](https://mobbin.com/screens/4f18d749-324f-4381-89cc-3ef2b5b0a1d4)**
Take: the primary flips from "Check In" to **"Undo Check In"** — recovery in the
muscle-memory position (H3) — and the state change is carried in two places.
Reject: the undo is a low-contrast grey ghost. And nothing distinguishes "checked in just
now by you" from "was already checked in", which is the whole duplicate case.

**[Luma — Registered / Checked In timestamps](https://mobbin.com/screens/2ac81db5-d06e-4abc-bab8-7bf2cb9dd0c2)**
Take: for our duplicate verdict, "checked in at 10:42 PM" is a fact the guest can respond
to. A bare "already scanned" is not.
Reject: absolute times force mental arithmetic. Relative — "8 minutes ago" — is what a
bouncer needs.

**[BeReal — "That's your own QR!"](https://mobbin.com/screens/f62efa4d-f6a2-4ad2-8492-5fa4ac34394b)** — the rejection model
Take: frame stays visible, dark sheet slides up, one glyph, one line of cause, one line
of next step, one button. That is our red card's skeleton.
Reject: monochrome, so it reads as informational rather than a stop. And "Got it" is a
dismissal, not the next action. Ours says "Next guest."

**[Cash App — payment failed](https://mobbin.com/screens/a8dd3bc5-6b42-48d0-8046-145abb45b193)**
Take: ruthless reduction — red ✕, heading, one sentence, one full-width Done. At a door
that emptiness is the feature.
Reject: "couldn't be completed for security reasons" is a non-reason. Our red must name
the actual rejection, because already-scanned / refunded / wrong-event each send the
guest somewhere different. A generic red is nearly as bad as a wrong red.

**[Co-Star — Cannot Redeem Code](https://mobbin.com/screens/11a8831a-e75e-496e-919c-2ab54b7637ac)**
Take: the compact banner form — cause and recovery in one block, no modal. Good for the
typed-code rejection where we do not want a takeover.
Reject: amber used for a hard not-found. Under our semantics that is red. Colour
discipline is non-negotiable; amber means only "we could not reach a decision."

**[DoorDash Dasher — Scan successful](https://mobbin.com/screens/c483c354-1bcb-43c6-845a-60c3f7c1f449)**
Take: the success sheet over a **still-live** feed — the camera does not black out, which
matters when you are about to scan again in three seconds.
Reject: a white card on a bright feed with a thin edge. At night with a torch on, that
boundary disappears into blown highlights. Ours needs an opaque fill and a ≥3:1 border.

**[GoPay — Payment failed](https://mobbin.com/screens/bfe3c74e-626b-45e9-809c-e67594c1a7d6)**
Take: **full-bleed colour field.** At three metres, in the dark, through a cracked
screen, the colour field is the verdict and the text is the detail. A small card cannot
do this.
Reject: the title appears twice, and "Oof" is a tone we cannot afford when someone is
being turned away. "Don't worry…" buries the one fact that matters in reassurance
language. Our amber states the not-checked-in fact first, flat.

**[Revolut — Declined transaction](https://mobbin.com/screens/95dc85c9-8a4c-47a8-b765-74b8ba18b04f)**
Take: the `verdict • reason` bullet pattern shows the rejection came from an authority,
not the app — useful when the guest disputes it.
Reject: it is a scrollable receipt with six metadata rows and no primary action. Fatal at
a door.

## Screen 3 — Camera issue panel

**[PlayStation — Camera access disabled](https://mobbin.com/screens/b27fac9f-381a-46f3-b761-47922ba43290)** — best reference for this screen
Take: two paths on one screen, permanently. The fallback is not hidden behind the failure
of the primary — it is a standing second option. Exactly right for a door: whatever is
wrong with the camera, typing still works.
Reject: privacy-policy microcopy at the moment of failure. And on iOS Safari there is no
"Enable Camera Access" button we can call — our primary must be literal Safari
instructions plus a reload, not a fake settings button that does nothing.

**[Meetup — Turn on camera](https://mobbin.com/screens/a98bbd1f-2f2e-4d74-a207-77c78a8caaf7)**
Take: the prompt is drawn **inside the viewfinder rectangle** — the broken thing is
labelled in place, no modal, and the List tab stays operable.
Reject: "Turn on camera" as a plain text link in a black rectangle. Low affordance and a
small target for the one thing that unblocks the whole task.

**[Bird — Enable Camera](https://mobbin.com/screens/ea89413a-8f12-484e-9a2f-ce4047b5a13c)**
Take: the action pair, stacked and ranked — solid primary, text secondary beneath. Copy
names the destination rather than saying "permission required."
Reject: a centred modal with no dismiss. Trapping a volunteer in a modal at a door is a
hard no; every panel needs a way back (S7).

**[Cake Equity — "have you denied it?"](https://mobbin.com/screens/5eb043bd-8269-415b-bdc4-2a052cba0112)** — a web counter-example
Take: cited precisely because it is **web** and demonstrates what to avoid. The error is
a small toast in the corner while the dead control sits centre-screen; the relationship
is spatial only.
Reject: all of it. Asking the user "have you denied it?" — the app can determine this and
must.

**[Walmart — Camera access required](https://mobbin.com/screens/00dc50a7-3c1b-4eb2-9def-cee8e3ee111c)**
Take: a sheet over a dimmed but still visible viewfinder, so the context of what is
blocked stays on screen.
Reject: a large decorative illustration eats the top half and pushes the action to the
fold. Those pixels belong to the instruction.

**[HYPE — no network inside the QR sheet](https://mobbin.com/screens/e058ad1f-07de-4aed-8eac-7944bb0c2483)**
Take: the container persists and only the body swaps, so the staffer never loses their
place. The pattern for decode-engine-failed and camera-busy.
Reject: black-on-white with no glyph reads as a loading state, not a fault. And it never
says whether the last scan went through — the question at a door.

**[Klarna — camera access](https://mobbin.com/screens/e79dc9e0-830c-460d-bd79-1e1fc419ab4c)**
Take: the alternative is not an apology, it is another way to finish the task.
Reject: no statement of what happens if you decline, and no distinction between a
first-ask and a re-ask after denial — those need different copy.

## Screen 4 — Guest list + manual check-in

**[Luma — Guest List with counted tabs](https://mobbin.com/screens/714cff52-5dbc-4a9b-82da-fb910da4e4dc)**
Take: the reference implementation. Count trails each label, so the filter and the tally
are the same object and cannot disagree. Relative time, not absolute. Sort / List|Scan /
search all thumb-reachable at the bottom.
Reject: check-in state is shown but not *actionable* from the row — a manual check-in
needs a drill-in, two extra taps per fallback guest. Un-checked rows have no trailing
element, so the column reads ragged.

**[Partiful — Check In Guests](https://mobbin.com/screens/1103e00c-2084-4264-b872-2e8cb313769c)**
Take: the per-row action Luma is missing. Two visually distinct trailing states in the
same column position, both readable without reading the name. Row → tap → done.
Reject: emoji as the RSVP signifier — unreadable at low brightness, meaningless to a
volunteer. And no undo, so an accidental check-in is unrecoverable from the list (H3).

**[Luma — empty filtered state](https://mobbin.com/screens/fb4c1d40-7784-43eb-ab19-b73151e16e84)**
Take: the controls that caused the empty result stay visible, so the way out is obvious.
Reject: "There are no guests of this status" names neither the status nor the exit. Ours
names the filter and offers the escape.

**[Posh — Event Overview with scan progress](https://mobbin.com/screens/74308f26-08de-441c-8ee7-257362cf852a)**
Take: **"of 1 (0 left)"** — how many are still outside is the number a door wants, and it
answers "are we nearly through?" without arithmetic.
Reject: it lives behind a nav item, so the person scanning never sees it. Progress
belongs on the scan screen.

**[Apple Invites — per-row decisions](https://mobbin.com/screens/93e6c76c-c79b-4494-8cff-b61c72736251)**
Take: sectioning by *what needs a decision* rather than alphabetically puts the work at
the top.
Reject: green ✓ and red ✕ as adjacent equal-weight circles ~40px apart in the thumb zone
with no confirmation. A one-tap irreversible reject next to a one-tap approve is a
guaranteed misfire at a door.

## Screen 5 — Gate / access denied

All gate references are desktop SaaS. The content model transfers; none of the layouts
do.

**[Whop — no permission to view this page](https://mobbin.com/screens/0c058329-261f-4b41-b8a9-90048a268f69)**
Take: the scope word emphasised — it tells you the account is fine and only *this*
resource is blocked, the right framing for a volunteer who is signed in but not staff.
Reject: no action at all. No identity shown, no way to switch accounts. A dead end.

**[Todoist — You don't have access](https://mobbin.com/screens/f4cf854e-0fce-4633-82c1-6169deadeb98)** — best gate reference
Take: it shows **which account you are signed in as**. Nine times in ten the volunteer is
on their personal Google account and the host added their work one; without the identity
line they cannot diagnose that. Also never terminal.
Reject: three small text links at identical weight — no ranking, all too small for a
thumb.

**[Juicebox — not available for view-only admins](https://mobbin.com/screens/09be740e-7478-4978-8701-6fc0e03b9aa6)**
Take: names the exact role you hold and the one you need. Converts "the app is broken"
into "I need a thing from the host."
Reject: "Contact Support" as the only action. At a door, support is the host standing
twenty feet away.

**[Mixpanel — You need permission](https://mobbin.com/screens/8bc4ab67-6d62-4d1e-944c-05bc5bff956b)**
Take: the two-cause fork in one screen — no access **or** wrong account — with the
signed-in identity boxed underneath. That distinction is what our gate must make.
Reject: a disclaimer explaining the company's support policy at the moment of failure.

**[Whereby — The host did not grant you access](https://mobbin.com/screens/98b1c0c3-5648-48e9-b8e0-0ca5f79e56bd)**
Take: the plainest language of the set and the right mental model for an event — **the
host** did or did not do something. Not "permissions", not "403". Steal the register.
Reject: a 280px card of 11px text in a field of green, with no action. Right words, wrong
everything else.

**[Binance — Login status expired](https://mobbin.com/screens/7dd9f150-2138-436e-bc8a-5f2e47cff09c)**
Take: the dialog sits over the login screen it is sending you to, so dismissing it lands
you where you need to be.
Reject: the error code `(006007)` and the button label "I understand." A code is noise to
a volunteer; "I understand" is an acknowledgement, not an action.

**[Grab Driver — session timed out mid-scan](https://mobbin.com/screens/72a2bfdf-7284-4013-be4a-b5273abb439d)**
Take: our exact scenario — session dies while the camera is up, and the alert lands over
the live scan view rather than navigating away. Context preserved.
Reject: "Please try again" never says whether the in-flight scan went through. That
ambiguity is F1 in another costume.

**[folk — could not authenticate, wrong browser](https://mobbin.com/screens/52557853-0b2e-4151-89e9-05ff86d08d58)**
Take: the only reference naming the **in-app-browser / magic-link mismatch** — precisely
what happens when a host texts the scanner link.
Reject: a 170px sticky note on a blank page with an underlined link as the only recovery.
Right diagnosis, unusable delivery.

**[Qatalog — Sorry about that](https://mobbin.com/screens/247a4a2e-f99b-40c4-9b20-468ad9323ebd)**
Take: it lists the actual admin emails as links. Our analogue is the host's name — the
person who can fix this is standing nearby, and naming them turns a dead end into a
ten-second walk.
Reject: a 96px apology over 11px body text, and it conflates missing / unavailable / no
permission into one message.

## Gaps, stated plainly

- **Amber / no-verdict cards do not exist as prior art.** Every "indeterminate" screen
  found is an ID-verification retry or a network-error page — none is *a transaction
  outcome we could not determine*. This has to be designed, not copied.
- **Nobody shows a duplicate-scan verdict with the original check-in time.** Luma has the
  timestamps and Co-Star has the rejection banner; no reference combines them.
- **Web camera-permission handling is bad across the board.** One web example surfaced
  and it is a counter-example. Every good camera panel is a native app calling a system
  settings deep link we do not have. The iOS Safari `aA → Website Settings → Camera`
  instruction has no precedent here and **needs verifying on a real device before the
  19th**.
