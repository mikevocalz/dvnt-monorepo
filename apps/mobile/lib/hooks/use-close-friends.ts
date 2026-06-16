/**
 * TanStack Query hooks for Close Friends feature.
 * Manages the close friends list with optimistic updates.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { requireBetterAuthToken } from "@/lib/auth/identity";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUIStore } from "@/lib/stores/ui-store";

// ─── Types ───────────────────────────────────────────────────────────

export interface CloseFriend {
  id: number;
  username: string;
  name: string;
  avatar: string | null;
}

interface CloseFriendsListResponse {
  ok: boolean;
  data?: { friends: CloseFriend[]; friendIds: number[] };
  error?: { code: string; message: string };
}

// ─── Query Keys ──────────────────────────────────────────────────────

export const closeFriendsKeys = {
  all: (userId: string) => ["close-friends", userId] as const,
  list: (userId: string) => ["close-friends", userId, "list"] as const,
  ids: (userId: string) => ["close-friends", userId, "ids"] as const,
};

// ─── API Layer ───────────────────────────────────────────────────────

async function fetchCloseFriendsList(): Promise<{
  friends: CloseFriend[];
  friendIds: number[];
}> {
  const token = await requireBetterAuthToken();
  const { data, error } =
    await supabase.functions.invoke<CloseFriendsListResponse>("close-friends", {
      body: { action: "list" },
      headers: { Authorization: `Bearer ${token}` },
    });

  if (error || !data?.ok) {
    console.warn(
      "[close-friends] fetch failed, returning empty:",
      error?.message || data?.error?.message,
    );
    return { friends: [], friendIds: [] };
  }
  return data?.data || { friends: [], friendIds: [] };
}

async function addCloseFriend(friendId: number): Promise<void> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke("close-friends", {
    body: { action: "add", friendId },
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error) throw new Error(error.message || "Failed to add close friend");
  if (!data?.ok)
    throw new Error(data?.error?.message || "Failed to add close friend");
}

async function removeCloseFriend(friendId: number): Promise<void> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke("close-friends", {
    body: { action: "remove", friendId },
    headers: { Authorization: `Bearer ${token}` },
  });

  if (error) throw new Error(error.message || "Failed to remove close friend");
  if (!data?.ok)
    throw new Error(data?.error?.message || "Failed to remove close friend");
}

// ─── Hooks ───────────────────────────────────────────────────────────

/**
 * Fetch the current user's close friends list with user details.
 */
export function useCloseFriendsList() {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: closeFriendsKeys.list(user?.id || "__none__"),
    queryFn: fetchCloseFriendsList,
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 2,
    select: (data) => data.friends,
  });
}

/**
 * Fetch just the close friend IDs (lightweight, for checking membership).
 */
export function useCloseFriendIds() {
  const { user } = useAuthStore();
  return useQuery({
    queryKey: closeFriendsKeys.list(user?.id || "__none__"),
    queryFn: fetchCloseFriendsList,
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 2,
    select: (data) => new Set(data.friendIds),
  });
}

/**
 * Toggle a user as close friend (add if not, remove if already).
 * Optimistic UI with rollback.
 */
export function useToggleCloseFriend() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);

  return useMutation({
    mutationFn: async ({
      friendId,
      isCloseFriend,
    }: {
      friendId: number;
      isCloseFriend: boolean;
    }) => {
      if (isCloseFriend) {
        await removeCloseFriend(friendId);
      } else {
        await addCloseFriend(friendId);
      }
    },
    onMutate: async ({ friendId, isCloseFriend }) => {
      const key = closeFriendsKeys.list(user?.id || "");
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<{
        friends: CloseFriend[];
        friendIds: number[];
      }>(key);

      // Optimistic update
      queryClient.setQueryData(key, (old: any) => {
        if (!old) return old;
        if (isCloseFriend) {
          // Remove
          return {
            friends: old.friends.filter((f: CloseFriend) => f.id !== friendId),
            friendIds: old.friendIds.filter((id: number) => id !== friendId),
          };
        } else {
          // Add (we don't have full user data here, but friendIds is enough for checks)
          return {
            friends: old.friends,
            friendIds: [...old.friendIds, friendId],
          };
        }
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          closeFriendsKeys.list(user?.id || ""),
          context.previous,
        );
      }
      showToast("error", "Error", "Failed to update close friends");
    },
    onSettled: () => {
      // Refetch to get full user data for newly added friends
      queryClient.invalidateQueries({
        queryKey: closeFriendsKeys.list(user?.id || ""),
      });
    },
  });
}
