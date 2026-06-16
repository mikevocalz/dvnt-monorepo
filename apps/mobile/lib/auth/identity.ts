/**
 * Identity Helpers
 *
 * Centralized identity management for Better Auth + Supabase integration.
 *
 * IMPORTANT: Better Auth IDs are strings (not UUIDs, not integers).
 * The users table has:
 * - `id` (integer): Internal database PK
 * - `auth_id` (string): Better Auth user ID
 *
 * NEVER parse Better Auth IDs as integers!
 *
 * Use these helpers to get the correct ID type for your use case:
 * - For Edge Function calls: use getBetterAuthToken()
 * - For database queries by user: use getCurrentUserId() (returns int)
 * - For auth_id lookups: use getAuthIdFromStore()
 */

import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import { useAuthStore } from "../stores/auth-store";
import { authClient, getAuthToken, invalidateTokenCache } from "../auth-client";
import { logAuth } from "./auth-logger";

// In-memory cache for user row to avoid repeated DB calls
let cachedUserRow: UserRow | null = null;
let cachedUserRowExpiry = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Get the cached integer user ID synchronously.
 * Used as a fallback when the auth store has a non-numeric ID.
 * Returns null if the cache hasn't been populated yet.
 */
export function getCachedUserIdInt(): number | null {
  return cachedUserRow?.id ?? null;
}

export interface UserRow {
  id: number;
  authId: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  location: string | null;
  verified: boolean;
  avatarUrl: string | null;
  followersCount: number;
  followingCount: number;
  postsCount: number;
}

/**
 * Get the Better Auth access token for API calls.
 * Use this for Edge Function Authorization headers.
 *
 * @returns The Better Auth token string, or null if not authenticated
 */
export async function getBetterAuthToken(): Promise<string | null> {
  return getAuthToken();
}

export function hasAuthenticatedUser(): boolean {
  const { authStatus, isAuthenticated, user } = useAuthStore.getState();

  if (authStatus === "loading") {
    return Boolean(isAuthenticated || user?.id);
  }

  return Boolean(authStatus === "authenticated" && (isAuthenticated || user?.id));
}

/**
 * Get the Better Auth access token, throwing if not available.
 * Use this when authentication is required.
 *
 * Retries once with cache invalidation if the first attempt fails.
 * This handles token expiry gracefully — the first call may return a stale
 * cached null, but the retry forces a fresh getSession() call.
 *
 * @throws Error if not authenticated after retry
 * @returns The Better Auth token string
 */
export async function requireBetterAuthToken(): Promise<string> {
  // During first login the Better Auth session cookie can exist before our
  // local app user store has been populated. Try the real token first; the
  // token is the authority for privileged Edge Function calls.
  const retryDelaysMs = [0, 250, 750];
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    const delay = retryDelaysMs[attempt];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      invalidateTokenCache();
    }

    const token = await getBetterAuthToken();
    if (token) {
      if (attempt > 0) {
        logAuth("AUTH_REFRESH_OK", {
          reason: "requireToken_retry_succeeded",
          attempt,
        });
      }
      return token;
    }
  }

  if (!hasAuthenticatedUser()) {
    throw new Error("Not authenticated - no Better Auth token available");
  }

  logAuth("AUTH_REFRESH_FAIL", { reason: "requireToken_exhausted" });
  throw new Error("Not authenticated - no Better Auth token available");
}

/**
 * Get the Better Auth user ID (string) from the current session.
 * This is the `auth_id` stored in the users table.
 *
 * NEVER parse this as an integer!
 *
 * @returns The Better Auth user ID string
 * @throws Error if not authenticated
 */
export async function getAuthIdFromSession(): Promise<string> {
  const { data: session } = await authClient.getSession();
  if (!session?.user?.id) {
    throw new Error("Not authenticated - no session available");
  }
  return session.user.id;
}

/**
 * Get the Better Auth user ID from the auth store (synchronous).
 * Returns the auth_id if available in the store.
 *
 * @returns The auth_id string, or null if not available
 */
export function getAuthIdFromStore(): string | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;

  // Check if we have authId stored
  if ((user as any).authId) {
    return (user as any).authId;
  }

  // If user.id is not numeric, it's the auth_id
  const isNumeric = /^\d+$/.test(user.id);
  if (!isNumeric) {
    return user.id;
  }

  return null;
}

