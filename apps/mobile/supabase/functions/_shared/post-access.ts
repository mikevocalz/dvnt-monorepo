import { viewerMaySeeSpicy } from "./spicy-access.ts";

/** Service-role counterpart of the restrictive post RLS policies.
 * Only this projection may cross the response boundary. Never spread a locked
 * source row: future caption/media fields must not accidentally become public.
 */
export async function projectVisiblePosts(
  db: any,
  posts: any[],
  viewer: { authId: string | null; userId: number | null },
  options: { placeholders?: boolean } = {},
): Promise<any[]> {
  const spicy = posts.filter(
    (p) => p.is_nsfw === true && Number(p.author_id) !== viewer.userId,
  );
  const eligible =
    spicy.length > 0 && (await viewerMaySeeSpicy(db, viewer.authId));
  const allowedAuthors = new Set<number>();
  const knownAuthors = new Set<number>();
  const privateAuthors = new Set<number>();
  const blockedAuthors = new Set<number>();
  let relationshipsLoaded = false;
  if (posts.length > 0) {
    try {
      const authorIds = [
        ...new Set(
          posts.map((p) => Number(p.author_id)).filter(Number.isFinite),
        ),
      ];
      if (authorIds.length > 0) {
        const { data: relationships, error } = await db.rpc("post_relationship_access", {
          p_viewer: viewer.userId,
          p_authors: authorIds,
        });
        if (error || !Array.isArray(relationships))
          throw new Error("Relationship preservation lookup failed");
        for (const relationship of relationships) {
          const id = Number(relationship.author_id);
          knownAuthors.add(id);
          // During additive rollout, preserve the old read boundary until the
          // database atomically captures all follows and activates the gate.
          if (relationship.enforcement_ready !== false && relationship.is_private === true)
            privateAuthors.add(id);
          if (relationship.enforcement_ready === false || relationship.is_following === true)
            allowedAuthors.add(id);
          if (relationship.is_blocked === true) blockedAuthors.add(id);
        }
        relationshipsLoaded = true;
      }
    } catch (error) {
      console.warn(
        "[post-access] Relationship/privacy lookup failed; locking SPICY",
        error,
      );
    }
  }
  return posts.flatMap((post) => {
    const own =
      viewer.userId !== null && Number(post.author_id) === viewer.userId;
    // Service role must not reveal nonpublic posts from bookmarks/detail either.
    if (!own && post.visibility !== "public") return [];
    if (
      !own &&
      (!relationshipsLoaded ||
        !knownAuthors.has(Number(post.author_id)) ||
        blockedAuthors.has(Number(post.author_id)))
    )
      return [];
    const privateLocked =
      !own &&
      privateAuthors.has(Number(post.author_id)) &&
      !allowedAuthors.has(Number(post.author_id));
    if (privateLocked && post.is_nsfw !== true) return [];
    if (
      own ||
      (post.is_nsfw !== true && !privateLocked) ||
      (eligible && allowedAuthors.has(Number(post.author_id)))
    ) {
      return [
        { ...post, isSpicyLocked: false, spicyAccessViewerId: viewer.authId },
      ];
    }
    if (!eligible || !options.placeholders) return [];
    const author = post.author;
    return [
      {
        id: post.id,
        author_id: post.author_id,
        created_at: post.created_at,
        visibility: "public",
        is_nsfw: true,
        isSpicyLocked: true,
        post_kind: "media",
        content: "",
        text_theme: null,
        location: null,
        media: [],
        post_text_slides: [],
        likes_count: 0,
        comments_count: 0,
        author: author
          ? {
              id: author.id,
              username: author.username,
              first_name: author.first_name,
              verified: author.verified,
              avatar: author.avatar,
            }
          : undefined,
      },
    ];
  });
}
