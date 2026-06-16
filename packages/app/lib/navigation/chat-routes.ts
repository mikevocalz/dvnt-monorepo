/**
 * Canonical Chat Route Helper
 * 
 * Single source of truth for all chat navigation.
 * Prevents duplicate route patterns and ensures consistent param handling.
 */

type AppRouter = {
  push: (href: any) => void;
};

export interface ChatRouteParams {
  /** Canonical numeric conversation ID */
  conversationId: string;
  /** Optional: Pre-fetched peer avatar for instant render */
  peerAvatar?: string;
  /** Optional: Pre-fetched peer username for instant render */
  peerUsername?: string;
  /** Optional: Pre-fetched peer name for instant render */
  peerName?: string;
}

/**
 * Navigate to a chat thread with consistent param handling.
 * 
 * @example
 * // From messages list (has peer data)
 * navigateToChat(router, {
 *   conversationId: conversation.id,
 *   peerAvatar: conversation.user.avatar,
 *   peerUsername: conversation.user.username,
 *   peerName: conversation.user.name,
 * });
 */
export function navigateToChat(router: AppRouter, params: ChatRouteParams): void {
  const { conversationId, peerAvatar, peerUsername, peerName } = params;

  if (!conversationId) {
    console.error("[ChatRoutes] navigateToChat called with empty conversationId");
    return;
  }

  if (!/^\d+$/.test(conversationId)) {
    console.error(
      "[ChatRoutes] navigateToChat requires a canonical numeric conversationId",
      conversationId,
    );
    return;
  }

  // Always use the same route pattern with optional params
  router.push({
    pathname: "/(protected)/chat/[id]",
    params: {
      id: conversationId,
      ...(peerAvatar && { peerAvatar }),
      ...(peerUsername && { peerUsername }),
      ...(peerName && { peerName }),
    },
  });
}

/**
 * Parse and normalize chat route params.
 * Handles string|string[] from Expo Router and returns stable primitives.
 */
export function normalizeChatParams(rawParams: {
  id?: string | string[];
  peerAvatar?: string | string[];
  peerUsername?: string | string[];
  peerName?: string | string[];
}): {
  chatId: string | null;
  peerAvatar: string | undefined;
  peerUsername: string | undefined;
  peerName: string | undefined;
} {
  const normalize = (val: string | string[] | undefined): string | undefined => {
    if (!val) return undefined;
    return Array.isArray(val) ? val[0] : val;
  };

  return {
    chatId: normalize(rawParams.id) || null,
    peerAvatar: normalize(rawParams.peerAvatar),
    peerUsername: normalize(rawParams.peerUsername),
    peerName: normalize(rawParams.peerName),
  };
}
