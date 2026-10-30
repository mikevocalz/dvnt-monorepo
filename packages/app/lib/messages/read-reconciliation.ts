import type { QueryClient } from "@tanstack/react-query";
import { messageKeys } from "@dvnt/app/lib/messages/query-keys";
import {
  patchConversationUnreadFlag,
  type UnreadSnapshot,
} from "@dvnt/app/lib/messages/read-reconciliation-core";

export type { UnreadSnapshot } from "@dvnt/app/lib/messages/read-reconciliation-core";

export function reconcileConversationReadState(
  queryClient: QueryClient,
  viewerId: string | undefined,
  conversationId: string,
  _serverUnread?: UnreadSnapshot | null,
) {
  if (!viewerId || !conversationId) {
    return {
      inboxCleared: false,
      spamCleared: false,
      nextUnread: undefined,
    };
  }

  let inboxCleared = false;
  let spamCleared = false;

  queryClient.setQueryData(
    [...messageKeys.all(viewerId), "filtered", "primary"],
    (current: unknown) => {
      const result = patchConversationUnreadFlag(
        Array.isArray(current) ? current : undefined,
        conversationId,
      );
      if (result.didClearUnread) inboxCleared = true;
      return result.conversations;
    },
  );

  queryClient.setQueryData(
    [...messageKeys.all(viewerId), "filtered", "requests"],
    (current: unknown) => {
      const result = patchConversationUnreadFlag(
        Array.isArray(current) ? current : undefined,
        conversationId,
      );
      if (result.didClearUnread) spamCleared = true;
      return result.conversations;
    },
  );

  queryClient.setQueryData(messageKeys.conversations(viewerId), (current: unknown) => {
    const result = patchConversationUnreadFlag(
      Array.isArray(current) ? current : undefined,
      conversationId,
    );
    return result.conversations;
  });

  // Only a canonical snapshot proves which counted bucket contained this
  // thread. Legacy filtered lists and server totals differ in block/history
  // scope and cannot safely decrement a navigation badge.
  const key = messageKeys.unreadCount(viewerId);
  let nextUnread: UnreadSnapshot | undefined;
  queryClient.setQueryData(key, (current: {
    inbox: number; spam: number;
    inboxConversationIds?: string[]; spamConversationIds?: string[];
  } | undefined) => {
    if (!current || !Array.isArray(current.inboxConversationIds) || !Array.isArray(current.spamConversationIds)) return current;
    const inboxIds = current.inboxConversationIds.filter(id => id !== conversationId);
    const spamIds = current.spamConversationIds.filter(id => id !== conversationId);
    if (inboxIds.length === current.inboxConversationIds.length && spamIds.length === current.spamConversationIds.length) return current;
    const next = {
      ...current, inbox: inboxIds.length, spam: spamIds.length,
      inboxConversationIds: inboxIds, spamConversationIds: spamIds,
    };
    nextUnread = next;
    return next;
  });
  // useRefreshMessageCounts immediately invalidates this key to settle races.
  return { inboxCleared, spamCleared, nextUnread };
}
