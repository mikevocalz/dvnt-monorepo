/**
 * Hooks for managing user settings (notifications, privacy, messages, likes/comments)
 * Uses TanStack Query for data fetching and mutations with optimistic updates.
 * Persisted via the user-settings edge function → user_settings JSONB table.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { supabase } from "@/lib/supabase/client";
import { requireBetterAuthToken } from "@/lib/auth/identity";

// ─── Types ───────────────────────────────────────────────────────────

export interface NotificationPrefs {
  pauseAll: boolean;
  likes: boolean;
  comments: boolean;
  follows: boolean;
  mentions: boolean;
  messages: boolean;
  liveVideos: boolean;
  emailNotifications: boolean;
}

export interface PrivacySettings {
  privateAccount: boolean;
  activityStatus: boolean;
  readReceipts: boolean;
  showLikes: boolean;
}

export interface MessagesPrefs {
  allowAll: boolean;
  messageRequests: boolean;
  groupRequests: boolean;
  readReceipts: boolean;
}

export interface LikesCommentsPrefs {
  hideLikeCounts: boolean;
  allowComments: boolean;
  filterComments: boolean;
  manualFilter: boolean;
}

export interface AllUserSettings {
  notifications: NotificationPrefs;
  privacy: PrivacySettings;
  messages: MessagesPrefs;
  likesComments: LikesCommentsPrefs;
}

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  pauseAll: false,
  likes: true,
  comments: true,
  follows: true,
  mentions: true,
  messages: true,
  liveVideos: false,
  emailNotifications: false,
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  privateAccount: false,
  activityStatus: true,
  readReceipts: true,
  showLikes: true,
};

const DEFAULT_MESSAGES_PREFS: MessagesPrefs = {
  allowAll: false,
  messageRequests: true,
  groupRequests: true,
  readReceipts: true,
};

const DEFAULT_LIKES_COMMENTS_PREFS: LikesCommentsPrefs = {
  hideLikeCounts: false,
  allowComments: true,
  filterComments: true,
  manualFilter: false,
};

// ─── API Layer ───────────────────────────────────────────────────────

async function fetchUserSettings(): Promise<Record<string, unknown>> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: { settings: Record<string, unknown> };
    error?: { code: string; message: string };
  }>("user-settings", {
    body: { action: "get" },
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error || !data?.ok) {
    console.warn(
      "[user-settings] fetch failed, returning defaults:",
      error?.message || data?.error?.message,
    );
    return {};
  }
  return data?.data?.settings || {};
}

async function updateUserSettings(
  partial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: { settings: Record<string, unknown> };
    error?: { code: string; message: string };
  }>("user-settings", {
    body: { action: "update", settings: partial },
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error) throw new Error(error.message || "Failed to save settings");
  if (!data?.ok)
    throw new Error(data?.error?.message || "Failed to save settings");
  return data?.data?.settings || {};
}

// ─── Query Keys ──────────────────────────────────────────────────────

export const settingsKeys = {
  all: (userId: string) => ["user-settings", userId] as const,
};

// ─── Generic Settings Hook ───────────────────────────────────────────

function useAllSettings() {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: settingsKeys.all(user?.id || "__none__"),
    queryFn: fetchUserSettings,
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5,
  });
}

// ─── Scoped Hooks: Notifications ─────────────────────────────────────

export function useNotificationPrefs() {
  const { user } = useAuthStore();
  const allSettings = useAllSettings();

  const data: NotificationPrefs = {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...((allSettings.data as any)?.notifications || {}),
  };

  return {
    ...allSettings,
    data,
  };
}

export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (prefs: Partial<NotificationPrefs>) => {
      return updateUserSettings({ notifications: prefs });
    },
    onMutate: async (newPrefs) => {
      const key = settingsKeys.all(user?.id || "");
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Record<string, unknown>>(key);
      queryClient.setQueryData(key, (old: any) => ({
        ...old,
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFS,
          ...(old?.notifications || {}),
          ...newPrefs,
        },
      }));
      return { previous };
    },
    onError: (_err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          settingsKeys.all(user?.id || ""),
          context.previous,
        );
      }
      showToast("error", "Error", "Failed to update notification settings");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.all(user?.id || ""),
      });
    },
  });
}

// ─── Scoped Hooks: Privacy ───────────────────────────────────────────

export function usePrivacySettings() {
  const { user } = useAuthStore();
  const allSettings = useAllSettings();

  const data: PrivacySettings = {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...((allSettings.data as any)?.privacy || {}),
  };

  return {
    ...allSettings,
    data,
  };
}

export function useUpdatePrivacySettings() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (settings: Partial<PrivacySettings>) => {
      return updateUserSettings({ privacy: settings });
    },
    onMutate: async (newSettings) => {
      const key = settingsKeys.all(user?.id || "");
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Record<string, unknown>>(key);
      queryClient.setQueryData(key, (old: any) => ({
        ...old,
        privacy: {
          ...DEFAULT_PRIVACY_SETTINGS,
          ...(old?.privacy || {}),
          ...newSettings,
        },
      }));
      return { previous };
    },
    onError: (_err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          settingsKeys.all(user?.id || ""),
          context.previous,
        );
      }
      showToast("error", "Error", "Failed to update privacy settings");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.all(user?.id || ""),
      });
    },
  });
}

// ─── Scoped Hooks: Messages ──────────────────────────────────────────

export function useMessagesPrefs() {
  const { user } = useAuthStore();
  const allSettings = useAllSettings();

  const data: MessagesPrefs = {
    ...DEFAULT_MESSAGES_PREFS,
    ...((allSettings.data as any)?.messages || {}),
  };

  return {
    ...allSettings,
    data,
  };
}

export function useUpdateMessagesPrefs() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (prefs: Partial<MessagesPrefs>) => {
      return updateUserSettings({ messages: prefs });
    },
    onMutate: async (newPrefs) => {
      const key = settingsKeys.all(user?.id || "");
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Record<string, unknown>>(key);
      queryClient.setQueryData(key, (old: any) => ({
        ...old,
        messages: {
          ...DEFAULT_MESSAGES_PREFS,
          ...(old?.messages || {}),
          ...newPrefs,
        },
      }));
      return { previous };
    },
    onError: (_err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          settingsKeys.all(user?.id || ""),
          context.previous,
        );
      }
      showToast("error", "Error", "Failed to update message settings");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.all(user?.id || ""),
      });
    },
  });
}

// ─── Scoped Hooks: Likes & Comments ──────────────────────────────────

export function useLikesCommentsPrefs() {
  const { user } = useAuthStore();
  const allSettings = useAllSettings();

  const data: LikesCommentsPrefs = {
    ...DEFAULT_LIKES_COMMENTS_PREFS,
    ...((allSettings.data as any)?.likesComments || {}),
  };

  return {
    ...allSettings,
    data,
  };
}

export function useUpdateLikesCommentsPrefs() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (prefs: Partial<LikesCommentsPrefs>) => {
      return updateUserSettings({ likesComments: prefs });
    },
    onMutate: async (newPrefs) => {
      const key = settingsKeys.all(user?.id || "");
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Record<string, unknown>>(key);
      queryClient.setQueryData(key, (old: any) => ({
        ...old,
        likesComments: {
          ...DEFAULT_LIKES_COMMENTS_PREFS,
          ...(old?.likesComments || {}),
          ...newPrefs,
        },
      }));
      return { previous };
    },
    onError: (_err: any, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          settingsKeys.all(user?.id || ""),
          context.previous,
        );
      }
      showToast("error", "Error", "Failed to update likes & comments settings");
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.all(user?.id || ""),
      });
    },
  });
}
