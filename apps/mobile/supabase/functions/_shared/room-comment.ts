/**
 * Request parsing and row shaping for lynk-room-comment.
 *
 * Clients cannot write public.room_comments or read its author_id (migration
 * 20261003150300_room_comments_author_private.sql). The edge function writes
 * with service_role, and a trigger stores author_handle: the auth id of a named
 * member, `member:<video_room_members.id>` for an anonymous one. Nothing in
 * this file may put author_id into a response.
 */

export const MAX_BODY = 2000;
export const MAX_MENTIONS = 20;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Mention {
  userId: string;
  username: string;
  start: number;
  end: number;
}

export type RoomCommentRequest =
  | {
    action: "post";
    roomId: string;
    body: string;
    parentId: number | null;
    mentions: Mention[];
  }
  | { action: "delete"; roomId: string; commentId: number };

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function parseMentions(raw: unknown, bodyLength: number): Parsed<Mention[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "mentions must be an array" };
  if (raw.length > MAX_MENTIONS) return { ok: false, message: "Too many mentions" };
  const out: Mention[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return { ok: false, message: "Invalid mention" };
    const { userId, username, start, end } = m as Record<string, unknown>;
    if (
      typeof userId !== "string" || userId.length < 1 || userId.length > 128 ||
      typeof username !== "string" || username.length > 64 ||
      typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 ||
      typeof end !== "number" || !Number.isSafeInteger(end) || end < start ||
      end > bodyLength
    ) {
      return { ok: false, message: "Invalid mention" };
    }
    out.push({ userId, username, start, end });
  }
  return { ok: true, value: out };
}

export function parseRoomCommentRequest(input: unknown): Parsed<RoomCommentRequest> {
  if (!input || typeof input !== "object") return { ok: false, message: "Invalid body" };
  const b = input as Record<string, unknown>;
  if (typeof b.roomId !== "string" || !UUID.test(b.roomId)) {
    return { ok: false, message: "roomId must be a room uuid" };
  }
  const roomId = b.roomId.toLowerCase();

  if (b.action === "delete") {
    if (!isPositiveInt(b.commentId)) return { ok: false, message: "commentId is required" };
    return { ok: true, value: { action: "delete", roomId, commentId: b.commentId } };
  }

  if (b.action !== undefined && b.action !== "post") {
    return { ok: false, message: "Unknown action" };
  }
  if (typeof b.body !== "string") return { ok: false, message: "body is required" };
  const body = b.body.trim();
  if (body.length < 1 || body.length > MAX_BODY) {
    return { ok: false, message: `body must be 1-${MAX_BODY} characters` };
  }
  let parentId: number | null = null;
  if (b.parentId !== undefined && b.parentId !== null) {
    if (!isPositiveInt(b.parentId)) return { ok: false, message: "Invalid parentId" };
    parentId = b.parentId;
  }
  const mentions = parseMentions(b.mentions, body.length);
  if (!mentions.ok) return mentions;
  return {
    ok: true,
    value: { action: "post", roomId, body, parentId, mentions: mentions.value },
  };
}

/** Thread position from the parent row, computed here instead of trusted. */
export function threadPlacement(
  parent: { id: number; root_id: number | null; depth: number } | null,
): { parent_id: number | null; root_id: number | null; depth: number } {
  if (!parent) return { parent_id: null, root_id: null, depth: 0 };
  return {
    parent_id: parent.id,
    root_id: parent.root_id ?? parent.id,
    depth: Math.min((parent.depth ?? 0) + 1, 2),
  };
}

/**
 * Replace a mention of an anonymous member, by auth id, with their handle. The
 * row is readable by the whole room, so a mention must not carry the real id
 * of someone who joined anonymously.
 */
export function maskMentions(
  mentions: Mention[],
  anonymousMembers: { id: number; user_id: string }[],
): Mention[] {
  const handleOf = new Map(anonymousMembers.map((m) => [m.user_id, `member:${m.id}`]));
  return mentions.map((m) => {
    const handle = handleOf.get(m.userId);
    return handle ? { ...m, userId: handle } : m;
  });
}

/** Columns a client may see. author_id is deliberately absent. */
export const CLIENT_COLUMNS =
  "id, room_id, author_handle, body, parent_id, root_id, depth, mentions, created_at";

export interface ClientComment {
  id: number;
  room_id: string;
  author_handle: string;
  body: string;
  parent_id: number | null;
  root_id: number | null;
  depth: number;
  mentions: Mention[];
  created_at: string;
}

export function toClientComment(row: Record<string, unknown>): ClientComment {
  return {
    id: row.id as number,
    room_id: row.room_id as string,
    author_handle: row.author_handle as string,
    body: row.body as string,
    parent_id: (row.parent_id as number | null) ?? null,
    root_id: (row.root_id as number | null) ?? null,
    depth: (row.depth as number) ?? 0,
    mentions: (row.mentions as Mention[] | null) ?? [],
    created_at: row.created_at as string,
  };
}

/** The author may delete their own message; otherwise room moderators only. */
export function mayDeleteComment(opts: {
  actorId: string;
  authorId: string;
  canModerate: boolean;
}): boolean {
  return opts.actorId === opts.authorId || opts.canModerate;
}
