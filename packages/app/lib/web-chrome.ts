/**
 * Web chrome routing helper — the single source of truth for which routes are
 * "pushed sub-screens" that render their OWN top header (back / title / actions)
 * and therefore must NOT also get the global app header from SiteChrome (that
 * was the double-stacked-header bug). The bottom tab bar still shows.
 *
 * Used by SiteChrome (marketing header), AppShell (mobile top bar), and
 * WebAppShell (header clearance) so each shell respects the page header.
 */
const OWNS_HEADER_PREFIXES = [
  "/profile/", // other-user profile — has its own back/username/more header
];

export function routeOwnsHeader(pathname: string): boolean {
  // Settings home and every settings sub-screen already render a sticky
  // title + Close. They need that same header while signed out or hydrating.
  return pathname === "/settings" || pathname.startsWith("/settings/") ||
    OWNS_HEADER_PREFIXES.some((p) => pathname.startsWith(p));
}

// Full-screen surfaces that own the entire viewport and carry their own
// controls on the bottom edge — no WebTopBar/WebTabBar from SiteChrome and no
// shell clearance padding from WebAppShell.
const IMMERSIVE_PREFIXES = [
  "/feed/call",
  "/feed/camera",
  "/feed/story",
  // Call rooms own the whole viewport, including the desktop navigation rail.
  "/feed/lynk",
  "/feed/sneaky-lynk/room",
  // Legacy Fishjam rooms still render under the frontend root, outside /feed.
  // Hide their site chrome too, while /video/rooms keeps its listing navigation.
  "/video/room",
];

export function routeIsImmersive(pathname: string): boolean {
  return IMMERSIVE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Routes whose sheets/editors can leave Safari's layout viewport behind after
 * keyboard dismissal. Match only the detail routes, never their nested comment
 * or management screens: those have their own composer positioning contracts. */
export function routeUsesVisualViewportBottom(pathname: string): boolean {
  return /^\/feed\/events\/(?:create|[1-9]\d*)\/?$/.test(pathname) ||
    /^\/events\/[^/]+\/?$/.test(pathname) ||
    /^\/feed\/edit-event\/[^/]+\/?$/.test(pathname);
}
