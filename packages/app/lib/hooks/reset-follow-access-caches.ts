import { retirePostMediaLeases } from "@dvnt/app/lib/media/post-media-lease-events";
import type { QueryClient } from "@tanstack/react-query";
import { resetPostAccessOverlays } from "@dvnt/app/lib/posts/revoke-post-overlays";

/** Remove stale protected payloads before refetching under the new relationship. */
export async function resetFollowAccessCaches(
  client: QueryClient,
  refetch = true,
  isCurrent: () => boolean = () => true,
) {
  if (!isCurrent()) return;
  retirePostMediaLeases();
  // Detached lightboxes and share sheets must disappear in the same frame.
  resetPostAccessOverlays();
  const prefixes: readonly (readonly string[])[] = [
    ...["posts", "profilePosts", "profileTaggedPosts", "postTags", "search",
      "comments", "bookmarks", "activities", "likedPosts", "notifications"].map(key => [key]),
    // Follow lists can contain identities visible only to accepted followers.
    ["users", "followers"], ["users", "following"],
  ];
  const cancellations = prefixes.map(prefix => client.cancelQueries({ queryKey: prefix }, { revert: false }));
  const clear = () => {
    for (const prefix of prefixes) {
      for (const query of client.getQueryCache().findAll({ queryKey: prefix })) {
        // invalidate alone preserves the old authorized media while refetching.
        query.setState({ data: undefined, dataUpdatedAt: 0, error: null, status: "pending" });
      }
    }
  };
  // Do not wait for cancellation: old payloads must not survive this frame.
  clear();
  await Promise.all(cancellations);
  if (!isCurrent()) return;
  clear();
  if (refetch) await Promise.all(prefixes.map(prefix => client.invalidateQueries({ queryKey: prefix })));
}