/**
 * Get the current user's database row.
 * Fetches from users table and caches the result.
 *
 * @param forceRefresh - Force a fresh fetch from database
 * @returns The user row from database, or null if not found
 */
export async function getCurrentUserRow(
  forceRefresh = false,
): Promise<UserRow | null> {
  // Check cache first
  if (!forceRefresh && cachedUserRow && Date.now() < cachedUserRowExpiry) {
    return cachedUserRow;
  }

  const user = useAuthStore.getState().user;
  if (!user) return null;

  try {
    const isNumeric = /^\d+$/.test(user.id);

    let query = supabase.from(DB.users.table).select(`
        ${DB.users.id},
        ${DB.users.authId},
        ${DB.users.email},
        ${DB.users.username},
        ${DB.users.firstName},
        ${DB.users.lastName},
        ${DB.users.bio},
        ${DB.users.location},
        ${DB.users.verified},
        ${DB.users.followersCount},
        ${DB.users.followingCount},
        ${DB.users.postsCount},
        avatar:${DB.users.avatarId}(url)
      `);

    if (isNumeric) {
      query = query.eq(DB.users.id, parseInt(user.id));
    } else {
      // user.id is the auth_id
      query = query.eq(DB.users.authId, user.id);
    }

    const { data, error } = await query.single();

    if (error || !data) {
      console.error("[Identity] getCurrentUserRow error:", error);
      return null;
    }

    const userRow: UserRow = {
      id: data[DB.users.id] as number,
      authId: data[DB.users.authId] as string,
      email: data[DB.users.email] as string,
      username: data[DB.users.username] as string,
      firstName: data[DB.users.firstName] as string | null,
      lastName: data[DB.users.lastName] as string | null,
      bio: data[DB.users.bio] as string | null,
      location: data[DB.users.location] as string | null,
      verified: (data[DB.users.verified] as boolean) || false,
      avatarUrl: (data.avatar as any)?.url || null,
      followersCount: (data[DB.users.followersCount] as number) || 0,
      followingCount: (data[DB.users.followingCount] as number) || 0,
      postsCount: (data[DB.users.postsCount] as number) || 0,
    };

    // Update cache
    cachedUserRow = userRow;
    cachedUserRowExpiry = Date.now() + CACHE_TTL_MS;

    return userRow;
  } catch (error) {
    console.error("[Identity] getCurrentUserRow error:", error);
    return null;
  }
}

/**
 * Get the current user's integer database ID.
 * This is the `users.id` column (integer PK).
 *
 * Use this when you need the integer ID for database queries.
 * For Edge Function calls, use requireBetterAuthToken() instead.
 *
 * @returns The integer user ID, or null if not authenticated
 */
export async function getCurrentUserId(): Promise<number | null> {
  const user = useAuthStore.getState().user;
  if (!user) return null;

  // If user.id is already numeric, return it
  const isNumeric = /^\d+$/.test(user.id);
  if (isNumeric) {
    return parseInt(user.id);
  }

  // Otherwise, look up the user by auth_id
  const userRow = await getCurrentUserRow();
  return userRow?.id || null;
}

/**
 * Get the current user's integer ID synchronously.
 *
 * WARNING: This assumes the auth store has the correct integer ID.
 * If the store has a Better Auth ID, this will return null.
 *
 * Prefer getCurrentUserId() (async) when possible.
 *
 * @returns The integer user ID, or null if not available
 */
export function getCurrentUserIdSync(): number | null {
  const user = useAuthStore.getState().user;
  if (!user) return getCachedUserIdInt();

  const isNumeric = /^\d+$/.test(user.id);
  if (!isNumeric) {
    // Don't warn - this is expected when auth store has auth_id.
    // Fall back to the cache populated by getCurrentUserRow during boot.
    return getCachedUserIdInt();
  }

  return parseInt(user.id);
}

/**
 * Clear the cached user row.
 * Call this on logout or when user data changes.
 */
export function clearUserRowCache(): void {
  cachedUserRow = null;
  cachedUserRowExpiry = 0;
}

/**
 * Update the cached user row with new data.
 * Call this after profile updates to keep cache in sync.
 */
export function updateUserRowCache(updates: Partial<UserRow>): void {
  if (cachedUserRow) {
    cachedUserRow = { ...cachedUserRow, ...updates };
    cachedUserRowExpiry = Date.now() + CACHE_TTL_MS;
  }
}
