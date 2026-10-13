import type { RoomComment } from "./comments";

function samePendingSend(pending: RoomComment, saved: RoomComment): boolean {
  return !!pending.isOptimistic &&
    pending.roomId === saved.roomId &&
    pending.authorId === saved.authorId &&
    pending.body === saved.body &&
    pending.parentId === saved.parentId;
}

function chronological(comments: RoomComment[]): RoomComment[] {
  return comments.sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
  );
}

/** Replace server data, retaining only pending sends not acknowledged yet. */
export function mergeCommentSnapshot(
  previous: RoomComment[],
  snapshot: RoomComment[],
): RoomComment[] {
  const knownIds = new Set(previous.filter((c) => !c.isOptimistic).map((c) => c.id));
  const pending = previous.filter((c) => c.isOptimistic);
  const saved = [...new Map(snapshot.map((c) => [c.id, c])).values()];
  for (const comment of saved) {
    if (knownIds.has(comment.id)) continue;
    // A pair of identical messages can be intentional. Each newly observed
    // server row acknowledges at most one optimistic send.
    const match = pending.findIndex((c) => samePendingSend(c, comment));
    if (match !== -1) pending.splice(match, 1);
  }
  return chronological([...saved, ...pending]);
}

export function mergeIncomingComment(
  previous: RoomComment[],
  incoming: RoomComment,
): RoomComment[] {
  return mergeCommentSnapshot(previous, [
    ...previous.filter((c) => !c.isOptimistic && c.id !== incoming.id),
    incoming,
  ]);
}

/** Handle both orderings: the HTTP response before or after its realtime echo. */
export function reconcilePostedComment(
  previous: RoomComment[],
  optimisticId: number,
  saved: RoomComment,
): RoomComment[] {
  return chronological([
    ...previous.filter((c) => c.id !== optimisticId && c.id !== saved.id),
    { ...saved, isOptimistic: false },
  ]);
}
