/** Mirrored in edge _shared/subscription-owner.ts; fixture tests keep parity. */
export interface SubscriptionReadClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
      in(column: string, values: string[]): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
}

/**
 * Web checkout historically stores a numeric profile id; edge checkout and
 * legacy Sneaky store auth ids. Resolve both from the authenticated principal,
 * never from a client-supplied profile id. A canonical auth-id owner wins any
 * collision with the numeric namespace, matching the SQL ownership helper.
 */
export async function membershipOwnerKeys(source: unknown, authId: string): Promise<string[]> {
  const client = source as SubscriptionReadClient;
  if (!authId || authId !== authId.trim()) throw new Error("Could not verify subscription identity.");
  const profile = await client.from("users").select("id, auth_id").eq("auth_id", authId);
  const rows = profile.data as { id: string | number; auth_id: string }[] | null;
  if (profile.error || rows?.length !== 1 || rows[0].auth_id !== authId) {
    throw new Error("Could not verify subscription identity.");
  }
  const profileId = String(rows[0].id);
  if (!/^[1-9]\d*$/.test(profileId)) throw new Error("Could not verify subscription identity.");
  if (profileId === authId) return [authId];
  const canonical = await client.from("users").select("id, auth_id").eq("auth_id", profileId);
  if (canonical.error) throw new Error("Could not verify subscription identity.");
  return canonical.data?.length ? [authId] : [authId, profileId];
}
