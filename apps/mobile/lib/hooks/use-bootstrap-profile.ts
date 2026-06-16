/**
 * Bootstrap Profile Hook
 *
 * When `perf_bootstrap_profile` flag is ON, fetches all profile above-the-fold
 * data in a single request and hydrates the TanStack Query cache.
 *
 * When the flag is OFF, returns early and the profile falls back to
 * individual queries (useMyProfile, useProfilePosts, etc.)
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useAppStore } from "@/lib/stores/app-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  bootstrapApi,
  type BootstrapProfileResponse,
} from "@/lib/api/bootstrap";
import { postsApi } from "@/lib/api/posts";
import { profileKeys } from "@/lib/hooks/use-profile";
import { postKeys } from "@/lib/hooks/use-posts";
import { useScreenTrace } from "@/lib/perf/screen-trace";
import {
  normalizeTextPostTheme,
  resolveTextPostPresentation,
} from "@/lib/posts/text-post";
import type { Post } from "@/lib/types";

function hydrateFromProfileBootstrap(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  data: BootstrapProfileResponse,
) {
  const p = data.profile;

  // 1. Seed the profile query cache
  queryClient.setQueryData(profileKeys.byId(userId), {
    id: p.id,
    username: p.username,
    name: p.firstName || p.username,
    displayName: p.firstName || p.username,
    bio: p.bio,
    avatar: p.avatarUrl || undefined,
    avatarUrl: p.avatarUrl || undefined,
    website: p.website,
    location: p.location,
    followersCount: p.followersCount,
    followingCount: p.followingCount,
    postsCount: p.postsCount,
    verified: p.verified,
    isOwnProfile: true,
  });

  // 2. Seed the profile posts query cache with grid thumbnail data
  queryClient.setQueryData(
    postKeys.profilePosts(userId),
    data.posts.map((post) => {
      const isTextPost = post.kind === "text";
      const media =
        Array.isArray(post.media) && post.media.length > 0
          ? post.media
          : post.thumbnailUrl
            ? [{ type: post.type || "image", url: post.thumbnailUrl }]
            : [];
      const textPresentation =
        isTextPost
          ? resolveTextPostPresentation(
              [
                {
                  id: `${post.id}-slide-0`,
                  order: 0,
                  content: post.caption || "",
                },
              ],
              post.caption,
            )
          : { textSlides: [], caption: "", previewText: "" };

      return {
        id: post.id,
        author: {
          id: p.id,
          username: p.username,
          avatar: p.avatarUrl || "",
          verified: p.verified,
          name: p.firstName || p.username,
        },
        media: isTextPost ? [] : media,
        kind: isTextPost ? "text" : "media",
        textTheme: isTextPost
          ? normalizeTextPostTheme(post.textTheme)
          : undefined,
        caption: isTextPost ? textPresentation.caption : post.caption || "",
        textSlides: isTextPost ? textPresentation.textSlides : undefined,
        textSlideCount:
          isTextPost
            ? Math.max(
                post.textSlideCount || 0,
                textPresentation.textSlides.length,
              )
            : 0,
        likes: post.likesCount || 0,
        viewerHasLiked: false,
        comments: 0,
        timeAgo: "",
        location: undefined,
        isNSFW: post.isNSFW || false,
        thumbnail: !isTextPost ? post.thumbnailUrl || undefined : undefined,
        type: !isTextPost ? (post.type as any) || "image" : undefined,
        hasMultipleImages: !isTextPost && media.length > 1,
      };
    }),
  );

  console.log(
    `[BootstrapProfile] Hydrated cache: profile + ${data.posts.length} posts`,
  );
}

async function hydrateBootstrapProfileTextPosts(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  posts: BootstrapProfileResponse["posts"],
) {
  const textPostIds = posts
    .filter((post) => post.kind === "text")
    .map((post) => post.id)
    .filter(Boolean);

  if (textPostIds.length === 0) return;

  const resolvedPosts = await Promise.allSettled(
    textPostIds.map((postId) => postsApi.getPostById(postId)),
  );

  const hydratedPosts = new Map<string, Post>();
  for (const result of resolvedPosts) {
    if (result.status !== "fulfilled" || !result.value) continue;
    hydratedPosts.set(result.value.id, result.value);
  }

  if (hydratedPosts.size === 0) return;

  hydratedPosts.forEach((post, postId) => {
    queryClient.setQueryData(postKeys.detail(postId), post);
  });

  queryClient.setQueryData(postKeys.profilePosts(userId), (current: Post[] = []) =>
    current.map((post) => hydratedPosts.get(post.id) ?? post),
  );
}

export function useBootstrapProfile() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const hasRun = useRef(false);
  const trace = useScreenTrace("Profile");

  const enabled = isFeatureEnabled("perf_bootstrap_profile");

  useEffect(() => {
    if (!enabled || !userId || hasRun.current) return;
    hasRun.current = true;

    // Check if we already have fresh profile data from MMKV cache
    const existingProfile = queryClient.getQueryData<any>(
      profileKeys.byId(userId),
    );
    const existingPosts = queryClient.getQueryData<any[]>(
      postKeys.profilePosts(userId),
    );
    const expectedPostsCount = Number(existingProfile?.postsCount ?? 0);
    const hasUsablePostsCache = Array.isArray(existingPosts)
      ? existingPosts.length > 0 || expectedPostsCount === 0
      : expectedPostsCount === 0;

    if (existingProfile && hasUsablePostsCache) {
      trace.markCacheHit();
      trace.markUsable();
      return;
    }

    if (
      expectedPostsCount > 0 &&
      Array.isArray(existingPosts) &&
      existingPosts.length === 0
    ) {
      queryClient.removeQueries({
        queryKey: postKeys.profilePosts(userId),
        exact: true,
      });
    }

    bootstrapApi.profile({ userId, includeNSFW: nsfwEnabled }).then((data) => {
      if (!data) return;
      hydrateFromProfileBootstrap(queryClient, userId, data);
      void hydrateBootstrapProfileTextPosts(queryClient, userId, data.posts);
      trace.markUsable();
    });
  }, [enabled, userId, nsfwEnabled, queryClient, trace]);

  return { enabled };
}
