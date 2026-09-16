/**
 * Turning what someone types into a people-search into PostgREST filters.
 *
 * Kept pure and dependency-free so it can be unit-tested with `node --test`,
 * and so the one place that decides what a query means is not buried inside a
 * Supabase call chain.
 *
 * Two jobs:
 *
 * 1. Match a person by full name, not only by username or first name. The
 *    query is split on whitespace and EVERY token has to match SOME name
 *    field, so "micah marquez" and "marquez micah" both land on the same
 *    person while "micah" alone still works. Each token becomes its own
 *    PostgREST `or=` group; separate `.or()` calls on one builder are ANDed
 *    together, which is exactly the "all tokens, any field" semantics we want.
 *
 *    Chosen over a `SECURITY DEFINER` RPC that would `ilike` a computed
 *    `first_name || ' ' || last_name`: an RPC means new SQL, a new migration,
 *    and a second authorization surface to keep in step with the `users` RLS
 *    policy that already governs this read. Token AND-ing needs none of that
 *    and is order-free, which the concatenated form is not.
 *
 * 2. Neutralise the filter grammar. The value goes into a PostgREST `or=(...)`
 *    string, where `,` ends a condition, `(` `)` nest groups, `.` separates
 *    column.operator.value, and `%` is the LIKE wildcard. Rather than quoting
 *    and back-slashing four different escape rules, every token is reduced to
 *    an allow-list of letters, digits, `_`, `'`, `-` and nothing else. A
 *    dropped character can only narrow a name search; a kept one could rewrite
 *    the filter.
 *
 * ponytail: `_` survives the allow-list because usernames are full of it, and
 * it is a LIKE single-character wildcard — "o_brien" also matches "oabrien".
 * Over-matching by one character in a search box is not worth an ESCAPE clause
 * PostgREST cannot express. Periods are dropped, so "Jr." searches as "Jr".
 */

/** Tokens past this are ignored — six results do not need a fourth ilike. */
export const USER_SEARCH_MAX_TOKENS = 3;

/** Name columns a token may match. Kept here so the test and the query agree. */
export const USER_SEARCH_COLUMNS = [
  "username",
  "first_name",
  "last_name",
] as const;

const UNSAFE = /[^\p{L}\p{N}_'-]/gu;

/**
 * Whitespace-split, `@`-stripped, grammar-safe tokens. Empty when the query
 * has nothing searchable left in it.
 */
export function buildUserSearchTokens(query: string | null | undefined) {
  return String(query ?? "")
    .split(/\s+/)
    .map((raw) => raw.replace(/^@+/, "").replace(UNSAFE, ""))
    .filter((t) => t.length > 0)
    .slice(0, USER_SEARCH_MAX_TOKENS);
}

/**
 * One PostgREST `or=` expression per token. Apply each with its own `.or()`
 * call: PostgREST ANDs repeated filters, so the row must match every token.
 * Returns `[]` when the query is too short to be worth a round trip.
 */
export function buildUserSearchFilters(
  query: string | null | undefined,
  minLength = 1,
) {
  const tokens = buildUserSearchTokens(query);
  if (tokens.join("").length < minLength) return [];
  return tokens.map((token) =>
    USER_SEARCH_COLUMNS.map((col) => `${col}.ilike.%${token}%`).join(","),
  );
}

/** "Micah Marquez", falling back to first name then username. */
export function userDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  username: string | null | undefined,
) {
  const full = [firstName, lastName]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return full || (username ?? "").trim() || "Unknown";
}
