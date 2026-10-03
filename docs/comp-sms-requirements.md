# Phone comps: why DVNT does not send SMS

A host can comp a ticket to a phone number. DVNT never sends the text. The
server issues the ticket and a single-use claim link, and the host's own phone
sends it from the host's own number through the system Messages composer.

This replaces an earlier plan built on a paid SMS provider (Twilio, or Better
Auth's paid SMS add-on). That plan needed all of the following before it could
ship, and none of it is needed when a person texts a person:

- A sending account with a registered A2P 10DLC brand and campaign, or a short
  code. Unregistered 10DLC traffic is filtered by US carriers.
- A per-recipient consent record. A host typing a number into a comp box is not
  consent from the recipient for DVNT to text them.
- Inbound STOP, START and HELP handling, and a suppression list checked before
  every send.
- A public delivery-receipt webhook and a retention sweep for what it stores.
- Per-recipient spend caps on top of the comp rate limit.

When the host sends the message, the host is the sender. DVNT stores no
message, no delivery status and no consent state, because it took no part in
the send.

## What the claim link has to guarantee

The earlier plan wanted a one-time code texted to the same number, because a
bare link can be forwarded or read on a shared phone. The current design
answers that differently:

- The link is single use. The first account to claim it owns the ticket; any
  other account that opens it afterwards is refused.
- Claiming needs a Better Auth session, so the ticket lands on a named account,
  and the account has to pass the same verified-admission check as a buyer.
- The token is 32 random bytes. The database keeps only its SHA-256 hash, so a
  database read cannot produce a working link.
- The link expires when the event ends, or 30 days after it was issued if that
  comes first.
- Until someone claims it, the host can comp the same number again. That
  replaces the token on the same ticket, so the old link stops working and no
  second seat is taken.

What this does not cover: if the text reaches the wrong person and they claim
first, the ticket is theirs. The host's remedy is to void that ticket and comp
the number again. A code sent to the number would close that gap, but it needs
the paid sender this design removes.

See `docs/workstreams/07-comp-sms-delivery.md` for the flow and the files.
