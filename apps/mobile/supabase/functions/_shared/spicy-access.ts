/**
 * Who may receive SPICY (is_nsfw) posts from a service-role read.
 *
 * Product rule (checklist A02, 2026-10-03): a signed-in member may view SPICY
 * posts unless they have an under-18 identity document on file. A signed-out
 * caller may not. Publishing a post as SPICY is a different rule and still
 * needs an approved adult ID (create-post, update-post, and the
 * spicy_*_requires_verified_adult policies).
 *
 * "Under-18 document on file" is the test viewer_is_flagged_minor() and
 * verified_participation_allowed() use: an identity_verifications row for the
 * viewer with date_of_birth later than today minus 18 years, whatever its
 * status. A failed read of that table hides SPICY (fails closed).
 *
 * An operator-denied account (verified_admission_policy.denylist) never sees
 * SPICY either, matching verified_participation_allowed(). A failed or missing
 * policy read also hides SPICY.
 *
 * Feed and profile reads run on the service role and bypass RLS, so they have
 * to apply this themselves. Direct PostgREST reads are covered by the
 * spicy_requires_verified_viewer policies (20261003170200).
 */

/** Latest date of birth that is 18 or older today, as YYYY-MM-DD (UTC). */
export function adultCutoffDate(now: Date = new Date()): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
  // 29 Feb minus 18 years rolls to 1 Mar; Postgres clamps to 28 Feb instead.
  if (cutoff.getUTCMonth() !== now.getUTCMonth()) cutoff.setUTCDate(0);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * `db` is a service-role client. `viewerAuthId` is the Better Auth user id of
 * the viewer, or null for a signed-out request. One read of
 * identity_verifications per call.
 */
export async function viewerMaySeeSpicy(
  db: any,
  viewerAuthId: string | null | undefined,
): Promise<boolean> {
  if (typeof viewerAuthId !== "string" || viewerAuthId.length === 0) return false;
  try {
    const policy = await db
      .from("verified_admission_policy")
      .select("denylist")
      .eq("id", 1)
      .maybeSingle();
    if (policy.error || !policy.data) {
      console.warn("[spicy-access] admission policy read failed; hiding SPICY", policy.error?.message ?? "no policy row");
      return false;
    }
    if (Array.isArray(policy.data.denylist) && policy.data.denylist.includes(viewerAuthId)) return false;
    const { data, error } = await db
      .from("identity_verifications")
      .select("user_id")
      .eq("user_id", viewerAuthId)
      .gt("date_of_birth", adultCutoffDate())
      .limit(1);
    if (error) {
      console.warn("[spicy-access] identity_verifications read failed; hiding SPICY", error.message ?? error);
      return false;
    }
    return !Array.isArray(data) || data.length === 0;
  } catch (err) {
    console.warn("[spicy-access] identity_verifications read threw; hiding SPICY", err);
    return false;
  }
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
