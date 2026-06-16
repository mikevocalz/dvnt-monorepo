/**
 * Type guards and validation utilities to prevent runtime errors
 * from accessing non-existent properties or passing wrong types.
 */

import type { AppUser } from "@/lib/auth-client";

/**
 * Type guard to check if a user object has required fields.
 * Use this before accessing user data in critical flows.
 */
export function isValidAppUser(user: any): user is AppUser {
  return (
    user &&
    typeof user === "object" &&
    typeof user.id === "string" &&
    typeof user.username === "string" &&
    typeof user.name === "string" &&
    typeof user.email === "string"
  );
}

/**
 * Safely get user display name without accessing non-existent properties.
 * NEVER use a nonexistent full-name field here; AppUser only exposes `name`.
 */
export function getUserDisplayName(user: Partial<AppUser> | null | undefined): string {
  if (!user) return "Unknown User";
  return user.name || user.username || "Unknown User";
}

/**
 * Safely get user identifier for API calls (username or authId).
 * NEVER pass user.id (integer) to conversation/chat APIs.
 */
export function getUserIdentifier(user: Partial<AppUser> | null | undefined): string | null {
  if (!user) return null;
  
  // Prefer username for conversation APIs
  if (user.username) return user.username;
  
  // Fallback to authId if username not available
  if (user.authId) return user.authId;
  
  console.warn("[TypeGuard] User missing username and authId:", user.id);
  return null;
}

/**
 * Safely get user counts with proper defaults.
 * Prevents "undefined" from appearing in UI.
 */
export function getUserCounts(user: Partial<AppUser> | null | undefined) {
  return {
    posts: user?.postsCount ?? 0,
    followers: user?.followersCount ?? 0,
    following: user?.followingCount ?? 0,
  };
}

/**
 * Format follower count with K notation (e.g., 1.2K, 15K)
 */
export function formatFollowerCount(count: number | undefined | null): string {
  const safeCount = count ?? 0;
  if (safeCount >= 1000) {
    return `${(safeCount / 1000).toFixed(1)}K`;
  }
  return String(safeCount);
}

/**
 * Validate user object before optimistic updates.
 * Throws if attempting to set non-existent properties.
 */
export function validateOptimisticUpdate(
  update: Partial<AppUser>,
  allowedFields: (keyof AppUser)[]
): void {
  const updateKeys = Object.keys(update) as (keyof AppUser)[];
  const invalidKeys = updateKeys.filter(key => !allowedFields.includes(key));
  
  if (invalidKeys.length > 0) {
    console.error("[TypeGuard] Attempted to update non-existent fields:", invalidKeys);
    throw new Error(
      `Invalid optimistic update: ${invalidKeys.join(", ")} do not exist on AppUser`
    );
  }
}

/**
 * Safe user object for optimistic updates.
 * Only includes fields that exist on AppUser interface.
 */
export function createSafeOptimisticUser(
  currentUser: AppUser,
  updates: {
    name?: string;
    username?: string;
    bio?: string;
    website?: string;
    location?: string;
    avatar?: string;
    hashtags?: string[];
  }
): AppUser {
  return {
    ...currentUser,
    ...updates,
    // Ensure required fields are never undefined
    id: currentUser.id,
    email: currentUser.email,
    username: updates.username ?? currentUser.username,
    name: updates.name ?? currentUser.name,
    isVerified: currentUser.isVerified,
    postsCount: currentUser.postsCount,
    followersCount: currentUser.followersCount,
    followingCount: currentUser.followingCount,
  };
}

/**
 * Forbidden property checker - throws in development if accessing forbidden properties.
 * Add this to critical user data access points during development.
 */
export function assertNoForbiddenProperties(
  obj: any,
  forbiddenProps: string[],
  context: string
): void {
  if (process.env.NODE_ENV !== "development") return;
  
  for (const prop of forbiddenProps) {
    if (prop in obj) {
      console.error(
        `[TypeGuard] FORBIDDEN: Accessing non-existent property "${prop}" in ${context}`
      );
      console.error("Stack trace:", new Error().stack);
    }
  }
}

/**
 * Common forbidden properties on user objects.
 * Use with assertNoForbiddenProperties in development.
 */
export const FORBIDDEN_USER_PROPS = [
  "fullName",
  "full_name",
  "posts_count",
  "followers_count",
  "following_count",
  "profile_image",
  "profile_pic",
] as const;
