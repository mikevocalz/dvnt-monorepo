import { projectVisiblePosts } from "./post-access.ts";

/** Service-role engagement endpoints must not disclose metadata for hidden posts.
 * Use only the verified caller's resolved identity. No captions or media selected.
 */
export async function readVisiblePostForEngagement(
  db: any,
  postId: number,
  viewer: { authId: string; userId: number },
): Promise<{ id: number; author_id: number; likes_count?: number } | null> {
  try {
    const { data: post, error } = await db.from("posts")
      .select("id, author_id, visibility, is_nsfw, likes_count")
      .eq("id", postId).maybeSingle();
    if (error || !post) return null;
    const visible = await projectVisiblePosts(db, [post], viewer);
    return visible.length === 1 ? visible[0] : null;
  } catch { return null; }
}
