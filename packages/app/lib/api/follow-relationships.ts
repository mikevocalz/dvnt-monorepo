import { supabase } from "../supabase/client";
import { requireBetterAuthToken } from "../auth/identity";
import { assertFollowIdentity, getFollowIdentity, type FollowIdentity } from "../auth/follow-identity";

/** Throws on unknown access/account state; never turns failures into "not following". */
export async function getOwnFollowingIds(expectedIdentity?: FollowIdentity): Promise<number[]> {
  const identity = expectedIdentity ?? getFollowIdentity();
  assertFollowIdentity(identity);
  const token = await requireBetterAuthToken();
  assertFollowIdentity(identity);
  const ids = new Set<number>();
  let cursor = 0;
  for (;;) {
    assertFollowIdentity(identity);
    const { data, error } = await supabase.functions.invoke("get-follow-relationships", {
      body: { expectedAuthId: identity.authId, cursor, limit: 200 },
      headers: { "x-auth-token": token },
    });
    assertFollowIdentity(identity);
    if (error || !data || !Array.isArray(data.followingIds) ||
      data.followingIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= cursor) ||
      (data.nextCursor !== null && (!Number.isSafeInteger(data.nextCursor) || data.nextCursor <= cursor)) ||
      (data.nextCursor !== null && data.followingIds.some((id: number) => id > data.nextCursor)))
      throw new Error("Could not load relationships");
    data.followingIds.forEach((id: number) => ids.add(id));
    if (data.nextCursor === null) return [...ids];
    cursor = data.nextCursor;
  }
}

export interface OwnFollowRelationship {
  targetId: number;
  isFollowing: boolean;
  followsYou: boolean;
}

export async function getOwnFollowRelationships(
  targetIds: number[], expectedIdentity?: FollowIdentity,
): Promise<OwnFollowRelationship[]> {
  if (targetIds.length > 100 || new Set(targetIds).size !== targetIds.length ||
    targetIds.some(id => !Number.isSafeInteger(id) || id <= 0))
    throw new Error("Invalid target IDs");
  const identity = expectedIdentity ?? getFollowIdentity();
  assertFollowIdentity(identity);
  const token = await requireBetterAuthToken();
  assertFollowIdentity(identity);
  const { data, error } = await supabase.functions.invoke("get-follow-relationships", {
    body: { mode: "pairs", expectedAuthId: identity.authId, targetIds },
    headers: { "x-auth-token": token },
  });
  assertFollowIdentity(identity);
  if (error || !Array.isArray(data?.relationships) || data.relationships.length !== targetIds.length ||
    data.relationships.some((row: OwnFollowRelationship, i: number) => !row || row.targetId !== targetIds[i] ||
      typeof row.isFollowing !== "boolean" || typeof row.followsYou !== "boolean"))
    throw new Error("Could not load relationships");
  return data.relationships;
}
