/**
 * Post Routes - Canonical Route Construction
 *
 * Provides type-safe, validated route construction for all post-related navigation.
 *
 * RULES:
 * - NEVER construct post routes with template literals directly
 * - ALWAYS use these helpers
 * - ALWAYS validate postId before navigation
 * - ALWAYS prefetch before navigation (when queryClient available)
 *
 * This prevents:
 * - Invalid IDs reaching the screen
 * - Type safety bypasses with `as any`
 * - Inconsistent route patterns
 * - Navigation crashes
 */

import type { QueryClient } from "@tanstack/react-query";
import { isValidPostId } from "@dvnt/app/lib/validation/post-params";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";

type AppRouter = {
  push: (href: any) => void;
};

/**
 * Constructs the canonical post detail route path.
 *
 * @param postId - The post ID (must be valid)
 * @returns Typed route path
 * @throws Error in dev if postId is invalid
 */
export function getPostDetailRoute(
  postId: string,
): `/(protected)/post/${string}` {
  if (!isValidPostId(postId)) {
    const error = `[getPostDetailRoute] Invalid post ID: ${postId}`;
    if (__DEV__) {
      throw new Error(error);
    } else {
      console.error(error);
      // Return a safe fallback (will show error UI in screen)
      return "/(protected)/post/invalid" as const;
    }
  }

  return `/(protected)/post/${postId}` as const;
}

export function getPostDetailCommentsRoute(
  postId: string,
  commentId?: string,
): string {
  const query = ["openComments=1"];
  if (commentId) {
    query.push(`commentId=${encodeURIComponent(commentId)}`);
  }
  return `${getPostDetailRoute(postId)}?${query.join("&")}`;
}

/**
 * Navigates to post detail screen with validation and prefetch.
 *
 * This is the CANONICAL way to navigate to a post from anywhere in the app.
 *
 * @param router - Expo Router instance
 * @param queryClient - TanStack Query client for prefetching
 * @param postId - The post ID to navigate to
 * @returns true if navigation initiated, false if invalid ID
 *
 * @example
 * ```tsx
 * const handlePostPress = useCallback((postId: string) => {
 *   navigateToPost(router, queryClient, postId);
 * }, [router, queryClient]);
 * ```
 */
export function navigateToPost(
  router: AppRouter,
  queryClient: QueryClient,
  postId: string,
): boolean {
  // Validate before any action
  if (!isValidPostId(postId)) {
    if (__DEV__) {
      console.error(
        "[navigateToPost] Invalid post ID, navigation blocked:",
        postId,
      );
    }
    return false;
  }

  // Prefetch post data (fire-and-forget, non-blocking)
  screenPrefetch.postDetail(queryClient, postId);

  // Navigate with validated route
  router.push(getPostDetailRoute(postId));

  return true;
}

/**
 * Hook-friendly version that returns a stable callback.
 *
 * Use this in components to get a memoized navigation function.
 *
 * @example
 * ```tsx
 * import { usePostNavigation } from '@dvnt/app/lib/routes/post-routes';
 *
 * function MyComponent() {
 *   const navigateToPost = usePostNavigation();
 *
 *   return (
 *     <Pressable onPress={() => navigateToPost(postId)}>
 *       <Text>View Post</Text>
 *     </Pressable>
 *   );
 * }
 * ```
 */
import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

export function usePostNavigation() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useCallback(
    (postId: string) => {
      return navigateToPost(router, queryClient, postId);
    },
    [router, queryClient],
  );
}

/**
 * Debounced version to prevent rapid duplicate navigation.
 *
 * Uses TanStack Pacer useDebouncedCallback (project standard, no setTimeout).
 *
 * @example
 * ```tsx
 * import { usePostNavigationDebounced } from '@dvnt/app/lib/routes/post-routes';
 *
 * function FeedPost({ postId }: { postId: string }) {
 *   const navigateToPost = usePostNavigationDebounced();
 *
 *   return (
 *     <Pressable onPress={() => navigateToPost(postId)}>
 *       <Image source={{ uri: thumbnail }} />
 *     </Pressable>
 *   );
 * }
 * ```
 */
import { useDebouncedCallback } from "@tanstack/react-pacer";

export function usePostNavigationDebounced(waitMs: number = 300) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useDebouncedCallback(
    (postId: string) => {
      return navigateToPost(router, queryClient, postId);
    },
    { wait: waitMs },
  );
}

/**
 * Validates if a route path is a post detail route.
 *
 * Useful for deep link handling and route matching.
 */
export function isPostDetailRoute(path: string): boolean {
  return /^\/(protected\/)?post\/[^/]+$/.test(path);
}

/**
 * Extracts post ID from a post detail route path.
 *
 * @param path - Route path like "/(protected)/post/123" or "/post/123"
 * @returns Post ID if valid route, null otherwise
 */
export function extractPostIdFromRoute(path: string): string | null {
  const match = path.match(/\/post\/([^/]+)$/);
  if (!match) return null;

  const postId = match[1];
  return isValidPostId(postId) ? postId : null;
}
