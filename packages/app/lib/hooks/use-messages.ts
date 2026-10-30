import { readViewerScoped } from "@dvnt/app/lib/query/viewer-scoped-read";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { messagesApi as messagesApiClient } from "@dvnt/app/lib/api/messages-impl";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUnreadRealtime } from "@dvnt/app/lib/hooks/use-unread-realtime";
import { normalizeUnreadCount } from "@dvnt/app/lib/badges/unread-badge";
import { STALE_TIMES, GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";
import { messageKeys } from "@dvnt/app/lib/messages/query-keys";
import {
  reconcileConversationReadState,
  type UnreadSnapshot,
} from "@dvnt/app/lib/messages/read-reconciliation";

export { messageKeys } from "@dvnt/app/lib/messages/query-keys";

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
  const viewerId = useAuthStore((s) => s.user?.id);
  useUnreadRealtime(viewerId, "messages");

  const query = useQuery<{ inbox: number; spam: number }>({
    queryKey: messageKeys.unreadCount(viewerId),
    queryFn: ({ signal }) => readViewerScoped(viewerId, () => messagesApiClient.getUnreadCounts(), signal),
    enabled: !!viewerId,
    staleTime: STALE_TIMES.unreadCounts,
    gcTime: GC_TIMES.short,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  // The viewer-keyed query is the only badge authority. A global store or
  // push increment can leak another account's count or count one thread twice.
  return {
    ...query,
    data: viewerId ? normalizeUnreadCount(query.data?.inbox) : 0,
    spamCount: viewerId ? normalizeUnreadCount(query.data?.spam) : 0,
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
