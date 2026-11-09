import { resetFollowAccessCaches } from "./reset-follow-access-caches";
/**
 * Hooks for managing user settings (notifications, privacy, messages, likes/comments)
 * Uses TanStack Query for data fetching and mutations with optimistic updates.
 * Persisted via the user-settings edge function → user_settings JSONB table.
 */

import { useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient, type MutateOptions } from "@tanstack/react-query";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { captureAuthContinuation } from "@dvnt/app/lib/auth/continuation-guard";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";

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

// ─── Account ownership ───────────────────────────────────────────────

type SettingsData = Record<string, unknown>;

// Observe store-only transitions too. A -> B -> A can happen in one React batch
// without a session boundary; the old A cache and mutation no longer belong to
// that sign-in even though its user ID and session epoch match again.
const settingsStoreIdentity = () => {
  const state = useAuthStore.getState();
  return JSON.stringify([state.isAuthenticated, state.user?.id, state.user?.authId]);
};
let settingsIdentity = settingsStoreIdentity();
let settingsIdentityRevision = 0;
const settingsIdentityListeners = new Set<() => void>();
useAuthStore.subscribe(() => {
  const next = settingsStoreIdentity();
  if (next === settingsIdentity) return;
  settingsIdentity = next;
  settingsIdentityRevision++;
  for (const listener of settingsIdentityListeners) listener();
});
const getSettingsIdentityRevision = () => settingsIdentityRevision;
function subscribeSettingsIdentityRevision(listener: () => void) {
  settingsIdentityListeners.add(listener);
  return () => { settingsIdentityListeners.delete(listener); };
}

export const settingsKeys = {
  all: (userId: string) => ["user-settings", userId] as const,
  session: (userId: string, epoch: number, authId: string | null, revision = settingsIdentityRevision) =>
    [...settingsKeys.all(userId), epoch, authId, revision] as const,
};

function useSettingsScope() {
  const user = useAuthStore((state) => state.user);
  const session = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle);
  const revision = useSyncExternalStore(subscribeSettingsIdentityRevision, getSettingsIdentityRevision, getSettingsIdentityRevision);
  const userId = user?.id || "";
  const authId = user?.authId || (userId && !/^\d+$/.test(userId) ? userId : null);
  return { userId, authId, session, revision, key: settingsKeys.session(userId, session.epoch, authId, revision) };
}

type SettingsScope = ReturnType<typeof useSettingsScope>;

function isScopeCurrent(scope: SettingsScope) {
  const user = useAuthStore.getState().user;
  const session = getSessionLifecycle();
  const authId = user?.authId || (user?.id && !/^\d+$/.test(user.id) ? user.id : null);
  return Boolean(scope.userId && user?.id === scope.userId && authId === scope.authId &&
    scope.revision === settingsIdentityRevision && scope.session.ready && session.ready && session.epoch === scope.session.epoch &&
    // A successful login can change the session before the app profile updates.
    (!session.authId || session.authId === scope.authId));
}

function captureSettingsOwner(scope: SettingsScope, signal?: AbortSignal) {
  const continuation = captureAuthContinuation();
  const isCurrent = () => !signal?.aborted && continuation.isCurrent() && isScopeCurrent(scope);
  return {
    key: scope.key,
    authId: scope.authId,
    isCurrent,
    assertCurrent: () => {
      if (!isCurrent()) throw new Error("Account changed. Reload settings and try again.");
    },
    release: continuation.release,
  };
}

type SettingsOwner = ReturnType<typeof captureSettingsOwner>;

// ─── API Layer ───────────────────────────────────────────────────────

