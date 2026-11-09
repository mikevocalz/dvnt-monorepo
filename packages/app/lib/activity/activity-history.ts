export interface ActivityCursor { createdAt: string; id: string }
interface HistoryRow { id: string; createdAt?: string }
export interface ActivityPage<T> { rows: T[]; nextCursor: ActivityCursor | null; headCursor?: ActivityCursor | null }

function compareCursor(a: ActivityCursor, b: ActivityCursor): number {
  const micros = (value: string) => {
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;
    const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || "";
    return BigInt(millis) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3, 6));
  };
  const left = micros(a.createdAt), right = micros(b.createdAt);
  if (left === null || right === null) return 0;
  return left < right ? -1 : left > right ? 1 : Number(a.id) - Number(b.id);
}

/** Explicit keyset pages. The visible cache remains Activity[], never InfiniteData. */
export function createActivityHistory<T extends HistoryRow>(options: {
  fetchPage: (cursor?: ActivityCursor) => Promise<ActivityPage<T>>;
  read: () => T[];
  write: (rows: T[]) => void;
  beforeWrite?: () => Promise<unknown>;
  afterWrite?: () => void;
  isCurrent: () => boolean;
  changed: () => void;
}) {
  let cursor: ActivityCursor | null = null;
  let head: ActivityCursor | null = null;
  let cursorRevision = 0;
  let ready = false, loading = false, loadedOlder = false;
  let error = false;
  const merge = (fresh: T[], older: T[]) => {
    const seen = new Set<string>();
    return [...fresh, ...older]
      .filter(row => !seen.has(row.id) && !!seen.add(row.id))
      .sort((a, b) => a.createdAt && b.createdAt
        ? compareCursor({ id: b.id, createdAt: b.createdAt }, { id: a.id, createdAt: a.createdAt }) : 0);
  };
  const current = () => {
    if (!options.isCurrent()) throw new Error("Activity account changed");
  };
  return {
    get hasMore() { return ready && cursor !== null; },
    get loadingMore() { return loading; },
    get loadMoreError() { return error; },
    async refresh(): Promise<T[]> {
      const page = await options.fetchPage();
      current();
      // Only retain history explicitly requested during this mounted session.
      // Older pages are a snapshot until reopening; current head is revalidated.
      const boundary = page.nextCursor;
      const older = boundary ? options.read().filter(row => {
        // Preserve server microsecond ordering, not millisecond-truncated ties.
        return !!row.createdAt && compareCursor({ id: row.id, createdAt: row.createdAt }, boundary) < 0;
      }) : [];
      const result = loadedOlder ? merge(page.rows, older) : page.rows;
      // If >50 arrivals have shifted the entire head past our previous head,
      // reopen the gap even if historical pagination was already exhausted.
      const gap = boundary && head && compareCursor(boundary, head) > 0;
      if (!loadedOlder || !boundary || gap) {
        cursor = boundary;
        cursorRevision += 1;
      }
      head = page.headCursor || (page.rows[0]?.createdAt
        ? { id: page.rows[0].id, createdAt: page.rows[0].createdAt } : null);
      if (!boundary) loadedOlder = false;
      ready = true;
      options.changed();
      return result;
    },
    async loadMore(): Promise<void> {
      if (!ready || !cursor || loading || !options.isCurrent()) return;
      loading = true; error = false; options.changed();
      const next = cursor;
      const revision = cursorRevision;
      try {
        const page = await options.fetchPage(next);
        current();
        // A pending head-query commit must not overwrite this appended page.
        // Cancel only this viewer's head read, then merge against its final cache.
        await options.beforeWrite?.();
        current();
        options.write(merge(options.read(), page.rows));
        // A concurrent head refresh may have reopened a newer gap. Do not
        // let this older request erase that continuation (especially with null).
        if (revision === cursorRevision) cursor = page.nextCursor;
        loadedOlder = true;
        options.afterWrite?.();
      } catch {
        if (options.isCurrent()) error = true;
      } finally {
        loading = false;
        if (options.isCurrent()) options.changed();
      }
    },
  };
}
