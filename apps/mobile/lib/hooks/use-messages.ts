import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { messagesApi as messagesApiClient } from "@/lib/api/messages-impl";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUnreadCountsStore } from "@/lib/stores/unread-counts-store";
import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";
import { messageKeys } from "@/lib/messages/query-keys";
import {
  reconcileConversationReadState,
  type UnreadSnapshot,
} from "@/lib/messages/read-reconciliation";

export { messageKeys } from "@/lib/messages/query-keys";

/**
 * Hook to get unread message count for INBOX ONLY
 *
 * CRITICAL: This count only includes messages from followed users.
 * Spam messages are NOT included in the Messages badge.
 * This is the source of truth for the Messages tab badge.
 *
 * Deduplication is handled by TanStack Query staleTime — no manual debounce.
 * Boot prefetch primes this cache so the badge renders instantly.
 */
export function useUnreadMessageCount() {
  const setMessagesUnread = useUnreadCountsStore((s) => s.setMessagesUnread);
  const setSpamUnread = useUnreadCountsStore((s) => s.setSpamUnread);
  const realtimeInbox = useUnreadCountsStore((s) => s.messagesUnread);
  const realtimeSpam = useUnreadCountsStore((s) => s.spamUnread);
  const lastMessagesRefresh = useUnreadCountsStore(
    (s) => s.lastMessagesRefresh,
  );
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  const query = useQuery<{ inbox: number; spam: number }>({
    queryKey: messageKeys.unreadCount(viewerId),
    queryFn: () => messagesApiClient.getUnreadCounts(),
    enabled: !!viewerId,
    staleTime: STALE_TIMES.unreadCounts,
    gcTime: GC_TIMES.short,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchInterval: 30000, // Background refresh every 30s
  });

  // Sync with unread counts store for push notification increments
  useEffect(() => {
    if (query.data) {
      setMessagesUnread(query.data.inbox);
      setSpamUnread(query.data.spam);
    }
  }, [query.data, setMessagesUnread, setSpamUnread]);

  const cacheIsNewerThanQuery =
    lastMessagesRefresh > 0 && lastMessagesRefresh >= query.dataUpdatedAt;
  const inboxCount = cacheIsNewerThanQuery
    ? realtimeInbox
    : (query.data?.inbox ?? realtimeInbox ?? 0);
  const spamCount = cacheIsNewerThanQuery
    ? realtimeSpam
    : (query.data?.spam ?? realtimeSpam ?? 0);

  // Return just the inbox count for backwards compatibility
  return {
    ...query,
    data: inboxCount,
    spamCount,
  };
}

// Hook to get conversations
export function useConversations() {
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  return useQuery({
    queryKey: messageKeys.conversations(viewerId),
    queryFn: messagesApiClient.getConversations,
    enabled: !!viewerId,
    staleTime: STALE_TIMES.conversations,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
  });
}

// Hook to get filtered conversations (inbox = followed users, requests = others)
export function useFilteredConversations(filter: "primary" | "requests") {
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  return useQuery({
    queryKey: [...messageKeys.all(viewerId), "filtered", filter],
    queryFn: () => messagesApiClient.getFilteredConversations(filter),
    enabled: !!viewerId,
    staleTime: STALE_TIMES.conversations,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
  });
}

/**
 * Hook to refresh message counts after marking as read
 * Call this after opening a conversation
 */
export function useRefreshMessageCounts() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const viewerId = user?.id;

  return async (
    conversationId?: string,
    serverUnread?: UnreadSnapshot | null,
  ) => {
    if (!viewerId) return;

    if (conversationId) {
      reconcileConversationReadState(
        queryClient,
        viewerId,
        conversationId,
        serverUnread,
      );
    }

    await Promise.allSettled([
      queryClient.invalidateQueries({
        queryKey: messageKeys.unreadCount(viewerId),
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: messageKeys.conversations(viewerId),
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: [...messageKeys.all(viewerId), "filtered"],
        refetchType: "active",
      }),
    ]);
  };
}
