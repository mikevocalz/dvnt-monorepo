/**
 * Who may receive SPICY (is_nsfw) posts from a service-role read.
 *
 * The rule matches create-post and update-post: an approved adult ID, whatever
 * verified_admission_policy says. The author always sees their own posts. A
 * failed verification read is "not approved" (resolveAdultVerificationState
 * returns retry_required), so this fails closed.
 *
 * Feed and profile reads run on the service role and bypass RLS, so they have
 * to apply this themselves. Direct PostgREST reads are covered by the
 * spicy_requires_verified_viewer policy on public.posts.
 */
import { resolveAdultVerificationState } from "./verification-state.ts";

/** Better Auth user id of the viewer, or null for an anonymous request. */
export async function viewerMaySeeSpicy(
  db: any,
  viewerAuthId: string | null | undefined,
): Promise<boolean> {
  if (!viewerAuthId) return false;
  const verification = await resolveAdultVerificationState(db, viewerAuthId);
  return verification.state === "approved";
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
