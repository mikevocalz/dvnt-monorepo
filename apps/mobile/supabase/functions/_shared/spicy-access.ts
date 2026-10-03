/**
 * Who may receive SPICY (is_nsfw) posts from a service-role read.
 *
 * Product rule (2026-10-03): any signed-in member may view SPICY posts; a
 * signed-out caller may not. Viewing needs no ID check. Publishing a post as
 * SPICY is a different rule and still needs an approved adult ID (create-post,
 * update-post, and the spicy_*_requires_verified_adult policies).
 *
 * Feed and profile reads run on the service role and bypass RLS, so they have
 * to apply this themselves. Direct PostgREST reads are covered by the
 * spicy_requires_verified_viewer policies (20261003170100), which test for a
 * JWT sub claim the same way.
 */

/** Better Auth user id of the viewer, or null for a signed-out request. */
export function viewerMaySeeSpicy(viewerAuthId: string | null | undefined): boolean {
  return typeof viewerAuthId === "string" && viewerAuthId.length > 0;
}

/**
 * Drop SPICY posts the viewer may not see. Their own posts always stay.
 * Rows need `is_nsfw` and `author_id` selected.
 */
export function withoutHiddenSpicy<T extends { is_nsfw?: unknown; author_id?: unknown }>(
  posts: T[],
  viewer: { userId: number | null; maySeeSpicy: boolean },
): T[] {
  if (viewer.maySeeSpicy) return posts;
  return posts.filter((post) =>
    post?.is_nsfw !== true ||
    (viewer.userId !== null && Number(post.author_id) === viewer.userId)
  );
}
