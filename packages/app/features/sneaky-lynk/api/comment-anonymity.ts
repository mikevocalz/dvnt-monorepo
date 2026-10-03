/**
 * Is a chat author anonymous in this room?
 *
 * Clients cannot read video_room_members.user_id (migration 20261003150200).
 * The roster RPC (lynk_room_roster) returns the real auth id for every
 * non-anonymous member and for the viewer's own row, and `member:<id>` for
 * every other anonymous member. So an author id that matches a roster row is
 * resolved from that row, and an author id that matches none belongs to an
 * anonymous member (or someone with no membership row at all). Both of those
 * are shown as anonymous: hiding a name by mistake is recoverable, printing
 * an anonymous member's real name is not.
 */

export interface RosterRow {
  user_id: string;
  is_anonymous: boolean;
  anon_label: string | null;
}

export interface CommentAnonymity {
  isAnonymous: boolean;
  anonLabel: string | null;
}

export function commentAnonymity(
  roster: RosterRow[] | null,
  authorId: string,
): CommentAnonymity {
  // No roster (the RPC failed or the viewer is not in the room): nothing can
  // be resolved, so nobody is shown by name.
  if (!roster) return { isAnonymous: true, anonLabel: null };
  const row = roster.find((r) => r.user_id === authorId);
  if (!row) return { isAnonymous: true, anonLabel: null };
  return {
    isAnonymous: !!row.is_anonymous,
    anonLabel: row.is_anonymous ? (row.anon_label ?? null) : null,
  };
}
