# 06 — Critique against Luma, Meetup, Posh, DICE

What the door flows those products ship do better, and what changed here as a
result. Only changes that were actually made are listed.

## Changed because of the critique

**Luma keeps the camera live through a green.** Its post-scan pill lands in the
header while the frame stays ready, so the scanner never leaves scan mode for a
success. Ours pauses decoding behind a verdict but keeps the stream alive, so
resuming costs nothing — `paused` feeds `onBarcodeScanned={undefined}`, which
stops expo-camera's loop without tearing down `getUserMedia`.

**Luma's counts live on the filter itself.** "Going 3 · Checked In 1 · Not
Checked In 2" makes the tally and the filter one object, which cannot disagree.
Ours does the same, and goes further: the progress bar reads the same query key
as the list, so a bar saying 40 over a list showing 41 is not expressible.

**Posh shows how many are left, not how many are done.** "of 1 (0 left)" answers
"are we nearly through?" without arithmetic. Ours reads "**{n} in · {m} still
outside**". Posh puts it on an overview screen the scanner never sees; ours is
above the frame.

**Partiful checks in from the row.** Luma shows check-in state but makes you
drill in to act on it — two extra taps per fallback guest. Ours has the action
in the row, with two visually distinct trailing states in the same column
position so the column can be read straight down.

**Luma's duplicate shows the original time.** "Checked In · 19 min ago" is a
fact a guest can respond to; "already scanned" alone is not. Ours shows the
original check-in time at 40px, plus the date and who scanned it.

## Rejected, with reasons

**Luma's auto-dismissing header pill.** Small, out of the thumb zone, and gone
before a staffer who looked away can read it. Ours is a card that stays until
dismissed. The stale-card risk that creates is handled by pausing the decoder
behind it, not by making the verdict disappear on a timer.

**Meetup's List|Scan in the header.** The most-used toggle belongs in reach.
Ours is directly under the progress bar, in the thumb zone.

**DICE and Eventbrite's assumption of signal.** Both treat a failed request as a
failed ticket. That assumption is the single worst bug in this class, and the
whole amber verdict exists to refuse it. A scan that got no answer says nothing
about the ticket, and the card says so in words before it says it in colour.

**Every reference's "Follow Back"-style mixed labels.** Action words and state
words in one control read as neither. The verdict title is a state; the buttons
under it are actions.

## Still worse than the references

**No undo on a check-in from the list.** Luma flips its primary to "Undo Check
In" in the same position. Ours has no undo at all, because no server operation
reverses a check-in — every edge function touching `checked_in_at` only reads
it. Adding one two days before a door, next to the functions the brief marks
do-not-touch, is a worse risk than the gap. A mis-tap is corrected by the host,
out of band. See 08-code-review.md.

**The guest list caps at 200.** The server clamps `pageSize` to 200 and its
search matches `qr_token` prefix only, so name search required fetching the
roster whole. Luma and Meetup page server-side with name search behind it. Ours
says so on screen rather than silently truncating, but it is a ceiling the
references do not have.
