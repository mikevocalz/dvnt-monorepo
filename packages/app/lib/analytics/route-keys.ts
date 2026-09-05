/**
 * Turning a URL into an analytics key.
 *
 * Its own module with NO imports so it stays unit-testable: the sink pulls in
 * the Supabase client, which a plain `node --test` cannot resolve, and logic
 * that decides what "one page" and "one event" mean is exactly the logic that
 * has to be covered.
 */

/** A route with its ids replaced, so one row means one SCREEN, not one URL. */
export function normalizeRoute(pathname: string): string {
  return (
    pathname
      // uuid
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
        "/[id]",
      )
      // numeric id
      .replace(/\/\d+(?=\/|$)/g, "/[id]")
      // slug: a long hyphenated tail is a title, not a route segment
      .replace(/\/[a-z0-9]+(?:-[a-z0-9]+){2,}(?=\/|$)/gi, "/[slug]")
      .replace(/\/+$/, "") || "/"
  );
}

/**
 * What the screen was ABOUT, pulled from the route.
 *
 * This is what makes "which events get the most traffic" a `group by`
 * instead of a regex over URLs at read time.
 */
export function entityFromRoute(
  pathname: string,
): { type: string; id: string } | null {
  const patterns: [RegExp, string][] = [
    [/\/events?\/([^/?#]+)/i, "event"],
    [/\/sneaky-lynk\/room\/([^/?#]+)/i, "lynk_room"],
    [/\/(?:chat|messages)\/([^/?#]+)/i, "conversation"],
    [/\/story\/([^/?#]+)/i, "story"],
    [/\/(?:profile|u)\/([^/?#]+)/i, "profile"],
  ];
  for (const [re, type] of patterns) {
    const m = pathname.match(re);
    // Guard against matching a sub-route ("/events/create") as an id.
    if (m?.[1] && !["create", "new", "edit", "host"].includes(m[1].toLowerCase())) {
      return { type, id: m[1] };
    }
  }
  return null;
}
