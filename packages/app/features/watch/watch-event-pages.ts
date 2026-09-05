/** Range pagination for independently authorized event relationships. */
export async function loadEventRelationPages<T>(makeQuery: () => {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
}): Promise<{ data: T[]; error: unknown }> {
  const data: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await makeQuery().range(offset, offset + 199);
    if (page.error) return { data: [], error: page.error };
    data.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 200) return { data, error: null };
  }
}

/** Keep the next twenty events while replacing a forty-event archive page. */
export function eventWindowPage<T>(rows: T[], offset: number) {
  const start = Math.max(0, Math.floor(offset / 40) * 40);
  return { events: [...rows.slice(0, 20), ...rows.slice(20 + start, 60 + start)],
    hasMore: rows.length > 60 + start, hasPrevious: start > 0 };
}
