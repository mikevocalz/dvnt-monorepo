// Viewer-scoped message query keys.
// The viewer id must stay in the key to prevent cross-user cache pollution.
export const messageKeys = {
  all: (viewerId?: string) => ["messages", viewerId || "__no_user__"] as const,
  unreadCount: (viewerId?: string) =>
    [...messageKeys.all(viewerId), "unreadCount"] as const,
  spamUnreadCount: (viewerId?: string) =>
    [...messageKeys.all(viewerId), "spamUnreadCount"] as const,
  conversations: (viewerId?: string) =>
    [...messageKeys.all(viewerId), "conversations"] as const,
};
