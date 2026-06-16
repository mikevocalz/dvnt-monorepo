/**
 * Short, readable URL slugs from a title (events have no `slug` column, so we
 * derive one). Kept short on purpose — long titles are truncated to a few words
 * so URLs like /events/tommy-party-power-rangers stay tidy.
 */
const MAX_WORDS = 6;
const MAX_LEN = 60;

export function slugify(title: string | null | undefined): string {
  const base = (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/['"’]/g, "") // drop apostrophes/quotes entirely
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics → dashes
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes

  const short = base.split("-").filter(Boolean).slice(0, MAX_WORDS).join("-");
  return short.slice(0, MAX_LEN).replace(/-+$/g, "") || "event";
}

/** Find the item in `items` whose `title` slugifies to `slug`. */
export function matchBySlug<T extends { title?: string | null }>(
  items: T[] | undefined,
  slug: string,
): T | undefined {
  if (!items) return undefined;
  return items.find((it) => slugify(it.title) === slug);
}
