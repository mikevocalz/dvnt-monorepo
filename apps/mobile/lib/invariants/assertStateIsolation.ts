/**
 * DEV-ONLY State Isolation Invariants
 * 
 * Throws immediately if any state isolation rule is violated.
 * This prevents cross-user and cross-entity state leaks for:
 * - Like state (viewerId + postId scoped)
 * - Bookmark state (viewerId + postId scoped)
 * - Follow state (viewerId + targetUserId scoped)
 * - Feed/profile post isolation
 * - Message sender identity
 */

// =============================================================================
// POST STATE ISOLATION
// =============================================================================

/**
 * Assert that a post has valid identity data.
 * Posts MUST have id and author.id to be rendered.
 */
export function assertPostIdentity(post: {
  id?: string | null;
  author?: { id?: string | null } | null;
}): void {
  if (__DEV__ !== true) return;

  if (!post.id) {
    throw new Error(
      `[POST IDENTITY VIOLATION] Post is missing id. Cannot render post without identity.`
    );
  }

  if (!post.author?.id) {
    console.warn(
      `[POST IDENTITY WARNING] Post ${post.id} is missing author.id. ` +
      `Author identity data should always be present.`
    );
  }
}

/**
 * Assert that like state is properly scoped.
 * Like operations MUST include both viewerId and postId.
 */
export function assertLikeStateScope(params: {
  viewerId?: string | null;
  postId?: string | null;
  operation: 'read' | 'write';
}): void {
  if (__DEV__ !== true) return;

  const { viewerId, postId, operation } = params;

  if (!postId) {
    throw new Error(
      `[LIKE STATE VIOLATION] Like ${operation} missing postId. ` +
      `Like state MUST be scoped by postId.`
    );
  }

  if (!viewerId && operation === 'write') {
    throw new Error(
      `[LIKE STATE VIOLATION] Like ${operation} missing viewerId. ` +
      `Like mutations MUST be scoped by viewer.`
    );
  }
}

/**
 * Assert that bookmark state is properly scoped.
 * Bookmark operations MUST include both viewerId and postId.
 */
export function assertBookmarkStateScope(params: {
  viewerId?: string | null;
  postId?: string | null;
  operation: 'read' | 'write';
}): void {
  if (__DEV__ !== true) return;

  const { viewerId, postId, operation } = params;

  if (!postId) {
    throw new Error(
      `[BOOKMARK STATE VIOLATION] Bookmark ${operation} missing postId. ` +
      `Bookmark state MUST be scoped by postId.`
    );
  }

  if (!viewerId && operation === 'write') {
    throw new Error(
      `[BOOKMARK STATE VIOLATION] Bookmark ${operation} missing viewerId. ` +
      `Bookmark mutations MUST be scoped by viewer.`
    );
  }
}

// =============================================================================
// FOLLOW STATE ISOLATION
// =============================================================================

/**
 * Assert that follow state is properly scoped.
 * Follow state MUST include viewerId and targetUserId.
 */
export function assertFollowStateScope(params: {
  viewerId?: string | null;
  targetUserId?: string | null;
  operation: 'read' | 'write';
}): void {
  if (__DEV__ !== true) return;

  const { viewerId, targetUserId, operation } = params;

  if (!targetUserId) {
    throw new Error(
      `[FOLLOW STATE VIOLATION] Follow ${operation} missing targetUserId. ` +
      `Follow state MUST be scoped by target user.`
    );
  }

  if (!viewerId) {
    throw new Error(
      `[FOLLOW STATE VIOLATION] Follow ${operation} missing viewerId. ` +
      `Follow state MUST be scoped by viewer.`
    );
  }

  if (viewerId === targetUserId) {
    console.warn(
      `[FOLLOW STATE WARNING] viewerId === targetUserId (${viewerId}). ` +
      `Users cannot follow themselves.`
    );
  }
}

// =============================================================================
// FEED NORMALIZATION
// =============================================================================

/**
 * Assert that feed items are properly keyed.
 * Feed items MUST be keyed by post.id, NOT array index.
 */
