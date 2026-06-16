/**
 * TanStack Query hooks for post tags (Instagram-style user tagging)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { postTagsApi, type PostTag, type TagDiffInput } from "../api/post-tags";
import { postKeys } from "./use-posts";

// ── Query Keys ──────────────────────────────────────────────
export const postTagKeys = {
  all: ["postTags"] as const,
  forPost: (postId: string) => ["postTags", postId] as const,
  taggedPosts: (userId: string) => ["profileTaggedPosts", userId] as const,
};

// ── Fetch tags for a single post ────────────────────────────
export function usePostTags(postId: string | undefined) {
  return useQuery({
    queryKey: postTagKeys.forPost(postId || ""),
    queryFn: () => postTagsApi.getTagsForPost(postId!),
    enabled: !!postId,
    staleTime: 5 * 60 * 1000, // 5 min — tags change rarely
  });
}

// ── Fetch tagged posts for a user (profile Tagged tab) ──────
export function useTaggedPosts(userId: string | undefined) {
  return useQuery({
    queryKey: postTagKeys.taggedPosts(userId || ""),
    queryFn: () => postTagsApi.getTaggedPosts(parseInt(userId!)),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ── Save tags diff (optimistic) ─────────────────────────────
export function useSaveTagsDiff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      postId,
      previous,
      next,
    }: {
      postId: string;
      previous: PostTag[];
      next: TagDiffInput[];
    }) => postTagsApi.saveTagsDiff(postId, previous, next),

    onMutate: async ({ postId, next }) => {
      await queryClient.cancelQueries({
        queryKey: postTagKeys.forPost(postId),
      });

      const previousTags = queryClient.getQueryData<PostTag[]>(
        postTagKeys.forPost(postId),
      );

      // Optimistic: build fake PostTag[] from next
      const optimistic: PostTag[] = next.map((t, i) => ({
        id: -(i + 1), // negative IDs for optimistic entries
        postId: parseInt(postId),
        taggedUserId: t.userId,
        taggedByUserId: 0,
        username: t.username,
        avatar: t.avatar,
        xPosition: t.x,
        yPosition: t.y,
        mediaIndex: t.mediaIndex,
      }));

      queryClient.setQueryData(postTagKeys.forPost(postId), optimistic);

      return { previousTags };
    },

    onError: (_err, { postId }, context) => {
      if (context?.previousTags) {
        queryClient.setQueryData(
          postTagKeys.forPost(postId),
          context.previousTags,
        );
      }
    },

    onSuccess: (data, { postId }) => {
      // Replace optimistic data with server data
      queryClient.setQueryData(postTagKeys.forPost(postId), data);
      // Invalidate related caches - use proper key factories
      queryClient.invalidateQueries({ queryKey: postKeys.feedInfinite() });
      queryClient.invalidateQueries({ queryKey: postKeys.detail(postId) });
    },
  });
}

// ── Add tags (simple, no diff) ──────────────────────────────
export function useAddPostTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      postId,
      tags,
    }: {
      postId: string;
      tags: Array<{
        userId: number;
        x: number;
        y: number;
        mediaIndex?: number;
      }>;
    }) => postTagsApi.addTags(postId, tags),

    onSuccess: (data, { postId }) => {
      queryClient.setQueryData(postTagKeys.forPost(postId), data);
    },
  });
}

// ── Remove a single tag ─────────────────────────────────────
export function useRemovePostTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      postId,
      taggedUserId,
      mediaIndex,
    }: {
      postId: string;
      taggedUserId: number;
      mediaIndex?: number;
    }) => postTagsApi.removeTag(postId, taggedUserId, mediaIndex),

    onMutate: async ({ postId, taggedUserId, mediaIndex = 0 }) => {
      await queryClient.cancelQueries({
        queryKey: postTagKeys.forPost(postId),
      });
      const prev = queryClient.getQueryData<PostTag[]>(
        postTagKeys.forPost(postId),
      );
      if (prev) {
        queryClient.setQueryData(
          postTagKeys.forPost(postId),
          prev.filter(
            (t) =>
              !(t.taggedUserId === taggedUserId && t.mediaIndex === mediaIndex),
          ),
        );
      }
      return { prev };
    },

    onError: (_err, { postId }, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(postTagKeys.forPost(postId), ctx.prev);
      }
    },

    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: postTagKeys.forPost(postId) });
    },
  });
}
