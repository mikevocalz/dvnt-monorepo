/**
 * Rewrite an embedded user reference wherever it appears in cached data.
 *
 * `patchCurrentUserEverywhere` used to hand-enumerate query keys: the profile,
 * two username lookups, the feed, the infinite feed, profile posts. Anything
 * not on that list kept the old username until it refetched — and because the
 * query cache is persisted to disk (`lib/query-persistence.ts`), a stale
 * username survived a restart. Comments, post detail, likers, search results,
 * story rings, message threads and ticket holder names were all off the list.
 *
 * Enumerating was the bug: every cache added later inherits it. So this walks
 * the cached value instead and rewrites any object that IS the user, wherever
 * it sits and however deeply it is nested.
 *
 * Pure and structure-agnostic on purpose — it does not need to know that a feed
 * page looks like `pages[].posts[].author`.
 */

/** Keys that can identify an object as, or as belonging to, a user. */
const ID_KEYS = ["id", "userId", "user_id", "authorId", "author_id"] as const;

/**
 * Is this node the user themselves?
 *
 * An `id` match is the strong signal. A `userId`/`authorId` match identifies a
 * row ABOUT the user — a post, a comment — not the user, so it only counts when
 * the node also carries user-shaped fields. Without that distinction a post
 * would have `username` written onto it, inventing a field its renderer never
 * expected.
 */
function isUserNode(
  node: Record<string, unknown>,
  userId: string,
  patchKeys: readonly string[],
): boolean {
  const matchesId = ID_KEYS.some(
    (k) => node[k] !== undefined && String(node[k]) === userId,
  );
  if (!matchesId) return false;

  const idMatches = node.id !== undefined && String(node.id) === userId;
  // Present AND set. A post carrying `username: undefined` is still a post,
  // and `"username" in node` alone would have promoted it to a user.
  const looksLikeUser =
    node.username !== undefined ||
    node.handle !== undefined ||
    node.avatar !== undefined;
  if (!idMatches && !looksLikeUser) return false;

  return patchKeys.some((k) => k in node);
}

export interface PatchUserOptions {
  /** Depth guard against a pathological or cyclic cache. */
  maxDepth?: number;
}

/**
 * A copy of `value` with every occurrence of the user patched.
 *
 * Returns the ORIGINAL reference when nothing changed, so React Query does not
 * see a new object for every untouched cache and re-render the world.
 */
export function patchUserInTree<T>(
  value: T,
  userId: string,
  patch: Record<string, unknown>,
  options: PatchUserOptions = {},
): T {
  const patchKeys = Object.keys(patch);
  if (patchKeys.length === 0 || !userId) return value;
  const maxDepth = options.maxDepth ?? 12;
  const seen = new Set<object>();

  function walk(node: unknown, depth: number): unknown {
    if (depth > maxDepth || node === null || typeof node !== "object") {
      return node;
    }
    // A cache can hold a shared object graph; a cycle would not terminate.
    if (seen.has(node as object)) return node;
    seen.add(node as object);

    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const patched = walk(item, depth + 1);
        if (patched !== item) changed = true;
        return patched;
      });
      return changed ? next : node;
    }

    const record = node as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      const patched = walk(child, depth + 1);
      if (patched !== child) changed = true;
      next[key] = patched;
    }

    if (isUserNode(record, userId, patchKeys)) {
      for (const key of patchKeys) {
        // Only fields the node already has.
        if (key in record && next[key] !== patch[key]) {
          next[key] = patch[key];
          changed = true;
        }
      }
    }

    return changed ? next : node;
  }

  return walk(value, 0) as T;
}

/** The fields a profile edit changes that other caches display. */
export function displayablePatch(user: {
  username?: string | null;
  name?: string | null;
  avatar?: string | null;
  isVerified?: boolean;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (user.username != null) {
    patch.username = user.username;
    // Some cached shapes call it `handle`.
    patch.handle = user.username;
  }
  if (user.name != null) patch.name = user.name;
  if (user.avatar != null) patch.avatar = user.avatar;
  if (user.isVerified !== undefined) patch.verified = user.isVerified;
  return patch;
}