export function assertFeedItemKey(params: {
  postId?: string | null;
  key: string;
}): void {
  if (__DEV__ !== true) return;

  const { postId, key } = params;

  if (!postId) {
    throw new Error(
      `[FEED KEY VIOLATION] Feed item missing postId. ` +
      `All feed items MUST have a post.id for proper keying.`
    );
  }

  // Check if key is just a number (array index)
  if (/^\d+$/.test(key)) {
    console.warn(
      `[FEED KEY WARNING] Feed item key "${key}" appears to be an array index. ` +
      `Use post.id as key instead: "${postId}"`
    );
  }
}

/**
 * Assert that profile posts are filtered by author.
 * Profile grids MUST only show posts where author.id === profileUserId.
 */
export function assertProfilePostOwnership(params: {
  postAuthorId?: string | null;
  profileUserId: string;
  postId?: string | null;
}): void {
  if (__DEV__ !== true) return;

  const { postAuthorId, profileUserId, postId } = params;

  if (!postAuthorId) {
    console.warn(
      `[PROFILE POST WARNING] Post ${postId} missing author.id. ` +
      `Cannot verify ownership.`
    );
    return;
  }

  if (postAuthorId !== profileUserId) {
    throw new Error(
      `[PROFILE POST VIOLATION] Post ${postId} author (${postAuthorId}) ` +
      `does not match profile (${profileUserId}). ` +
      `Posts appearing on wrong profile!`
    );
  }
}

// =============================================================================
// MESSAGE ISOLATION
// =============================================================================

/**
 * Assert that message sender identity is correct.
 * Messages MUST render sender from message.sender, NOT authUser.
 */
export function assertMessageSenderIdentity(params: {
  messageSenderId?: string | null;
  renderedSenderId?: string | null;
  messageId?: string | null;
}): void {
  if (__DEV__ !== true) return;

  const { messageSenderId, renderedSenderId, messageId } = params;

  if (!messageSenderId) {
    throw new Error(
      `[MESSAGE SENDER VIOLATION] Message ${messageId} missing sender.id. ` +
      `All messages MUST have sender identity.`
    );
  }

  if (renderedSenderId && renderedSenderId !== messageSenderId) {
    throw new Error(
      `[MESSAGE SENDER VIOLATION] Message ${messageId} sender mismatch. ` +
      `Expected ${messageSenderId}, rendering ${renderedSenderId}. ` +
      `Messages MUST render sender from message.sender ONLY.`
    );
  }
}

// =============================================================================
// QUERY KEY VALIDATION
// =============================================================================

/**
 * Assert that query keys are properly scoped.
 * User-specific data MUST include userId in the key.
 */
export function assertQueryKeyScope(params: {
  queryKey: readonly unknown[];
  requiresUserId: boolean;
  userId?: string | null;
  context: string;
}): void {
  if (__DEV__ !== true) return;

  const { queryKey, requiresUserId, userId, context } = params;

  // Check for forbidden broad keys
  const keyString = JSON.stringify(queryKey);
  const forbiddenPatterns = [
    '["users"]',
    '["user"]',
    '["profile"]',
    '["me"]',
  ];

  for (const pattern of forbiddenPatterns) {
    if (keyString === pattern) {
      console.warn(
        `[QUERY KEY WARNING] ${context} using broad key ${keyString}. ` +
        `User-specific data should include userId in the key.`
      );
    }
  }

  if (requiresUserId && !userId) {
    console.warn(
      `[QUERY KEY WARNING] ${context} requires userId but none provided. ` +
      `Query key: ${keyString}`
    );
  }
}

// =============================================================================
// CACHE MUTATION VALIDATION
// =============================================================================

/**
 * Assert that cache invalidation is properly scoped.
 * Invalidations MUST NOT use broad keys that affect other users.
 */
export function assertCacheInvalidationScope(params: {
  queryKey: readonly unknown[];
  context: string;
}): void {
  if (__DEV__ !== true) return;

  const { queryKey, context } = params;
  const keyString = JSON.stringify(queryKey);

  // These keys are TOO BROAD and should never be invalidated
  const forbiddenInvalidations = [
    '["users"]',
    '["posts"]',
    '["stories"]',
    '["comments"]',
    '["messages"]',
  ];

  for (const pattern of forbiddenInvalidations) {
    if (keyString === pattern) {
      throw new Error(
        `[CACHE INVALIDATION VIOLATION] ${context} attempted to invalidate broad key ${keyString}. ` +
        `This affects ALL cached data and can cause cross-user state leaks. ` +
        `Use scoped keys like ['posts', 'detail', postId] instead.`
      );
    }
  }
}
