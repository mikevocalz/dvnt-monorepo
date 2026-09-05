# Watch Events evidence — 2026-09-05

Events now use authorized event relationships independently of tickets: auth-ID-keyed RSVPs, invitations and waitlists, integer-ID saved likes, plus hosted events. The phone publishes a bounded 60-event snapshot with canonical dates, venue time zone, image rendition, explicit RSVP/invitation/waitlist state and ticket availability. Native Apple Events has grouped navigation, detail, venue/local dates, Maps, existing ticket detail links, confirmed state commands and phone continuation. Wear parity is integrated separately.

Sources: `events.ts`, `20260301_events_ticketing_v2.sql`, `20260806100600` waitlist offer migration, `event-waitlist`, `rsvp-issue-ticket`. Ticket visibility is `tier_visibility`; sold-out eligibility fails closed when the bounded tier result may be truncated. Invitations remain distinct from RSVP. No unsupported approval or invitation-acceptance semantics are invented. Ticketed RSVP, invitation completion and waitlist offer claims continue on the phone.

Commands carry generation, UUID operation identity and a 30-second expiry. A phone-persisted ledger records pending before mutation and refuses automatic repetition after uncertainty. Current viewer is rechecked around identity/token awaits and before writes. Native success appears only after matching confirmed result; offline/timeout remain unconfirmed. Account reset persists an empty scoped snapshot and retired generation history. Refresh errors retain the last snapshot.

Validation:

- `node --import tsx --test packages/app/features/watch/watch-event-payload.test.ts`: 4/4 passed (independent invitation, sold-out eligibility, saved/RSVP/offer distinctions, rendition safety, command scope/expiry).
- `node_modules/.bin/tsc --project packages/app/tsconfig.json --noEmit`: exit 0.
- `xcrun swiftc apps/mobile/targets/watch/EventModels.swift apps/mobile/targets/watch/EventStore.swift scripts/watch-events-check/main.swift -o /tmp/dvnt-watch-events-check -parse-as-library && /tmp/dvnt-watch-events-check`: passed invitation independence, cached error, truthful offline command, account reset/restart/retired replay and snapshot ordering.
- Environment agent completed linked `DVNTWatch` target build including Events model/store/detail/App integration; no physical device event mutation was executed.

Limits: bounded snapshot, no pagination for the full event archive; no production mutation tests; existing RSVP API is a read/update-or-insert flow without newly introduced uniqueness guarantees. Durable operation identity prevents replay of the same watch operation, but simultaneous independent phone/watch RSVP operations still inherit that existing API behavior. Maps, wrist layout, phone foreground continuation and real RSVP/waitlist delivery require device acceptance. This evidence does not establish release completion.

## Now and venue weather enrichment

Now falls back to the nearest active event relationship when there is no upcoming ticket, including invitations without a ticket. The CTA opens the same current EventStore detail and displays event snapshot freshness.

Venue weather uses the existing Live Surface API, solely with coordinates already present in an authorized event row. No watch/phone location lookup is added. A memory-only generation-scoped cache permits one focused venue request in 15 minutes, including concurrent loads and changed focus. Optional weather never delays the event snapshot beyond an eight-second response budget; failed/unavailable weather is omitted. The existing API accepts an optional caller scope callback checked after its token await and before HTTP. Results recheck the current account. Native detail labels Fahrenheit and the actual API generated timestamp rather than presenting it as forecast weather at the future event time. Wear consumes the same optional fields.

`node --import tsx --test packages/app/features/watch/watch-event-weather.test.ts`: 3/3 passed for concurrent/rate-bound requests, no request without eligible published coordinates, and account-change suppression. Standalone Swift Events checks still pass after adding the optional weather model. Physical map/weather display remains acceptance work.
