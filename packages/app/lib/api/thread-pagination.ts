import type { ThreadCursor, ThreadPage } from "./messages";

export function threadPageBounds(
  conversationId: string,
  options: { limit?: number; olderCursor?: ThreadCursor },
) {
  if (!/^[1-9]\d*$/.test(conversationId)) throw new Error("Invalid conversation ID");
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("Page size must be 1–30");
  const cursor = options.olderCursor;
  if (!cursor) return { limit, filter: undefined };
  // Preserve fractional seconds: normalizing with Date loses Postgres microseconds.
  if (!/^[1-9]\d*$/.test(cursor.id) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt) ||
      !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error("Invalid thread cursor");
  return { limit, filter: `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})` };
}

export function threadPageFromRows(
  conversationId: string,
  rows: Array<{ id: string | number; content: string; sender_id: number; created_at: string; read_at?: string | null; metadata?: Record<string, unknown> | null }>,
  visitorId: number,
  limit: number,
  formatTime: (value: string) => string,
): ThreadPage {
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  return {
    conversationId,
    messages: page.reverse().map((row) => ({
      id: String(row.id), text: row.content, sender: row.sender_id === visitorId ? "user" : "other",
      senderId: String(row.sender_id), timestamp: formatTime(row.created_at), createdAt: row.created_at,
      readAt: row.read_at || null, metadata: row.metadata || null,
    })),
    ...(rows.length > limit && oldest ? { olderCursor: { createdAt: oldest.created_at, id: String(oldest.id) } } : {}),
  };
}
