# Attendee roster search

The organizer roster accepts a trimmed, case-insensitive search for attendee names, guest names, canonical account usernames (with or without a leading `@`), canonical profile full names, and ticket-ID prefixes. Existing QR-token prefix lookup remains supported. `%`, `_`, backslashes and punctuation are literal input, not wildcard/filter syntax. Unicode case matching preserves accents: an accented name may be searched with its accents; no database extension or transliteration policy is introduced. Queries are limited to 200 characters. No email-address search is added.

The read-only `search_event_tickets` RPC repeats event ownership/accepted organizer authorization. Only service_role can execute it, and the authenticated Edge handler supplies the session identity—not an arbitrary client-provided actor. Matches are restricted to this event before existing exact counts, status filters, sorting and pagination. There is no first-page client filtering, global profile search, large ticket-ID URL list, table mutation or new data exposure.

Scanner search is deliberately narrower: only the holder name already displayed to that role, ticket IDs and legacy QR prefixes. An attendee-name override does not permit probing a hidden guest/account/profile name. The existing scanner response projection remains unchanged and excludes guest emails, purchase amounts and payment references. Organizers retain their existing row projection; the search does not add private fields to it.

Web and native share the same API. Search is debounced, cleared explicitly, and combined with status filters. Filtered counts are labeled matching tickets, not event-wide attendance. Event/account switches reset local roster state and use account-scoped cache keys; old pending responses cannot replace a different event/account roster. Errors are shown as errors with retry, not as an empty successful result. Native display now uses the existing authorized holder/username fields instead of falling straight back to a ticket ID.

## Verification and release scope

Tests cover names/handles/IDs, literal metacharacters, missing profiles, accented case matching, server filtering and exact counts above 1,000 rows, role isolation, actual Edge request behavior, and mounted web/native search transitions. SQL tests use a disposable socket-only PostgreSQL server and cannot silently skip.

Release components: the read-only RPC migration, the reviewed `get-event-tickets` closure, and web merge/deployment. The live v40 entrypoint and both dependencies matched the baseline byte-for-byte during preflight; unrelated auth/cancellation behavior must remain unchanged. No ticket/attendee mutations, email sends, credential changes, new privileges for clients, or data backfill are included. Native source changes ship through the normal native release path; no binary/OTA release is implied.
