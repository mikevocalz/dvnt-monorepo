/**
 * Is this the signed-in member?
 *
 * Six ownership checks compared USERNAMES — `post.author.username ===
 * currentUser.username`. Every one of them broke the moment somebody renamed:
 * a cached post still carries the old handle, the comparison fails, and the
 * member is treated as a stranger to their own post. That is why the Delete
 * button disappeared from a post on mobile web after a username change.
 *
 * An id is stable across a rename; a username is the one field that is not.
 *
 * Ids arrive in three shapes across this codebase — the `users` integer id, the
 * Better Auth uuid (`authId`), and either of those stringified — so all of them
 * are compared. A username fallback is deliberately NOT included: it is what
 * caused the bug, and a check that silently falls back to it would keep the
 * failure alive while looking fixed.
 */

export interface UserRef {
  id?: string | number | null;
  authId?: string | null;
  auth_id?: string | null;
  userId?: string | number | null;
  user_id?: string | number | null;
}

function identities(ref: UserRef | null | undefined): string[] {
  if (!ref) return [];
  const raw = [ref.id, ref.authId, ref.auth_id, ref.userId, ref.user_id];
  const out: string[] = [];
  for (const value of raw) {
    if (value === null || value === undefined) continue;
    const s = String(value).trim();
    // "0", "null" and "undefined" have all appeared in this codebase's id
    // fields as strings; none of them identifies anybody.
    if (!s || s === "0" || s === "null" || s === "undefined") continue;
    out.push(s);
  }
  return out;
}

/**
 * True only when the two references share at least one concrete id.
 *
 * Two users with no ids between them are NOT the same user — an ownership
 * check that returns true on missing data hands a stranger a Delete button.
 */
export function isSameUser(
  a: UserRef | null | undefined,
  b: UserRef | null | undefined,
): boolean {
  const left = identities(a);
  if (left.length === 0) return false;
  const right = new Set(identities(b));
  if (right.size === 0) return false;
  return left.some((id) => right.has(id));
}

/** Does the signed-in member own this authored thing? */
export function ownsContent(
  viewer: UserRef | null | undefined,
  content:
    | { author?: UserRef | null; userId?: string | number | null; user_id?: string | number | null }
    | null
    | undefined,
): boolean {
  if (!content) return false;
  if (isSameUser(viewer, content.author)) return true;
  // A row that carries its owner directly rather than a nested author.
  return isSameUser(viewer, {
    userId: content.userId,
    user_id: content.user_id,
  });
}
