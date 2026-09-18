# 04 — Copy

Every user-facing string in the door scanner, in one table.

Rules applied to every row: **≤2 lines**; says what happened **and** what to do next; and
every no-verdict string states the ticket was **not** checked in.

Verdict semantics are fixed and non-negotiable:
**green = admitted · red = the server rejected it · amber = we could not reach a decision.**

## Scan screen

| id | context | string | why |
|---|---|---|---|
| `scan.title` | Header | Scan tickets | Names the job, not the tech. No "QR", no "scanner". |
| `scan.hint.idle` | Under frame, nothing detected | Hold the guest's QR code inside the frame. | Says where to point. "Guest's" stops staff scanning their own screen. |
| `scan.hint.dark` | Ambient light low, torch off | It's too dark to read codes. Tap Light. | Diagnoses F6 before it wastes a guest. Names the control by its label. |
| `scan.starting` | Camera initialising | Starting camera… | The only string permitted before a feed exists. |
| `scan.torch.off` | Torch button, off | Light | Labelled, not glyph-only. |
| `scan.torch.on` | Torch button, on | Light on | State in the label, so no toggle-twice. |
| `scan.zoom` | Zoom stepper | 1x · 2x | Discrete stops for arm's-length presentation. |
| `scan.manual` | Fallback, always visible | Can't scan? Type the code | Question then action. Never scrolls away (S6). |
| `scan.list` | Mode toggle | Guest list | Plain noun. The other half reads "Scan". |
| `scan.progress` | Above the frame | {n} in · {m} still outside | "Still outside" is the number a door wants. |
| `scan.offline` | Persistent bar, no connection | Offline — scans won't go through. Get signal before you scan. | Prevents a queue of amber cards. Preventive, not reactive (H5). |
| `scan.reconnected` | Signal restored, 3s toast | Back online. Scanning works again. | Closes the loop the offline bar opened. |

## Manual code entry

| id | context | string | why |
|---|---|---|---|
| `manual.title` | Header | Type the ticket code | |
| `manual.help` | Under field | It's the {n} characters printed under the QR code. | Tells them where to look. |
| `manual.field.label` | Input label | Ticket code | |
| `manual.submit` | Primary | Check this code | Verb + object. Not "Submit". |
| `manual.back` | Secondary | Back to camera | One tap back to scanning (S7). |
| `manual.empty` | Submitted blank | Enter the code first, then tap Check this code. | Names the control it expects. |
| `manual.toolong` | Over expected length | That's too long for a ticket code. Check for extra characters. | Prevents a pointless round-trip. |

## Verdict — green (admitted)

| id | context | string | why |
|---|---|---|---|
| `verdict.ok.title` | Card heading | Admitted — let them in | Verdict word first for the screen reader, instruction second for the human. |
| `verdict.ok.body` | Under heading | {name} · {tier}. Checked in just now. | Name is what staff match to the face. "Just now" binds the card to *this* scan (F3). |
| `verdict.ok.undo` | Secondary | Wrong person? Undo check-in | Undo sits where the confirm was, phrased as the case it covers. |
| `verdict.ok.next` | Primary | Next guest | Moves the queue. Not "OK" or "Done". |

## Verdict — red (server rejected)

Every red string carries a server `reason` code. No client path may render red (S2).

| id | context | string | why |
|---|---|---|---|
| `verdict.dupe.title` | `already_checked_in` | Already scanned — don't let them in yet | "Yet" leaves room for a host override. |
| `verdict.dupe.body` | | {name} was checked in {relative_time} at this door. Get the host. | Relative time settles the argument. Names who resolves it. |
| `verdict.refund.title` | `refunded` | Refunded — don't let them in | |
| `verdict.refund.body` | | This order was refunded on {date}. Send them to the host. | |
| `verdict.cancel.title` | `cancelled` | Ticket cancelled — don't let them in | |
| `verdict.cancel.body` | | The host cancelled this order. Send them to the host. | Names the actor so the guest argues with the right person. |
| `verdict.wrongevent.title` | `wrong_event` | Wrong event — don't let them in | |
| `verdict.wrongevent.body` | | This ticket is for {event_name}. Send them to the host. | Naming the other event usually ends it on the spot. |
| `verdict.notfound.title` | `not_found` | Not a ticket for tonight | No "invalid" — it may be a real ticket for elsewhere. |
| `verdict.notfound.body` | | This code isn't in tonight's list. Look them up by name instead. | Routes straight to the recovery path. |
| `verdict.red.lookup` | Secondary, every red | Look up by name | One tap to the guest list (S7). |
| `verdict.red.next` | Primary | Next guest | Same position and label as green. Muscle memory survives the verdict. |

