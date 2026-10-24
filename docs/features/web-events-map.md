# Web Events map

The Map button beside Events search switches between the normal list and a venue
map. Search, tabs, filters, and spicy-content preferences use the same filtered
results in both views. Choose an event in the map's selector to show its venue;
View event opens the stable numeric public event route. Back retains map mode
and the selected event. List view or Escape returns to the normal results.

## Provider and scope

This reuses the existing event-detail Google Maps iframe, without a new provider,
Google JavaScript API key, geocoder, billing configuration, or schema change.
It displays **one selected event venue**, not all events as simultaneous custom
pins. It does not show people, attendees, or device location and never requests
geolocation. Native map behavior is unchanged.

## Privacy and freshness

Only stable IDs from the current filtered results are looked up. The narrow
metadata query excludes private/unlisted, hidden, future-published, inactive,
and virtual/online events before coordinates leave Supabase. A second
fail-closed guard requires complete policy metadata and finite, valid saved
coordinates (zero is valid). Events without valid saved coordinates remain in
the normal list but have no map selection; no automatic geocoding is performed.

Metadata is not persisted or shared with detail/attendee caches. Known
restrictive list changes remove eligibility immediately. Received event
updates/deletions cancel old map reads, synchronously remove the changed venue,
and refetch fresh admitted metadata. A 30-second refresh and window-focus
refresh provide fallback freshness. No real-time system can retroactively hide
a location that was public when a viewer previously received it.

The iframe uses the same Google endpoint/referrer policy as event detail. Since
cross-origin iframe content cannot be inspected reliably by the app, a load
event is not treated as proof that Google rendered successfully. Reload map,
Open in Google Maps, the event selector, and List view remain available.

## Verification

- `node --test packages/app/lib/events/event-map.test.ts`
- `node scripts/test-web-event-map-browser.cjs`
- `pnpm --filter web typecheck`

The browser regression uses the actual Events screen, store, map component and
production styling with synthetic API/iframe fixtures. Live-provider readiness
must be checked separately; a mocked iframe is not production-provider evidence.
