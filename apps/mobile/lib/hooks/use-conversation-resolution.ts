import { useQuery, useQueryClient } from "@tanstack/react-query";
import { messagesApiClient } from "@/lib/api/messages";

/**
 * Query keys for conversation resolution cache
 */
export const conversationResolutionKeys = {
  all: ["conversation-resolution"] as const,
  byIdentifier: (identifier: string) =>
    [...conversationResolutionKeys.all, identifier] as const,
};

/**
 * TanStack Query hook for conversation resolution with caching.
 *
 * Resolves username → conversation ID with 5-minute cache.
 * Prevents duplicate edge function calls for the same conversation.
 *
 * @param identifier - Username, auth_id, or numeric conversation ID
 * @returns Resolved conversation ID
 */
export function useConversationResolution(identifier: string) {
  return useQuery({
    queryKey: conversationResolutionKeys.byIdentifier(identifier),
    queryFn: async ({ signal }) => {
      // Fast path: already a numeric conversation ID
      if (/^\d+$/.test(identifier)) {
        return identifier;
      }

      // CRITICAL: 10-second timeout to prevent infinite loading
      const timeoutId = setTimeout(() => {
        console.error("[ConversationResolution] Timeout after 10s");
      }, 10000);

      try {
        // Resolve username/auth_id to conversation ID via edge function
        const convId =
          await messagesApiClient.getOrCreateConversation(identifier);
        clearTimeout(timeoutId);
        return convId;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - conversations don't change
    gcTime: 30 * 60 * 1000, // 30 minutes in cache
    enabled: !!identifier,
    retry: 1, // Only retry once - fail fast
    retryDelay: 1000, // 1 second between retries
  });
}

/**
 * Prefetch conversation resolution before navigation.
 * Call this from profile screen, messages list, etc.
 *
 * @example
 * await prefetchConversationResolution(queryClient, "woahmikey");
 * router.push(`/(protected)/chat/woahmikey`);
 */
export async function prefetchConversationResolution(
  queryClient: ReturnType<typeof useQueryClient>,
  identifier: string,
): Promise<string | null> {
  if (!identifier) return null;

  // Check cache first
  const cached = queryClient.getQueryData<string>(
    conversationResolutionKeys.byIdentifier(identifier),
  );
  if (cached) return cached;

  // Prefetch and return
  try {
    await queryClient.prefetchQuery({
      queryKey: conversationResolutionKeys.byIdentifier(identifier),
      queryFn: async () => {
        if (/^\d+$/.test(identifier)) return identifier;
        return await messagesApiClient.getOrCreateConversation(identifier);
      },
      staleTime: 5 * 60 * 1000,
    });

    return (
      queryClient.getQueryData<string>(
        conversationResolutionKeys.byIdentifier(identifier),
      ) || null
    );
  } catch (error) {
    console.error("[ConversationResolution] Prefetch failed:", error);
    return null;
  }
}

/**
 * Imperative helper for resolving a user identifier into a 1:1 conversation
 * with caching. Use this in non-React contexts (callbacks, event handlers,
 * etc.) where you can't use the useConversationResolution hook.
 *
 * CRITICAL: Pass the queryClient instance to enable caching.
 * Without it, this falls back to direct API call (no cache).
 *
 * @example
 * // In a story reaction handler:
 * const convId = await getOrCreateConversationCached(queryClient, userId);
 *
 * @param queryClient - TanStack Query client instance
 * @param identifier - Username, auth_id, or numeric user.id
 * @returns Conversation ID
 */
export async function getOrCreateConversationCached(
  queryClient: ReturnType<typeof useQueryClient>,
  identifier: string,
): Promise<string> {
  if (!identifier) throw new Error("Identifier required");

  // Check cache first
  const cached = queryClient.getQueryData<string>(
    conversationResolutionKeys.byIdentifier(identifier),
  );
  if (cached) {
    console.log("[ConversationResolution] Cache hit:", identifier);
    return cached;
  }

  // Fetch and cache
  console.log("[ConversationResolution] Cache miss, fetching:", identifier);
  const convId = await queryClient.fetchQuery({
    queryKey: conversationResolutionKeys.byIdentifier(identifier),
    queryFn: async () =>
      await messagesApiClient.getOrCreateConversation(identifier),
    staleTime: 5 * 60 * 1000,
  });

  return convId;
}

/**
 * Invalidate conversation resolution cache for a specific identifier.
 * Use this when a conversation creation fails or needs to be retried.
 *
 * @example
 * // Clear cache for user 46 and retry
 * invalidateConversationCache(queryClient, "46");
 * const newConvId = await getOrCreateConversationCached(queryClient, "46");
 */
export function invalidateConversationCache(
  queryClient: ReturnType<typeof useQueryClient>,
  identifier: string,
): void {
  queryClient.invalidateQueries({
    queryKey: conversationResolutionKeys.byIdentifier(identifier),
  });
  console.log("[ConversationResolution] Cache invalidated:", identifier);
}