## Verdict — amber (no verdict)

Every string opens with **"Not checked in"**. The ticket's state is the first fact.

| id | context | string | why |
|---|---|---|---|
| `verdict.amber.offline.title` | No connection at scan time | Not checked in — no signal | State first, cause second. |
| `verdict.amber.offline.body` | | We couldn't reach the server, so nothing changed. Move to signal and scan again. | "Nothing changed" is the sentence that prevents F1's damage. |
| `verdict.amber.timeout.title` | Timed out | Not checked in — the server didn't answer | Explicitly not a rejection. |
| `verdict.amber.timeout.body` | | Nothing changed. Scan the same code again. | Reuse the code; do not send the guest away. |
| `verdict.amber.decode.title` | Unreadable code | Not checked in — couldn't read that code | Blames the code, not the guest. |
| `verdict.amber.decode.body` | | Ask them to raise their brightness, then scan again. Or type the code. | The single highest-yield fix at a dark door. |
| `verdict.amber.error.title` | 5xx / unexpected | Not checked in — something broke on our side | Owns the fault. |
| `verdict.amber.error.body` | | Nothing changed. Scan again, or type the code. | |
| `verdict.amber.session.title` | Session died mid-scan | Not checked in — you were signed out | Resolves the Grab Driver ambiguity explicitly. |
| `verdict.amber.session.body` | | Nothing changed. Sign in again, then scan this guest. | "This guest" keeps the current person in scope. |
| `verdict.amber.retry` | Primary | Scan again | |
| `verdict.amber.manual` | Secondary | Type the code instead | The escape from a camera that keeps failing. |

## Camera issue panel

| id | context | string | why |
|---|---|---|---|
| `cam.denied.title` | Permission denied | Camera is blocked | Blocked, not "unavailable" — names a thing someone did. |
| `cam.denied.body` | | Tap **aA** in the address bar → Website Settings → Camera → Allow. Then reload. | The actual iOS Safari keystrokes. A fake "open settings" button does nothing on web. |
| `cam.denied.action` | Primary | Reload page | |
| `cam.inapp.title` | In-app webview | Open this in Safari | |
| `cam.inapp.body` | | The camera can't start inside Instagram or Messages. Tap ••• then Open in Safari. | Names the apps the host actually sent the link through (F4). |
| `cam.inapp.action` | Primary | Copy link | The only thing the page can do from inside a webview. |
| `cam.busy.title` | Camera in use | Another app is using the camera | |
| `cam.busy.body` | | Close FaceTime or the Camera app, then tap Retry. | Names the two likely culprits. |
| `cam.busy.action` | Primary | Retry camera | |
| `cam.engine.title` | Decoder failed to load | Scanner didn't load | |
| `cam.engine.body` | | Reload the page. If it fails again, type codes — that still works. | Reassures that the door is not down. |
| `cam.insecure.title` | Non-HTTPS origin | Camera needs a secure link | |
| `cam.insecure.body` | | Open the https:// link the host sent. Type codes until then. | |
| `cam.none.title` | No video input | No camera on this device | |
| `cam.none.body` | | Use a phone with a camera, or type codes here. | Correct for the laptop door. |
| `cam.fallback` | Every camera panel | Type codes instead | Standing second path. Same label everywhere (3.2.6). |
| `cam.back` | Every camera panel | Back to guest list | Guarantees no dead end (S7). |

