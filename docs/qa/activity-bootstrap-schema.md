# Activity bootstrap schema correction (draft)

Scope: `bootstrap-notifications` response correctness only. No deployment,
identity mapping, RLS, grants, credentials, bridge enforcement, backfill or
notification resend is included.

- Select the existing notifications `entity_payload` JSONB column instead of
  nonexistent `content`. Keep comment text from the comments lookup.
- Preserve payload and event identity/title for transfer, comp and other
  event-typed notices, not only event invitations/updates.
- Return 503 when notification rows or unread-count queries return errors;
  do not disguise a failed query as a successful empty feed. Thrown errors retain
  500 and use generic response/log copy rather than raw exception details.
- Apply the existing shared wildcard CORS_HEADERS constant consistently to POST
  and OPTIONS responses; advertise only POST/OPTIONS. Preserve the existing
  wildcard preflight policy for legacy preview origins; no origin allowlist or
  credentials change. Use `no-store` so these
  personalized snapshots/errors do not become stale browser responses.

The verified-session call, canonical `users.auth_id` lookup, integer recipient
filters, and existing 401/404 outcomes are unchanged. No re-authentication,
verification prompt or legacy-account migration is introduced. The request
limit behavior is also unchanged.

Tests execute the actual handler and actual shared CORS_HEADERS constant against a
schema-shaped persistence fixture: `notifications.entity_payload` exists,
`notifications.content` does not, actor FK uses `notifications_actor_id_fk`.
This is an isolated fixture based on inspected metadata, not a live database
integration or device test. Twelve checks cover all transfer states, comps,
broadcast event context, session-only recipient scoping, failures, native/web
wildcard CORS and preflight. Existing static edge configuration verification also passes.

This endpoint remains an optional bootstrap. The separate client fix must keep
canonical badge data independent and refuse late bootstrap overwrite of activity
history/read state. Do not substitute this patch for held privacy enforcement.
