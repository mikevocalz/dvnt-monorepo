/**
 * React Query hooks for stories
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  storiesApi as storiesApiClient,
  storyViewsApi,
} from "@/lib/api/stories";
import { useAuthStore } from "@/lib/stores/auth-store";
import type { Story, StoryOverlay } from "@/lib/types";
import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";

// Query keys
export const storyKeys = {
  all: ["stories"] as const,
  list: () => [...storyKeys.all, "list"] as const,
};

export const storyViewKeys = {
  all: ["story-views"] as const,
  viewers: (storyId: string) =>
    [...storyViewKeys.all, "viewers", storyId] as const,
  count: (storyId: string) => [...storyViewKeys.all, "count", storyId] as const,
};

function normalizePersistedStoryId(storyId: string | undefined) {
  if (!storyId) return undefined;
  return /^\d+$/.test(storyId) ? storyId : undefined;
}

function buildStoryGroup(
  currentUser: ReturnType<typeof useAuthStore.getState>["user"],
  storyData: {
    id: string;
    authorId?: string;
    author?: { username?: string; avatar?: string | null };
  },
  items: Array<{
    type: string;
    url?: string;
    thumbnail?: string;
    text?: string;
    textColor?: string;
    backgroundColor?: string;
    animatedGifOverlays?: import("@/lib/types").StoryAnimatedGifOverlay[];
    storyOverlays?: StoryOverlay[];
  }>,
  visibility?: "public" | "close_friends",
): Story {
  const resolvedUsername =
    storyData.author?.username || currentUser?.username || "You";
  const resolvedAvatar = storyData.author?.avatar || currentUser?.avatar || "";

  return {
    id: String(storyData.id),
    userId: String(storyData.authorId || currentUser?.id || ""),
    username: resolvedUsername,
    avatar: resolvedAvatar,
    hasStory: true,
    isViewed: false,
    isYou: true,
    hasCloseFriendsStory: visibility === "close_friends",
    items: items.map((item, index) => ({
      id: `${storyData.id}-item-${index}`,
      type: item.type as "image" | "gif" | "video" | "text",
      url: item.url,
      thumbnail: item.thumbnail,
      text: item.text,
      textColor: item.textColor,
      backgroundColor: item.backgroundColor,
      animatedGifOverlays: item.animatedGifOverlays || [],
      storyOverlays: item.storyOverlays || [],
      duration: item.type === "video" ? 30000 : 5000,
      visibility,
    })),
  };
}

// Fetch all stories
export function useStories() {
  return useQuery({
    queryKey: storyKeys.list(),
    queryFn: () => storiesApiClient.getStories(),
    staleTime: STALE_TIMES.stories,
    gcTime: GC_TIMES.standard, // 30min — keep stories in cache through background periods
    refetchInterval: 60 * 1000, // Background refresh every 60s
    refetchOnMount: false, // Prevent double loading on mount
    // Inherits global refetchOnMount: false — no flicker on tab switch
  });
}

// Create story mutation
export function useCreateStory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: storiesApiClient.createStory,
    onMutate: async (newStoryData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: storyKeys.all });

      // Get current user for optimistic update
      const currentUser = useAuthStore.getState().user;

      // Snapshot previous data
      const previousData = queryClient.getQueryData<Story[]>(storyKeys.list());

      // Optimistically add the new story
      // CRITICAL: For optimistic update, we use currentUser.avatar since this IS the user's own story
      // This is allowed because the story being created belongs to the current user
      // The avatar will be replaced with the server's response which comes from entity data
      queryClient.setQueryData<Story[]>(storyKeys.list(), (old) => {
        const optimisticStory = buildStoryGroup(
          currentUser,
          {
            id: `temp-${Date.now()}`,
            authorId: currentUser?.id,
            author: {
              username: currentUser?.username,
              avatar: currentUser?.avatar,
            },
          },
          newStoryData.items || [],
          newStoryData.visibility,
        );
        return old && old.length > 0
          ? [optimisticStory, ...old]
          : [optimisticStory];
      });

      return { previousData };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(storyKeys.list(), context.previousData);
      }
    },
    onSuccess: async (createdStory, variables) => {
      const currentUser = useAuthStore.getState().user;

      queryClient.setQueryData<Story[]>(storyKeys.list(), (old) => {
        const nextStory = buildStoryGroup(
          currentUser,
          {
            id: String(createdStory.id),
            authorId: createdStory.authorId,
            author: createdStory.author,
          },
          variables.items || [],
          variables.visibility,
        );

        if (!old || old.length === 0) return [nextStory];

        let replaced = false;
        const currentUserId = String(currentUser?.id || nextStory.userId || "");
        const next = old.map((story) => {
          const storyUserId = String(story.userId || "");
          const matchesOwner =
            storyUserId === currentUserId ||
            story.username?.toLowerCase() === nextStory.username.toLowerCase();
          const isTemp = String(story.id).startsWith("temp-");

          if (matchesOwner && (isTemp || story.isYou)) {
            replaced = true;
            return {
              ...story,
              ...nextStory,
            };
          }

          return story;
        });

        return replaced ? next : [nextStory, ...old];
      });

      // CRITICAL: Invalidate to refetch from server so avatar comes from
      // entity data (author record), NOT authUser. Building a story object
      // here with currentUser.avatar would leak the user's latest profile
      // avatar into the story display — a SEV-0 data isolation violation.
      await queryClient.invalidateQueries({ queryKey: storyKeys.list() });
    },
  });
}

// Delete story mutation with optimistic update
export function useDeleteStory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: storiesApiClient.deleteStory,
    onMutate: async (deletedStoryId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: storyKeys.all });

      // Snapshot previous data for rollback
      const previousData = queryClient.getQueryData<Story[]>(storyKeys.list());

      // Optimistically remove from stories list
      queryClient.setQueryData<Story[]>(storyKeys.list(), (old) => {
        if (!old) return old;
        return old.filter(
          (story) => String(story.id) !== String(deletedStoryId),
        );
      });

      return { previousData };
    },
    onError: (_err, _deletedStoryId, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(storyKeys.list(), context.previousData);
      }
    },
    onSuccess: (_result, deletedStoryId) => {
      console.log(
        "[useDeleteStory] Story deleted successfully:",
        deletedStoryId,
      );
      // Invalidate to refetch the full list after optimistic removal
      queryClient.invalidateQueries({ queryKey: storyKeys.list() });
    },
  });
}

// Fetch viewers for a story (only useful for own stories) — polls every 5s
// but returns cached data INSTANTLY while the refresh runs in the background.
// Previously `staleTime: 0` meant every reopen showed a spinner before any
// row rendered; now the sheet opens with the last-known list and refreshes
// seamlessly.
export function useStoryViewers(storyId: string | undefined) {
  const persistedStoryId = normalizePersistedStoryId(storyId);
  return useQuery({
    queryKey: storyViewKeys.viewers(persistedStoryId || ""),
    queryFn: () => storyViewsApi.getViewers(persistedStoryId!),
    enabled: !!persistedStoryId,
    // One tick shy of the poll interval — cached list renders immediately
    // on reopen, then the next 5s poll refreshes it.
    staleTime: 4500,
    refetchInterval: 5000,
  });
}

// Fetch viewer count for a story — polls every 5s to stay current
export function useStoryViewerCount(storyId: string | undefined) {
  const persistedStoryId = normalizePersistedStoryId(storyId);
  return useQuery({
    queryKey: storyViewKeys.count(persistedStoryId || ""),
    queryFn: () => storyViewsApi.getViewerCount(persistedStoryId!),
    enabled: !!persistedStoryId,
    staleTime: 0,
    refetchInterval: 5000,
  });
}

// Fetch total viewer count across ALL story items for a user
export function useStoryViewerCountTotal(storyItemIds: string[]) {
  const persistedStoryItemIds = storyItemIds.filter((id) => /^\d+$/.test(id));
  return useQuery({
    queryKey: [...storyViewKeys.all, "countTotal", ...persistedStoryItemIds],
    queryFn: async () => {
      if (!persistedStoryItemIds.length) return 0;
      // Get unique viewers across all items
      const allViewerSets = await Promise.all(
        persistedStoryItemIds.map((id) => storyViewsApi.getViewers(id)),
      );
      const uniqueUserIds = new Set<number>();
      for (const viewers of allViewerSets) {
        for (const v of viewers) {
          uniqueUserIds.add(v.userId);
        }
      }
      return uniqueUserIds.size;
    },
    enabled: persistedStoryItemIds.length > 0,
    staleTime: 0,
    refetchInterval: 5000,
  });
}

// Record a story view (fire-and-forget mutation)
export function useRecordStoryView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (storyId: string) => storyViewsApi.recordView(storyId),
    onSuccess: (_result, storyId) => {
      // Invalidate ALL viewer queries so the owner sees updated numbers
      // This covers per-item count, per-item viewers, AND the total aggregation
      queryClient.invalidateQueries({ queryKey: storyViewKeys.all });
    },
  });
}
