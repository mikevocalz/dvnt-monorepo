/**
 * Who wrote a room chat message, as far as this viewer may know.
 *
 * Clients cannot read room_comments.author_id (migration 20261003150300) or
 * video_room_members.user_id (20261003150200). A message carries
 * author_handle instead: the author's auth id when they are a named member of
 * the room, and `member:<video_room_members.id>` when they joined anonymously.
 *
 * The roster RPC (lynk_room_roster) returns, for every member row, its
 * member_id and a user_id that is the real auth id for named members and for
 * the viewer's own row, and `member:<id>` for every other anonymous member.
 * So:
 *   - a named author's handle equals their roster user_id;
 *   - the viewer's own anonymous message (`member:<own row>`) maps back to the
 *     viewer's own auth id, so "is this mine" still works;
 *   - another anonymous member stays `member:<id>`, with only their label.
 *
 * Anything the roster cannot place is shown as anonymous: hiding a name by
 * mistake is recoverable, printing an anonymous member's real name is not.
 */

export interface RosterRow {
  member_id?: number;
  user_id: string;
  is_anonymous: boolean;
  anon_label: string | null;
}

export interface CommentAnonymity {
  isAnonymous: boolean;
  anonLabel: string | null;
}

export interface ResolvedCommentAuthor extends CommentAnonymity {
  /** Real auth id for named authors and for the viewer; the handle otherwise. */
  authorId: string;
}

const HANDLE = /^member:(\d+)$/;

/** Is `id` an opaque `member:<id>` handle rather than an auth id? */
export function isMemberHandle(id: string): boolean {
  return HANDLE.test(id);
}

export function resolveCommentAuthor(
  roster: RosterRow[] | null,
  authorHandle: string,
): ResolvedCommentAuthor {
  const unknown = { authorId: authorHandle, isAnonymous: true, anonLabel: null };
  if (!roster) return unknown;
  const handle = HANDLE.exec(authorHandle);
  const row = handle
    ? roster.find((r) => r.member_id === Number(handle[1]))
    : roster.find((r) => r.user_id === authorHandle && !r.is_anonymous);
  if (!row) return unknown;
  return {
    authorId: row.user_id,
    isAnonymous: !!row.is_anonymous,
    anonLabel: row.is_anonymous ? (row.anon_label ?? null) : null,
  };
}

/** Anonymity of a handle in this roster (see resolveCommentAuthor). */
export function commentAnonymity(
  roster: RosterRow[] | null,
  authorHandle: string,
): CommentAnonymity {
  const { isAnonymous, anonLabel } = resolveCommentAuthor(roster, authorHandle);
  return { isAnonymous, anonLabel };
}

/**
 * Sender id for chat broadcasts (typing, reactions). Broadcast payloads reach
 * everyone on the channel, so an anonymous member sends a per-session token
 * instead of their auth id.
 */
export function broadcastSenderId(
  user: { id: string; isAnonymous?: boolean },
  sessionToken: string,
): string {
  return user.isAnonymous ? `anon:${sessionToken}` : user.id;
}
