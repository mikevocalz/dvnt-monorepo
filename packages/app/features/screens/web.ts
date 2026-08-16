/**
 * Flat web barrel for `features/screens`.
 *
 * apps/web-vite (Rollup) cannot import through the route-shaped directories
 * under this tree — `(protected)` and `[roomId]` contain characters that break
 * its resolution — so web consumers import from here instead of a deep path.
 * That is the whole reason this file exists; see scripts/verify-migration.mjs
 * check (c).
 *
 * Only screens that actually exist are exported. That verifier also expects
 * three login/privacy/FAQ web screens which do not exist anywhere in the repo
 * yet; they are deliberately absent rather than stubbed, so it reports them as
 * warnings — the correct signal that the migration is unfinished. Add them here
 * when they are built.
 *
 * Do NOT name those three identifiers in this file's comments. The verifier
 * tests for them with a plain word-boundary regex over the whole file, so a
 * mention in a comment silences the warning without the export existing.
 */

export { LandingScreen } from "./landing/LandingScreen.web";
export { default as LynkRoomWebScreen } from "./(protected)/lynk/[roomId]/web";
