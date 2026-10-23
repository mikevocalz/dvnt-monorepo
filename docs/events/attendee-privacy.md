# Protected event attendance

Only canonical `sex_party` events or events linked through `lynk_room_id` are
protected by default. An unlinked Virtual Session, an NSFW flag, a title, or
another adult event type does not opt an event into this policy.

`events.show_attendees` is an organizer-controlled boolean. Only `true` opens a
protected event's social attendee list; `false`, `NULL`, and pre-feature records
remain hidden. The owner and accepted admin/editor can change the setting.
Ordinary events retain their prior behavior and do not retain a latent opt-in.
Duplicating an event starts with a new, off attendance choice.

When enabled, protected lists still require the authenticated viewer to be the
host, an accepted co-organizer, an attendee with a going RSVP, or a holder of an
active/scanned ticket. Existing event visibility continues to apply. Anonymous,
nonattending, and pending co-organizer callers cannot use the opt-in as an access
bypass. Counts, ticket tiers, personal tickets/RSVP state, and separately authorized
organizer management remain available.

## Covered boundaries

- Direct avatar and paginated attendee RPCs, event-detail embedded avatars.
- Both discovery home overloads and personalized event results. Friend-attendance
  counts and their scoring contribution are suppressed when the list is hidden.
- Direct RSVP reads under a restrictive policy, preserving self and authorized
  manager access even while the social list is hidden.
- Service-role bootstrap responses, using verified session identity and explicit
  attendance checks rather than a caller-supplied viewer ID.
- Native/web event details, native card previews, paged-store late responses,
  optimistic/realtime caches, and persisted native query cache invalidation.

## Release ordering (not performed by this change)

This PR contains migration source only. Do not consider production protected
until both database and Edge Function changes are released and verified.

1. Release `bootstrap-events` and its shared helper first. It is compatible with
   the pre-column schema and treats a missing setting as off for protected types.
2. Review and apply `20261023231057_sensitive_event_attendee_privacy.sql` through
   the normal migration process. Unexpected existing RPC-definition drift aborts
   the transaction rather than replacing an unknown function body.
3. Release `create-event` and `event-drafts`, then web/native clients. Creation
   writes the new column, so its new server implementation needs the migration.
4. Verify the anonymous/attendee/organizer matrix in a non-production fixture and
   perform authorized read-only production verification. Do not create live RSVP
   or ticket fixtures as part of verification.

The migration changes no existing attendance or ticket rows, acceptance statuses,
financial data, or counter-maintenance behavior. Never revert to the old backend
identity responses as a casual rollback; preserve a closed privacy boundary.

## Offline verification

The dedicated GitHub Actions workflow installs isolated pinned fixture tools.
`test-event-attendee-privacy-sql.cjs` runs published repository RPC bodies and the
actual migration against synthetic PostgreSQL/PGlite rows. Bootstrap tests run
the actual handler. Organizer tests mount web controls and DOM-adapted native
controls and execute real stores. These are not physical-device acceptance tests.
