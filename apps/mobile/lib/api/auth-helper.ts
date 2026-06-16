import { useAuthStore } from "../stores/auth-store";
import { getCurrentUserRow, getCachedUserIdInt } from "../auth/identity";

export { getCurrentUserIdSync } from "../auth/identity";

/**
 * Get current user ID from Better Auth store
 * Returns the users table integer ID (as string), not the Better Auth UUID
 *
 * After switching from Supabase Auth to Better Auth, we no longer use
 * supabase.auth.getUser(). Instead, we get the user from the auth store
 * which is populated by Better Auth session.
 */
export function getCurrentUserId(): string | null {
  const user = useAuthStore.getState().user;
  const id = user?.id;

  // Validate that we have a valid ID (should be numeric string from users table)
  if (!id) return null;

  // If it's a UUID (Better Auth ID), we can't use it directly
  // The auth store should have the users table integer ID
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    console.warn(
      "[auth-helper] getCurrentUserId received UUID instead of integer ID:",
      id,
    );
    return null;
  }

  return id;
}

/**
 * Get current user ID as integer (for database queries)
 * Returns null if user is not authenticated or ID is invalid
 */
export function getCurrentUserIdInt(): number | null {
  const id = getCurrentUserId();
  if (id) {
    const parsed = parseInt(id, 10);
    if (!isNaN(parsed)) return parsed;
  }

  // Fallback: check identity cache (populated by getCurrentUserRow during boot)
  const cachedId = getCachedUserIdInt();
  if (cachedId) return cachedId;

  if (id) {
    console.warn("[auth-helper] getCurrentUserIdInt failed to parse:", id);
  }
  return null;
}

/**
 * Get current user's auth_id (UUID) for tables that use UUID foreign keys.
 * Some tables (bookmarks, conversations_rels) reference auth_id, not integer id.
 * Returns null if user is not authenticated or auth_id is not available.
 */
export async function getCurrentUserAuthId(): Promise<string | null> {
  const userRow = await getCurrentUserRow();
  return userRow?.authId || null;
}

/**
 * Get current user from Better Auth store
 */
export function getCurrentUser() {
  return useAuthStore.getState().user;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return useAuthStore.getState().isAuthenticated;
}

/**
 * Resolve a user ID to an integer — handles both integer strings ("42")
 * and Better Auth auth_id strings ("akTmS2gZY3eJ1FYwjDqsC2k1CQNMaHiv").
 * For auth_id strings, looks up the integer `users.id` via `auth_id` column.
 * Throws if the user cannot be resolved.
 */
export async function resolveUserIdInt(userId: string): Promise<number> {
  const parsed = parseInt(userId, 10);
  if (!isNaN(parsed) && String(parsed) === userId.trim()) return parsed;

  // Not a plain integer — resolve BA auth_id to integer user ID
  const { supabase } = await import("../supabase/client");
  const { DB } = await import("../supabase/db-map");

  const { data: userRow } = await supabase
    .from(DB.users.table)
    .select(DB.users.id)
    .eq(DB.users.authId, userId)
    .single();

  if (userRow) return userRow[DB.users.id];

  // No app profile — return NaN to signal auth-only user
  // Callers that need server-side resolution should pass authId to edge functions
  throw new Error("NEEDS_PROVISION:" + userId);
}
