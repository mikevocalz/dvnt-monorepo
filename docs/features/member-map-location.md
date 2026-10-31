# Nearby member avatars and location controls

Settings → Privacy has separate Overall location and Events map visibility controls. Both default off. OS/browser permission is not public-sharing consent. Legacy city/proximity consent never enables identifiable pins.

The Events map combines venue flyers and member avatars. Eligible adults with public profiles explicitly share an approximately 1 km cell for four hours. Observations expire within 15 minutes; foreground updates only. This is not event attendance or private-event guest discovery.

Events off revokes server presence and increments revision; Overall off also stops other device collectors and legacy proximity, clears device-derived caches and prevents Places IP inference. IP inference requires explicit allowIpBias:true; older clients omitting it receive unbiased results. Manual city selection remains available. Failed withdrawal shows a retry warning, never silent success.

## Security
Service-only RLS tables and invoker RPCs; independent versioned consent; expiry and revision checks; current adult, private-account, ban and moderation gates; bilateral blocks. Publish/revoke serialize on settings row. Nearby centers on the viewer's own fresh consented cell, bounded 50 km / 100 members. No event/RSVP joins. Old responses cannot be erased from a viewer's memory; clients refresh quickly and suppress expired/error responses.

## Release prerequisites — not performed
- Review/approve migration and edge deployment on existing Supabase project. Existing20261002165000_member_proximity_presence.sql is a prerequisite. New migration intentionally gates legacy publication behind new Overall opt-in.
- Configure a separately approved browser-restricted Google Maps JavaScript API key as NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Never expose/reuse the server Places key. Restrict approved DVNT referrers/API/billing quotas. Read-only Vercel dvnt-blog metadata October24:31vars, hidden count0, no Google key entry. Existing keyless venues and server Places are independent, not broken by this missing interactive configuration.
- Missing/failed web provider means honestly unavailable People map and no collection; venue map stays usable.
- Native uses existing expo-maps/expo-image; physical iOS/Android verification and native release remain required.
- Synthetic-account acceptance: deny permission, private/blocked/underage, remote disable, failed revoke/retry, expiry, background/account switch. No production user coordinates as fixtures.

## Verification
Focused SQL/edge/policy/browser tests plus existing Events regression. Fixtures do not prove live Google configuration or physical native behavior. Full workspace typecheck and CI required before readiness. No live migration, credentials or deployment in this draft.

## Withdrawal recovery
Only owner-scoped negative withdrawal intent is persisted, never coordinates or positive consent. Failed withdrawal stays locally off across settings-fetch failures, reload and account changes until a confirmed explicit mutation. Persistence errors must not prevent emergency server revoke; the UI warns to keep the app open and retry if local durability fails. If both local persistence and server withdrawal fail, overall device-location preferences cannot be guaranteed after restart. Active, unexpired server sharing consent can resume foreground updates when OS permission is already granted. Passive refresh never requests OS permission or renews the sharing grant.

## Explicit map permission flow (draft)

Opening the ready Events map offers an optional disclosure before requesting OS/browser location. “Share my location” requests a fresh foreground fix, then records a four-hour grant and publishes only the existing approximately 1 km cell. No separate Settings toggle is required. Existing device permission is not public-sharing consent. Not now dismisses the offer with an account-scoped seven-day cooldown; a manual share entry remains. Expired grants are not automatically renewed or automatically prompted again.

Stop sharing remains directly on the map. Permission denial/revocation stops publication and attempts server withdrawal, with a visible retry warning if withdrawal cannot be confirmed. Account changes, cancellation and obsolete callbacks cannot publish a later location; interrupted writes are compensated or recorded as a durable negative withdrawal intent. This is code only: no deployment, migrations, or live-user location changes are part of this change.
