/**
 * Unified Unread Counts Store
 *
 * Manages two SEPARATE unread counters:
 * 1. notificationsUnread - Activity feed (likes, follows, comments, mentions, event updates)
 * 2. messagesUnread - Inbox messages ONLY (from followed users, NOT spam)
 *
 * CRITICAL: These counters must NEVER be mixed or double-counted.
 * - Messages should NOT inflate Activity unread count
 * - Spam messages should NOT inflate Messages unread count
 */

import { create } from "zustand";
import { messagesApiClient } from "@/lib/api/messages";

interface UnreadCountsState {
  // Activity/Notifications unread count (likes, follows, comments, mentions)
  notificationsUnread: number;
  // Messages unread count (Inbox ONLY - from followed users)
  messagesUnread: number;
  // Spam unread count (for display purposes only, not badge)
  spamUnread: number;
  // Loading states
  isLoadingNotifications: boolean;
  isLoadingMessages: boolean;
  // Last refresh timestamps
  lastNotificationsRefresh: number;
  lastMessagesRefresh: number;

  // Actions
  setNotificationsUnread: (count: number) => void;
  setMessagesUnread: (count: number) => void;
  setSpamUnread: (count: number) => void;
  incrementNotifications: (by?: number) => void;
  decrementNotifications: (by?: number) => void;
  incrementMessages: (by?: number) => void;
  decrementMessages: (by?: number) => void;
  incrementSpam: (by?: number) => void;
  decrementSpam: (by?: number) => void;
  clearNotifications: () => void;
  clearMessages: () => void;
  refreshMessagesUnread: () => Promise<void>;
  refreshAllCounts: () => Promise<void>;
  reset: () => void;
}

export const useUnreadCountsStore = create<UnreadCountsState>((set, get) => ({
  notificationsUnread: 0,
  messagesUnread: 0,
  spamUnread: 0,
  isLoadingNotifications: false,
  isLoadingMessages: false,
  lastNotificationsRefresh: 0,
  lastMessagesRefresh: 0,

  setNotificationsUnread: (count) => {
    console.log("[UnreadCounts] setNotificationsUnread:", count);
    set({ notificationsUnread: Math.max(0, count) });
  },

  setMessagesUnread: (count) => {
    console.log("[UnreadCounts] setMessagesUnread:", count);
    set({
      messagesUnread: Math.max(0, count),
      lastMessagesRefresh: Date.now(),
    });
  },

  setSpamUnread: (count) => {
    set({
      spamUnread: Math.max(0, count),
      lastMessagesRefresh: Date.now(),
    });
  },

  incrementNotifications: (by = 1) => {
    const current = get().notificationsUnread;
    console.log(
      "[UnreadCounts] incrementNotifications:",
      current,
      "->",
      current + by,
    );
    set({ notificationsUnread: current + by });
  },

  decrementNotifications: (by = 1) => {
    const current = get().notificationsUnread;
    console.log(
      "[UnreadCounts] decrementNotifications:",
      current,
      "->",
      Math.max(0, current - by),
    );
    set({ notificationsUnread: Math.max(0, current - by) });
  },

  incrementMessages: (by = 1) => {
    const current = get().messagesUnread;
    console.log(
      "[UnreadCounts] incrementMessages (Inbox only):",
      current,
      "->",
      current + by,
    );
    set({
      messagesUnread: current + by,
      lastMessagesRefresh: Date.now(),
    });
  },

  decrementMessages: (by = 1) => {
    const current = get().messagesUnread;
    console.log(
      "[UnreadCounts] decrementMessages:",
      current,
      "->",
      Math.max(0, current - by),
    );
    set({
      messagesUnread: Math.max(0, current - by),
      lastMessagesRefresh: Date.now(),
    });
  },

  incrementSpam: (by = 1) => {
    const current = get().spamUnread;
    console.log(
      "[UnreadCounts] incrementSpam:",
      current,
      "->",
      current + by,
    );
    set({
      spamUnread: current + by,
      lastMessagesRefresh: Date.now(),
    });
  },

  decrementSpam: (by = 1) => {
    const current = get().spamUnread;
    console.log(
      "[UnreadCounts] decrementSpam:",
      current,
      "->",
      Math.max(0, current - by),
    );
    set({
      spamUnread: Math.max(0, current - by),
      lastMessagesRefresh: Date.now(),
    });
  },

  clearNotifications: () => {
    console.log("[UnreadCounts] clearNotifications");
    set({ notificationsUnread: 0 });
  },

  clearMessages: () => {
    console.log("[UnreadCounts] clearMessages");
    set({ messagesUnread: 0, spamUnread: 0, lastMessagesRefresh: Date.now() });
  },

  // Refresh messages unread count from backend (Inbox only)
  refreshMessagesUnread: async () => {
    set({ isLoadingMessages: true });
    try {
      // PERF: Single combined call instead of 2 separate calls
      const { inbox, spam } = await messagesApiClient.getUnreadCounts();

      console.log("[UnreadCounts] refreshMessagesUnread:", {
        inboxUnread: inbox,
        spamUnread: spam,
      });

      set({
        messagesUnread: inbox,
        spamUnread: spam,
        lastMessagesRefresh: Date.now(),
      });
    } catch (error) {
      console.error("[UnreadCounts] refreshMessagesUnread error:", error);
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  // Refresh all unread counts
  refreshAllCounts: async () => {
    const { refreshMessagesUnread } = get();

    // Refresh messages count
    await refreshMessagesUnread();

    // TODO: Add notifications refresh when backend API is available
    // For now, notifications are managed locally via activity-store
    set({ lastNotificationsRefresh: Date.now() });
  },

  reset: () => {
    console.log("[UnreadCounts] reset all counts");
    set({
      notificationsUnread: 0,
      messagesUnread: 0,
      spamUnread: 0,
      isLoadingNotifications: false,
      isLoadingMessages: false,
      lastNotificationsRefresh: 0,
      lastMessagesRefresh: 0,
    });
  },
}));

// Helper hook to get just the messages badge count
export function useMessagesBadgeCount() {
  return useUnreadCountsStore((s) => s.messagesUnread);
}

// Helper hook to get notifications badge count
export function useNotificationsBadgeCount() {
  return useUnreadCountsStore((s) => s.notificationsUnread);
}
