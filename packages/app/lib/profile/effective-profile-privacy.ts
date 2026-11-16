/** Public presentation flag only; content access is still enforced server-side.
 * Never fetch another member's settings or guess Public from a stale users flag.
 */
export async function readEffectiveProfilePrivacy(db: {
  rpc: (name: string, args: { p_user_id: number }) => PromiseLike<{ data: unknown; error: unknown }>;
}, userId: number): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid profile");
    const { data, error } = await db.rpc("profile_is_private", { p_user_id: userId });
    if (error || typeof data !== "boolean") throw new Error("Privacy unavailable");
    return data;
  } catch {
    throw Object.assign(new Error("Could not verify profile privacy. Please retry."), {
      name: "ProfilePrivacyUnavailable",
    });
  }
}

/** Query failures can retain stale Public data; the screen must hide that data. */
export function isProfilePrivacyUnavailable(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error
    && error.name === "ProfilePrivacyUnavailable";
}
