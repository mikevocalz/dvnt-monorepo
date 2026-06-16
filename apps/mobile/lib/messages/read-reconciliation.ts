import type { QueryClient } from "@tanstack/react-query";
import { useUnreadCountsStore } from "@/lib/stores/unread-counts-store";
import { messageKeys } from "@/lib/messages/query-keys";
import {
  patchConversationUnreadFlag,
  resolveNextUnreadCounts,
  type UnreadSnapshot,
} from "@/lib/messages/read-reconciliation-core";

export type { UnreadSnapshot } from "@/lib/messages/read-reconciliation-core";

function getBaselineUnreadSnapshot(
  queryClient: QueryClient,
  viewerId: string,
): UnreadSnapshot {
  const store = useUnreadCountsStore.getState();
  const unreadKey = messageKeys.unreadCount(viewerId);
  const queryData =
    queryClient.getQueryData<UnreadSnapshot>(unreadKey) ?? null;
  const queryState = queryClient.getQueryState(unreadKey);
  const storeIsNewer =
    store.lastMessagesRefresh > (queryState?.dataUpdatedAt ?? 0);

  return {
    inbox: storeIsNewer
      ? store.messagesUnread
      : (queryData?.inbox ?? store.messagesUnread),
    spam: storeIsNewer ? store.spamUnread : (queryData?.spam ?? store.spamUnread),
  };
}

export function reconcileConversationReadState(
  queryClient: QueryClient,
  viewerId: string | undefined,
  conversationId: string,
  serverUnread?: UnreadSnapshot | null,
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

  if (!inboxCleared && !spamCleared && !serverUnread?.authoritative) {
    return {
      inboxCleared,
      spamCleared,
      nextUnread: undefined,
    };
  }

  const nextUnread = resolveNextUnreadCounts(
    getBaselineUnreadSnapshot(queryClient, viewerId),
    { inboxCleared, spamCleared },
    serverUnread,
  );

  queryClient.setQueryData(messageKeys.unreadCount(viewerId), {
    inbox: nextUnread.inbox,
    spam: nextUnread.spam,
  });

  const unreadStore = useUnreadCountsStore.getState();
  unreadStore.setMessagesUnread(nextUnread.inbox);
  unreadStore.setSpamUnread(nextUnread.spam);

  return {
    inboxCleared,
    spamCleared,
    nextUnread,
  };
}
