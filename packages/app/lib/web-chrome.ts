/**
 * Web chrome routing helper — the single source of truth for which routes are
 * "pushed sub-screens" that render their OWN top header (back / title / actions)
 * and therefore must NOT also get the global app header from SiteChrome (that
 * was the double-stacked-header bug). The bottom tab bar still shows.
 *
 * Used by BOTH SiteChrome (skips WebAppHeader) and WebAppShell (drops the
 * header-clearance top padding) so the two can't drift.
 */
const OWNS_HEADER_PREFIXES = [
  "/profile/", // other-user profile — has its own back/username/more header
];

export function routeOwnsHeader(pathname: string): boolean {
  return OWNS_HEADER_PREFIXES.some((p) => pathname.startsWith(p));
}
