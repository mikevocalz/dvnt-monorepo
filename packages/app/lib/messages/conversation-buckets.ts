export interface FollowPartitionConversation {
  user?: { id?: string | null } | null;
  isGroup?: boolean | null;
}

export interface FollowPartitionOptions {
  isAuthoritative?: boolean | null;
}

/**
 * Split conversations into Inbox vs Requests using DVNT's product rule:
 * only followed direct-message threads belong in Inbox; group chats always do.
 *
 * If follow state is unavailable, fail open and keep directs in Inbox.
 * That avoids a backend lookup issue misrouting legitimate threads into Requests.
 */
export function partitionConversationsByFollowState<
  T extends FollowPartitionConversation,
>(
  conversations: T[],
  followingIds: string[],
  options: FollowPartitionOptions = {},
): {
  primary: T[];
  requests: T[];
} {
  if (options.isAuthoritative === false) {
    return { primary: [...conversations], requests: [] };
  }

  const followedIds = new Set(followingIds.map(String));
  const primary: T[] = [];
  const requests: T[] = [];

  for (const conversation of conversations) {
    if (conversation.isGroup) {
      primary.push(conversation);
      continue;
    }

    const otherUserId = conversation.user?.id;
    if (otherUserId && followedIds.has(String(otherUserId))) {
      primary.push(conversation);
    } else {
      requests.push(conversation);
    }
  }

  return { primary, requests };
}
