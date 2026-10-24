# Nearby member avatars and location controls

Settings → Privacy has separate Overall location and Events map visibility controls. Both default off. OS/browser permission is not public-sharing consent. Legacy city/proximity consent never enables identifiable pins.

Events keeps its existing venue Google embed and adds People mode. Verified adults with public profiles explicitly share a roughly1km cell for up to one hour. Observations expire within15minutes; foreground updates only. This is not event attendance or private-event guest discovery.

Events off revokes server presence and increments revision; Overall off also stops other device collectors and legacy proximity, clears device-derived caches and prevents Places IP inference. IP inference requires explicit allowIpBias:true; older clients omitting it receive unbiased results. Manual city selection remains available. Failed withdrawal shows a retry warning, never silent success.

## Security
Service-only RLS tables and invoker RPCs; independent versioned consent; expiry and revision checks; current adult, private-account, ban and moderation gates; bilateral blocks. Publish/revoke serialize on settings row. Nearby centers on the viewer's own fresh consented cell, bounded50km/100members. No event/RSVP joins. Old responses cannot be erased from a viewer's memory; clients refresh quickly and suppress expired/error responses.

## Release prerequisites — not performed
- Review/approve migration and edge deployment on existing Supabase project. Existing20261002165000_member_proximity_presence.sql is a prerequisite. New migration intentionally gates legacy publication behind new Overall opt-in.
- Configure a separately approved browser-restricted Google Maps JavaScript API key as NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Never expose/reuse the server Places key. Restrict approved DVNT referrers/API/billing quotas. Read-only Vercel dvnt-blog metadata October24:31vars, hidden count0, no Google key entry. Existing keyless venues and server Places are independent, not broken by this missing interactive configuration.
- Missing/failed web provider means honestly unavailable People map and no collection; venue map stays usable.
- Native uses existing expo-maps/expo-image; physical iOS/Android verification and native release remain required.
- Synthetic-account acceptance: deny permission, private/blocked/underage, remote disable, failed revoke/retry, expiry, background/account switch. No production user coordinates as fixtures.

## Verification
Focused SQL/edge/policy/browser tests plus existing Events regression. Fixtures do not prove live Google configuration or physical native behavior. Full workspace typecheck and CI required before readiness. No live migration, credentials or deployment in this draft.

## Withdrawal recovery
Only owner-scoped negative withdrawal intent is persisted, never coordinates or positive consent. Failed withdrawal stays locally off across settings-fetch failures, reload and account changes until a confirmed explicit mutation. Persistence errors must not prevent emergency server revoke; the UI warns to keep the app open and retry if local durability fails. If both local persistence and server withdrawal fail, overall device-location preferences cannot be guaranteed after restart. Avatar GPS additionally requires explicit consent or Update my location once per session/account; fetched server-on settings and an existing OS grant alone do not restart avatar updates.
