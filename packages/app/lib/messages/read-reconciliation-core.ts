export interface UnreadSnapshot {
  inbox: number;
  spam: number;
  authoritative?: boolean;
}

export interface ReadReconciliationFlags {
  inboxCleared: boolean;
  spamCleared: boolean;
}

export function patchConversationUnreadFlag<
  T extends { id?: string | number | null; unread?: boolean | null },
>(conversations: T[] | undefined, conversationId: string): {
  conversations: T[] | undefined;
  didClearUnread: boolean;
} {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return { conversations, didClearUnread: false };
  }

  let didClearUnread = false;
  const next = conversations.map((conversation) => {
    if (String(conversation?.id ?? "") !== conversationId || !conversation.unread) {
      return conversation;
    }

    didClearUnread = true;
    return {
      ...conversation,
      unread: false,
    };
  });

  return {
    conversations: didClearUnread ? next : conversations,
    didClearUnread,
  };
}

export function resolveNextUnreadCounts(
  baseline: UnreadSnapshot,
  flags: ReadReconciliationFlags,
  serverUnread?: UnreadSnapshot | null,
): UnreadSnapshot {
  if (serverUnread?.authoritative) {
    return {
      inbox: Math.max(0, serverUnread.inbox),
      spam: Math.max(0, serverUnread.spam),
      authoritative: true,
    };
  }

  return {
    inbox: Math.max(0, baseline.inbox - (flags.inboxCleared ? 1 : 0)),
    spam: Math.max(0, baseline.spam - (flags.spamCleared ? 1 : 0)),
    authoritative: false,
  };
}