## Guest list + manual check-in

| id | context | string | why |
|---|---|---|---|
| `list.title` | Header | Guest list | |
| `list.search` | Search placeholder | Search a name, or the ticket code | **Corrected from "Search name, email, or code".** A scanner-role caller never receives an email (`get-event-tickets/index.ts:404-411` withholds it), and the server's own search matches `qr_token` PREFIX only — its comment says name search "is left for a follow-up" (`:284-290`). Name search works because the roster is fetched whole and filtered client-side, which caps the list at the server's 200-row clamp (`:262`). |
| `list.chip.all` | Filter chip | All {n} | Count trails the label. |
| `list.chip.in` | Filter chip | Checked in {n} | |
| `list.chip.out` | Filter chip | Not in yet {n} | Neutral, not a judgement. |
| `list.chip.flagged` | Filter chip | Needs host {n} | The bucket for anything a scanner can't resolve alone. |
| `list.row.action` | Trailing, not checked in | Check in | Actionable from the row, no drill-in. |
| `list.row.done` | Trailing, checked in | In · {relative_time} | Two words. Scannable down the column. |
| `list.row.undo` | Overflow on a checked-in row | Undo check-in | The recovery Partiful lacks (H3). |
| `list.row.tier` | Under the name | {tier} | Tier drives the door's next move. |
| `list.checkin.pending` | In flight | Checking in… | |
| `list.checkin.failed` | Write failed | Not checked in — that didn't save. Tap Check in again. | Amber semantics in the list, same opener. |
| `list.empty.search` | No matches | Nobody matches "{q}". Try their email, or fewer letters. | Two concrete retries. |
| `list.empty.filter` | Filter empty | No one in {filter}. Tap All to see everyone. | Names the filter and the exit. |
| `list.loading` | Initial fetch | Loading tonight's guests… | |
| `list.error` | Fetch failed | Couldn't load the guest list. Tap Retry — scanning still works. | Tells them the door isn't down. |
| `list.stale` | Cache >5 min | List loaded {n} min ago. Pull down to refresh. | |
| `list.offline` | No connection | Offline — this is the last loaded list. Check-ins won't save until signal returns. | Prevents phantom check-ins the server never saw. |

## Gate / access denied

| id | context | string | why |
|---|---|---|---|
| `gate.expired.title` | Session expired | You've been signed out | |
| `gate.expired.body` | | Sign in again to keep scanning. Nothing you already scanned was lost. | The second sentence stops the panic about the last 40 guests. |
| `gate.expired.action` | Primary | Sign in | An action, not "I understand". |
| `gate.notstaff.title` | Authed, not door staff | You're not on door staff for this event | Names the exact role. |
| `gate.notstaff.body` | | Ask the host to add {email}, then reload this page. | Shows which account is being refused — usually the whole problem. |
| `gate.notstaff.action` | Primary | Reload | |
| `gate.notstaff.alt` | Secondary | Sign in as someone else | The other half of the two-cause fork. |
| `gate.identity` | Static, every gate | Signed in as {email} | Lets a volunteer self-diagnose the wrong-account case. |
| `gate.host` | Static, every gate | Tonight's host: {host_name} | The person twenty feet away who can fix it. |
| `gate.offline.title` | Can't verify, no connection | Can't check your access offline | |
| `gate.offline.body` | | We can't confirm you're door staff without signal. Get signal, then tap Try again. | Amber logic for the gate: no verdict, not a refusal. |
| `gate.offline.action` | Primary | Try again | |
| `gate.wrongevent.title` | Link for another event | This link is for a different event | |
| `gate.wrongevent.body` | | Ask the host for tonight's scanner link. | |
| `gate.browser.title` | Auth failed, webview | Open this link in Safari | |
| `gate.browser.body` | | Sign-in can't finish inside Instagram or Messages. Tap ••• then Open in Safari. | The folk diagnosis, delivered usably. |