async function requestUserSettings(
  owner: SettingsOwner,
  partial?: SettingsData,
  signal?: AbortSignal,
): Promise<SettingsData> {
  owner.assertCurrent();
  const token = await requireBetterAuthToken();
  // Token retries can span a switch or a new sign-in, even with the same user ID.
  owner.assertCurrent();
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: { settings: SettingsData };
    error?: { code: string; message: string };
  }>("user-settings", {
    body: {
      ...(partial ? { action: "update", settings: partial } : { action: "get" }),
      ...(owner.authId ? { expectedAuthId: owner.authId } : {}),
    },
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  owner.assertCurrent();
  if (error || !data?.ok) {
    throw new Error(error?.message || data?.error?.message ||
      (partial ? "Failed to save settings" : "Could not load privacy settings"));
  }
  return data.data?.settings || {};
}

// ─── Generic Settings Hooks ──────────────────────────────────────────

function useAllSettings() {
  const scope = useSettingsScope();
  return useQuery({
    queryKey: scope.key,
    queryFn: async ({ signal }) => {
      const owner = captureSettingsOwner(scope, signal);
      try {
        return await requestUserSettings(owner, undefined, signal);
      } finally {
        owner.release();
      }
    },
    enabled: isScopeCurrent(scope),
    staleTime: 1000 * 60 * 5,
  });
}

type SettingsMutationContext = { previous: SettingsData | undefined };
type SettingsMutationOptions<T> = MutateOptions<SettingsData, Error, Partial<T>, SettingsMutationContext>;

function useUpdateSettings<K extends keyof AllUserSettings>(
  section: K,
  defaults: AllUserSettings[K],
  errorMessage: string,
) {
  const queryClient = useQueryClient();
  const showToast = useUIStore((state) => state.showToast);
  const scope = useSettingsScope();
  type Prefs = Partial<AllUserSettings[K]>;
  type Variables = { prefs: Prefs; owner: SettingsOwner };
  const changesAccess = (prefs: Prefs) => section === "privacy" &&
    (prefs as Partial<PrivacySettings>).privateAccount !== undefined;

  const mutation = useMutation<SettingsData, Error, Variables, SettingsMutationContext>({
    mutationKey: ["update-user-settings", section, ...scope.key],
    mutationFn: ({ prefs, owner }) => requestUserSettings(owner, { [section]: prefs }),
    onMutate: async ({ prefs, owner }) => {
      owner.assertCurrent();
      if (changesAccess(prefs)) {
        await resetFollowAccessCaches(queryClient, false, owner.isCurrent);
        owner.assertCurrent();
      }
      await queryClient.cancelQueries({ queryKey: owner.key });
      owner.assertCurrent();
      const previous = queryClient.getQueryData<SettingsData>(owner.key);
      queryClient.setQueryData(owner.key, (old: SettingsData | undefined) => ({
        ...old,
        [section]: { ...defaults, ...(old?.[section] as object || {}), ...prefs },
      }));
      return { previous };
    },
    onError: (_error, { owner }, context) => {
      if (!owner.isCurrent()) return;
      if (context?.previous) queryClient.setQueryData(owner.key, context.previous);
      showToast("error", "Error", errorMessage);
    },
    onSettled: async (_data, _error, { prefs, owner }) => {
      if (!owner.isCurrent()) return;
      if (changesAccess(prefs)) {
        await resetFollowAccessCaches(queryClient, true, owner.isCurrent);
        if (!owner.isCurrent()) return;
      }
      await queryClient.invalidateQueries({ queryKey: owner.key });
    },
  });

  const mutateAsync = (prefs: Prefs, options?: SettingsMutationOptions<AllUserSettings[K]>) => {
    // Capture before React Query's own onMutate awaits. Variables, unlike hook
    // closures, stay bound to this call across rerenders and mutation retries.
    const owner = captureSettingsOwner(scope);
    return mutation.mutateAsync({ prefs: { ...prefs }, owner }, {
      onSuccess: (data, variables, ...rest) => {
        if (owner.isCurrent()) options?.onSuccess?.(data, variables.prefs, ...rest);
      },
      onError: (error, variables, ...rest) => {
        if (owner.isCurrent()) options?.onError?.(error, variables.prefs, ...rest);
      },
      onSettled: (data, error, variables, ...rest) => {
        if (owner.isCurrent()) options?.onSettled?.(data, error, variables.prefs, ...rest);
      },
    }).then((data) => {
      owner.assertCurrent();
      return data;
    }).finally(owner.release);
  };

  // React Query resets an observer after its mutationKey changes, but its
  // previous result can still reach this render first. Never expose that
  // operation's status or payload in the new account/sign-in, including a
  // completed mutation whose per-operation subscription has been released.
  const stale = mutation.variables !== undefined && !mutation.variables.owner.isCurrent();
  return {
    ...mutation,
    ...(stale ? {
      status: "idle" as const,
      isIdle: true,
      isPending: false,
      isSuccess: false,
      isError: false,
      isPaused: false,
      data: undefined,
      error: null,
      context: undefined,
      failureCount: 0,
      failureReason: null,
      submittedAt: 0,
    } : {}),
    variables: stale ? undefined : mutation.variables?.prefs,
    mutateAsync,
    mutate: (prefs: Prefs, options?: SettingsMutationOptions<AllUserSettings[K]>) => {
      void mutateAsync(prefs, options).catch(() => {});
    },
  };
}

// ─── Scoped Hooks: Notifications ─────────────────────────────────────

export function useNotificationPrefs() {
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
  return useUpdateSettings("notifications", DEFAULT_NOTIFICATION_PREFS, "Failed to update notification settings");
}

// ─── Scoped Hooks: Privacy ───────────────────────────────────────────

export function usePrivacySettings() {
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
  return useUpdateSettings("privacy", DEFAULT_PRIVACY_SETTINGS, "Failed to update privacy settings");
}

// ─── Scoped Hooks: Messages ──────────────────────────────────────────

export function useMessagesPrefs() {
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
  return useUpdateSettings("messages", DEFAULT_MESSAGES_PREFS, "Failed to update message settings");
}

// ─── Scoped Hooks: Likes & Comments ──────────────────────────────────

export function useLikesCommentsPrefs() {
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
  return useUpdateSettings("likesComments", DEFAULT_LIKES_COMMENTS_PREFS, "Failed to update likes & comments settings");
}
