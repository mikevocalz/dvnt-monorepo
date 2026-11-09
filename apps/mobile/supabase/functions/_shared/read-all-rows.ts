/** Complete an aggregate's source read without trusting PostgREST's row cap.
 * The factory must select a stable, unique cursor column (`id` by default) and return a fresh query.
 * This is a bounded keyset scan, not a transaction snapshot. Never return a
 * partial aggregate when a page fails or violates the cursor contract.
 */
export async function readAllRows(
  // deno-lint-ignore no-explicit-any
  queryFactory: () => any,
  options: { pageSize?: number; maxPages?: number; cursorColumn?: string } = {},
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  const cursorColumn = options.cursorColumn ?? "id";
  if (!/^[a-z_][a-z0-9_]*$/.test(cursorColumn)) {
    throw new Error("Invalid aggregate cursor column");
  }
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? 1000;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000 ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000) {
    throw new Error("Invalid aggregate pagination bounds");
  }
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  const seen = new Set<string>();
  let cursor: string | number | null = null;
  for (let page = 0; page < maxPages; page++) {
    let query = queryFactory().order(cursorColumn, { ascending: true }).limit(pageSize);
    if (cursor !== null) query = query.gt(cursorColumn, cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Aggregate page was unavailable");
    // A deployment may enforce a smaller cap than our requested limit.
    // Only an empty result proves the ordered scan has reached its end.
    if (data.length === 0) return rows;
    for (const row of data) {
      const id = row?.[cursorColumn];
      if ((typeof id !== "string" && typeof id !== "number") || id === "" ||
          (typeof id === "number" && !Number.isFinite(id)) || seen.has(String(id))) {
        throw new Error("Aggregate page has invalid or repeated identifiers");
      }
      seen.add(String(id));
      rows.push(row);
    }
    cursor = data[data.length - 1][cursorColumn];
  }
  throw new Error("Aggregate exceeded safe pagination bounds");
}
