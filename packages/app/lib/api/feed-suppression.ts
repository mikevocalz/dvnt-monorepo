// Temporary moderation: keep these authors OUT of feed/explore/search while
// their profiles stay fully intact (posts remain visibility=public).
// Self-expires — after SUPPRESS_UNTIL every helper is a no-op and this file
// can be deleted. Mirrored in the bootstrap-feed edge function (Deno can't
// import this file); keep the two lists in sync.
const SUPPRESSED_FEED_AUTHOR_IDS = [30]; // @james_dunn, per Mike 2026-08-08
const SUPPRESS_UNTIL = Date.parse("2026-08-29T12:00:00Z");

export function suppressedFeedAuthors(): number[] {
  return Date.now() < SUPPRESS_UNTIL ? SUPPRESSED_FEED_AUTHOR_IDS : [];
}

/** Chainable helper for supabase-js post queries: excludes suppressed authors. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withoutSuppressedAuthors<T extends { not: any }>(
  query: T,
  authorColumn: string,
): T {
  const ids = suppressedFeedAuthors();
  if (ids.length === 0) return query;
  return query.not(authorColumn, "in", `(${ids.join(",")})`);
}
