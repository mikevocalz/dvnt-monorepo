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
        const [authors, follows, approvals, blocks] = await Promise.all([
          db
            .from("users")
            .select("id, auth_id, is_private")
            .in("id", authorIds),
          viewer.userId !== null
            ? db
                .from("follows")
                .select("following_id")
                .eq("follower_id", viewer.userId)
                .in("following_id", authorIds)
            : { data: [], error: null },
          viewer.userId !== null
            ? db
                .from("follow_requests")
                .select("following_id")
                .eq("follower_id", viewer.userId)
                .eq("status", "approved")
                .in("following_id", authorIds)
            : { data: [], error: null },
          viewer.userId !== null
            ? db
                .from("blocks")
                .select("blocker_id, blocked_id")
                .or(
                  `blocker_id.eq.${viewer.userId},blocked_id.eq.${viewer.userId}`,
                )
            : { data: [], error: null },
        ]);
        if (authors.error || follows.error || approvals.error || blocks.error)
          throw new Error("Relationship lookup failed");
        const authIds = (authors.data || [])
          .map((a: any) => a.auth_id)
          .filter(Boolean);
        const settings =
          authIds.length > 0
            ? await db
                .from("user_settings")
                .select("auth_id, settings")
                .in("auth_id", authIds)
            : { data: [], error: null };
        if (settings.error) throw new Error("Privacy lookup failed");
        const settingsByAuth = new Map(
          (settings.data || []).map((s: any) => [s.auth_id, s.settings]),
        );
        const followed = new Set(
          (follows.data || []).map((f: any) => Number(f.following_id)),
        );
        const approved = new Set(
          (approvals.data || []).map((f: any) => Number(f.following_id)),
        );
        for (const author of authors.data || []) {
          const id = Number(author.id);
          knownAuthors.add(id);
          const preference: any = settingsByAuth.get(author.auth_id);
          const pref = preference?.privacy?.privateAccount;
          const isPrivate =
            author.is_private === true ||
            (pref != null && pref !== false && pref !== "false");
          if (isPrivate) privateAuthors.add(id);
          if (followed.has(id) && (!isPrivate || approved.has(id)))
            allowedAuthors.add(id);
        }
        for (const block of blocks.data || []) {
          blockedAuthors.add(
            Number(block.blocker_id) === viewer.userId
              ? Number(block.blocked_id)
              : Number(block.blocker_id),
          );
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
