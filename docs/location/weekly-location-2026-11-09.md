# Weekly location improvements

## Implemented
- Feed and profile distance badges use identical labels. Exact distances render to two decimal places, e.g. `(0.01 miles away)`, only when both eligible adult members explicitly accept new v2 precise-distance sharing. Legacy permissions remain coarse; neither map consent nor device permission opts into precise distance.
- The exact-distance disclosure explains that repeated readings can reveal precise location. Coordinates remain server-private, snapshots expire within fifteen minutes of the original provider observation, and displayed responses expire within thirty seconds or sooner with either grant/session. Exact consent has its own Stop/retry control and durable failed-withdrawal state. Invalid, mismatched or expired v2 presence returns no distance at all; coarse bands are available only from two independently valid legacy points.
- Precise publication requires a fresh original provider timestamp (at most 60 seconds old, at most 5 seconds ahead), bound locally to the sampling account/sign-in. Provider proof is never persisted. Explicit exact consent obtains a fresh device sample before granting; reconsent/city changes cannot refresh an old sample. Edge and SQL guards reject missing, ancient, future and replayed observations and cap retention to observation +15 minutes.
- Home/Events offer an optional map-location agreement once per verified sign-in. Accepting v2 shares the avatar and approximately 1-km area until that sign-in ends or reaches its original server expiry, replacing the four-hour cap for fresh agreements only. Token refresh does not extend a grant. “Not now” does not sample or enable location.
- Sign-in IDs are verified from the current authenticated session, never accepted from a client without matching. Session expiration/revocation is checked on map reads/publishes and precise distance reads/publishes. Successful server session deletion removes associated location sharing.
- Local sign-out immediately stops writers and attempts account-bound server withdrawal before credentials are cleared. Failed withdrawal remains a negative preference. Offline sign-out can leave the last location visible for up to fifteen minutes; both disclosures explain this limit.
- “Near You” ranks up to ten already-public venues within about 25 miles of a fresh consented approximate area and lists nearby consenting members, excluding self. Saved cities and selected venues are not treated as current device location.

## Rollout
These are source changes, not a deployed feature. Apply both new location migrations through the normal reviewed release process, then deploy the matching member-map/member-proximity edge functions and clients. Do not ship the new session disclosure against an old backend. Missing new RPCs fail closed. No existing grant is migrated to longer duration or exact distance; older clients retain their existing coarse/four-hour contract.

## Verification
Focused pure tests, real React/Happy DOM hook tests, edge-handler tests and isolated PGlite migration tests cover:
- Exact formatting, reciprocal v2 consent, private/blocked/minor/banned users, stale responses and per-account/session boundaries.
- Fresh sampling, restored/ancient/future/unknown observations, replay rejection, consent/city renewal without lease extension, and same-account session replacement.
- Separate precise withdrawal, persisted retry on remount, late consent responses, concurrent-write guards and failed reads.
- Map grant expiry, session deletion, foreign/same-account different sessions, original-expiry retention, revision conflicts and legacy non-upgrade.
- Explicit prompt, dismissal, remount, new sign-in, no automatic permission/sharing, and interrupted permission/consent flow.
- Near You freshness, radius, ordering, limits and date-line handling.

Commands include `scripts/test-member-map-session-sql.cjs`, `scripts/test-member-map-session-dom.cjs`, `scripts/test-exact-distance-sql.cjs`, `scripts/test-exact-distance-hooks.cjs`, `scripts/test-weekly-location-dom.cjs` `scripts/test-weekly-location-consent-dom.cjs` and `scripts/test-proximity-observation-hooks.cjs`.

Happy DOM is not native-device or real-browser visual QA. Chromium launch was blocked by process socket restrictions. A full isolated app typecheck exceeded the review container memory budget; aggregate typecheck belongs to the combined branch. No deployment, live migration, or live location disclosure was performed.
