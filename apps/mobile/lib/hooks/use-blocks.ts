/**
 * Hooks for managing blocked users
 * Uses TanStack Query for data fetching and mutations with optimistic updates
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { blocksApi } from "@/lib/api/blocks";
import { useUIStore } from "@/lib/stores/ui-store";
import { useAuthStore } from "@/lib/stores/auth-store";

export interface BlockedUser {
  id: string;
  blockId: string;
  userId: string;
  username: string;
  name: string;
  avatar: string | null;
  blockedAt: string;
}

interface BlockResponse {
  id: string;
  blocker: string | { id: string };
  blocked:
    | string
    | {
        id: string;
        username?: string;
        firstName?: string;
        lastName?: string;
        avatar?: { url?: string } | string;
      };
  reason?: string;
  createdAt: string;
}

function transformBlockedUser(block: BlockResponse): BlockedUser {
  const blocked = block.blocked;

  if (typeof blocked === "string") {
    return {
      id: block.id,
      blockId: block.id,
      userId: blocked,
      username: "unknown",
      name: "Unknown User",
      avatar: null,
      blockedAt: block.createdAt,
    };
  }

  const avatarUrl =
    typeof blocked.avatar === "object" && blocked.avatar?.url
      ? blocked.avatar.url
      : typeof blocked.avatar === "string"
        ? blocked.avatar
        : null;

  return {
    id: block.id,
    blockId: block.id,
    userId: blocked.id,
    username: blocked.username || "unknown",
    name:
      [blocked.firstName, blocked.lastName].filter(Boolean).join(" ") ||
      blocked.username ||
      "Unknown",
    avatar: avatarUrl,
    blockedAt: block.createdAt,
  };
}

/**
 * Hook to fetch all blocked users
 */
export function useBlockedUsers() {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["blocked-users", user?.id],
    queryFn: async () => {
      const blockedUsers = await blocksApi.getBlockedUsers();
      return blockedUsers;
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to block a user
 */
export function useBlockUser() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      userId,
      reason,
    }: {
      userId: string;
      reason?: string;
    }) => {
      return await blocksApi.blockUser(userId);
    },
    onMutate: async ({ userId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["blocked-users"] });

      // Snapshot previous value
      const previousBlocked = queryClient.getQueryData<BlockedUser[]>([
        "blocked-users",
        user?.id,
      ]);

      // Optimistically add the blocked user (we'll get full data on success)
      // For now, add a placeholder
      if (previousBlocked) {
        queryClient.setQueryData<BlockedUser[]>(
          ["blocked-users", user?.id],
          [
            ...previousBlocked,
            {
              id: `temp-${userId}`,
              blockId: `temp-${userId}`,
              userId,
              username: "...",
              name: "Loading...",
              avatar: null,
              blockedAt: new Date().toISOString(),
            },
          ],
        );
      }

      return { previousBlocked };
    },
    onError: (error: any, variables, context) => {
      // Rollback on error
      if (context?.previousBlocked) {
        queryClient.setQueryData(
          ["blocked-users", user?.id],
          context.previousBlocked,
        );
      }
      showToast("error", "Error", error?.message || "Failed to block user");
    },
    onSuccess: () => {
      showToast("success", "Blocked", "User has been blocked");
    },
    onSettled: () => {
      // Refetch to get accurate data
      queryClient.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });
}

/**
 * Hook to unblock a user
 */
export function useUnblockUser() {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async (blockId: string) => {
      return await blocksApi.unblockUser(blockId);
    },
    onMutate: async (blockId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["blocked-users"] });

      // Snapshot previous value
      const previousBlocked = queryClient.getQueryData<BlockedUser[]>([
        "blocked-users",
        user?.id,
      ]);

      // Optimistically remove the blocked user
      if (previousBlocked) {
        queryClient.setQueryData<BlockedUser[]>(
          ["blocked-users", user?.id],
          previousBlocked.filter((b) => b.blockId !== blockId),
        );
      }

      return { previousBlocked };
    },
    onError: (error: any, variables, context) => {
      // Rollback on error
      if (context?.previousBlocked) {
        queryClient.setQueryData(
          ["blocked-users", user?.id],
          context.previousBlocked,
        );
      }
      showToast("error", "Error", error?.message || "Failed to unblock user");
    },
    onSuccess: () => {
      showToast("success", "Unblocked", "User has been unblocked");
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ["blocked-users"] });
    },
  });
}

/**
 * Hook to check if a specific user is blocked
 */
export function useIsUserBlocked(userId: string) {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ["is-blocked", userId],
    queryFn: async () => {
      // TODO: Implement isBlocked in blocksApi
      return false;
    },
    enabled: !!user?.id && !!userId,
    staleTime: 1000 * 60, // 1 minute
  });
}
