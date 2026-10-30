import { getCurrentUserIdSync, getCurrentUserRow } from "../auth/identity";
import { ensureSupabaseJwt } from "../auth/supabase-jwt";
import { getSessionLifecycle } from "../auth/session-lifecycle";
import { getBridgeRequestEpoch } from "../supabase/client";

/** Private notification requests may never silently downgrade to anonymous. */
export async function requireNotificationAccess() {
  const userId = getCurrentUserIdSync();
  const sessionEpoch = getSessionLifecycle().epoch;
  const requestEpoch = getBridgeRequestEpoch();
  if (!userId) throw new Error("Sign in to view your notifications.");
  const assertCurrent = () => {
    if (getCurrentUserIdSync() !== userId ||
      getSessionLifecycle().epoch !== sessionEpoch ||
      getBridgeRequestEpoch() !== requestEpoch) {
      throw new Error("Your account changed. Please reload your notifications.");
    }
  };
  const profile = await getCurrentUserRow();
  assertCurrent();
  if (!profile?.authId || profile.id !== userId) {
    throw new Error("Could not verify your notification account. Please try again.");
  }
  if (!await ensureSupabaseJwt(profile.authId)) {
    throw new Error("Could not verify your notification session. Please try again.");
  }
  assertCurrent();
  return { userId, requestEpoch, assertCurrent };
}
