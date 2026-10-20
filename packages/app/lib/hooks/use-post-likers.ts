/** Shared, viewer-scoped likes pagination for native and web. */
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import {
  likesApi,
  type PostLiker,
  type PostLikersCursor,
  type PostLikersPage,
} from "@dvnt/app/lib/api/likes";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { postLikersKeys, likeStateKeys } from "@dvnt/app/lib/query-keys";
export { postLikersKeys };

function postLikersOptions(queryClient: QueryClient, postId: string, viewerId: string, pageSize: number) {
  return infiniteQueryOptions({
    queryKey: postLikersKeys.forViewer(postId, viewerId, pageSize),
    initialPageParam: null as PostLikersCursor | null,
    queryFn: async ({ pageParam }) => {
      if (useAuthStore.getState().user?.id !== viewerId) {
        throw new Error("Session changed while loading likes");
      }
      const likeKey = likeStateKeys.forPost(viewerId, postId);
      const previous = queryClient.getQueryData<{ likes: number; hasLiked: boolean }>(likeKey);
      const mutationWasPending = queryClient.isMutating({ mutationKey: ["likePost", postId] }) > 0;
      const result = await likesApi.getPostLikers(postId, { cursor: pageParam, limit: pageSize });
      // A late response from a previous session must not repopulate its caches
      // after sign-out, nor publish another account's request into this key.
      if (useAuthStore.getState().user?.id !== viewerId) {
        throw new Error("Session changed while loading likes");
      }

      // Do not overwrite a newer optimistic toggle while this read was in flight.
      // Prefetch and mounted queries share this path and exactly the same shape.
      if (
        viewerId && previous && !mutationWasPending && Number.isFinite(result.likesCount) &&
        queryClient.getQueryData(likeKey) === previous &&
        !queryClient.isMutating({ mutationKey: ["likePost", postId] })
      ) {
        queryClient.setQueryData(likeKey, { ...previous, likes: result.likesCount });
      }
      return result;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 10 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

// Stable selector preserves the existing native hook's array API. Rows can
// overlap if a post changes while paging; each user must still appear only once.
function selectLikers(data: InfiniteData<PostLikersPage>): PostLiker[] {
  const seen = new Set<number>();
  return data.pages.flatMap((page) => page.likers.filter((liker) => {
    if (seen.has(liker.userId)) return false;
    seen.add(liker.userId);
    return true;
  }));
}

// Native keeps its existing 500-row initial list. Web opts into smaller pages.
export function usePostLikers(postId: string | undefined, enabled: boolean, pageSize = 500) {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id) || "";
  return useInfiniteQuery({
    ...postLikersOptions(queryClient, postId || "", viewerId, pageSize),
    select: selectLikers,
    enabled: !!postId && !!viewerId && enabled,
  });
}

/** Fire-and-forget prefetch uses the identical infinite-page cache contract. */
export function prefetchPostLikers(queryClient: QueryClient, postId: string, pageSize = 500): void {
  const viewerId = useAuthStore.getState().user?.id || "";
  if (!postId || !viewerId) return;
  void queryClient.prefetchInfiniteQuery(postLikersOptions(queryClient, postId, viewerId, pageSize));
}

export function usePrefetchPostLikers(pageSize = 500) {
  const queryClient = useQueryClient();
  return useCallback((postId: string) => prefetchPostLikers(queryClient, postId, pageSize), [queryClient, pageSize]);
}
