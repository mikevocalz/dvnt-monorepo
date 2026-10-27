import type { QueryClient } from "@tanstack/react-query";
import { likeStateKeys } from "../query-keys";

// A feed/detail fetch may finish after a toggle has already settled. Pending
// checks alone cannot distinguish that stale response from a fresh snapshot.
const revisions = new WeakMap<QueryClient, Map<string, number>>();

export function markPostLikeMutation(queryClient: QueryClient, postId: string): void {
  let versions = revisions.get(queryClient);
  if (!versions) { versions = new Map(); revisions.set(queryClient, versions); }
  versions.set(postId, (versions.get(postId) || 0) + 1);
}

/** Capture before a server read; publish only posts with no overlapping toggle. */
export function captureServerLikeSync(queryClient: QueryClient, viewerId: string) {
  const before = new Map(revisions.get(queryClient));
  return (post: { id: string; likes: number; viewerHasLiked?: boolean }) => {
    const postId = String(post.id);
    if (!viewerId || !postId) return;
    if ((before.get(postId) || 0) !== (revisions.get(queryClient)?.get(postId) || 0) ||
        queryClient.isMutating({ mutationKey: ["likePost", postId] })) {
      // Keep the pending/newer like fields in the fetched payload too. Native
      // feed hydration also seeds from that payload after the query publishes.
      const current = queryClient.getQueryData<{ hasLiked: boolean; likes: number }>(
        likeStateKeys.forPost(viewerId, postId),
      );
      if (current) { post.likes = current.likes; post.viewerHasLiked = current.hasLiked; }
      return;
    }
    queryClient.setQueryData(likeStateKeys.forPost(viewerId, postId), {
      hasLiked: post.viewerHasLiked ?? false,
      likes: post.likes,
    });
  };
}
