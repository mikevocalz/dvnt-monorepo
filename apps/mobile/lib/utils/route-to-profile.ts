/**
 * Profile Routing Helper
 *
 * SINGLE SOURCE OF TRUTH for profile navigation.
 * Ensures correct routing to MyProfile vs UserProfile screens.
 *
 * Rules:
 * - If targetUserId === viewerId → /profile/me (MyProfile)
 * - Otherwise → /profile/[username] (UserProfile)
 */

type Router = ReturnType<typeof import("expo-router").useRouter>;
import type { QueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@/lib/prefetch";

interface RouteToProfileParams {
  targetUserId: string | number | undefined;
  targetUsername: string | undefined;
  targetAvatar?: string | undefined;
  targetName?: string | undefined;
  viewerId: string | number | undefined;
  router: Router;
  queryClient?: QueryClient;
  guestMode?: boolean;
}

/**
 * Navigate to the correct profile screen based on ownership.
 *
 * @example
 * // From feed post author tap
 * routeToProfile({
 *   targetUserId: post.author.id,
 *   targetUsername: post.author.username,
 *   viewerId: currentUser.id,
 *   router,
 * });
 */
export function routeToProfile({
  targetUserId,
  targetUsername,
  targetAvatar,
  targetName,
  viewerId,
  router,
  queryClient,
  guestMode = false,
}: RouteToProfileParams): void {
  // Normalize IDs to strings for comparison
  const targetId = targetUserId ? String(targetUserId) : "";
  const currentId = viewerId ? String(viewerId) : "";

  // DEV logging
  if (__DEV__) {
    console.log("[routeToProfile]", {
      targetUserId: targetId,
      targetUsername,
      viewerId: currentId,
      isOwnProfile: targetId === currentId && targetId !== "",
    });
  }

  if (guestMode && targetUsername) {
    const params: Record<string, string> = {};
    if (targetAvatar && targetAvatar.length > 0) params.avatar = targetAvatar;
    if (targetName && targetName.length > 0) params.name = targetName;
    router.push({
      pathname: `/(public)/profile/${targetUsername}`,
      params,
    } as any);
    return;
  }

  // If viewing own profile, route to /profile/me (tabs profile)
  if (targetId && currentId && targetId === currentId) {
    router.push("/(protected)/(tabs)/profile");
    return;
  }

  // Prefetch profile data before navigation — data in cache when screen mounts
  if (targetUsername && queryClient) {
    screenPrefetch.profile(queryClient, targetUsername);
  }

  // Otherwise, route to user profile by username
  // Pass avatar as route param to eliminate initials waterfall
  if (targetUsername) {
    const params: Record<string, string> = {};
    if (targetAvatar && targetAvatar.length > 0) params.avatar = targetAvatar;
    if (targetName && targetName.length > 0) params.name = targetName;
    router.push({
      pathname: `/(protected)/profile/${targetUsername}`,
      params,
    } as any);
    return;
  }

  // Fallback: if no username but have ID, try ID-based route
  if (targetId) {
    console.warn("[routeToProfile] No username provided, using ID:", targetId);
    router.push(`/(protected)/profile/${targetId}`);
    return;
  }

  // No valid target - log error
  console.error("[routeToProfile] No valid target provided:", {
    targetUserId,
    targetUsername,
    viewerId,
  });
}

/**
 * Get the profile route path without navigating.
 * Useful for Link components.
 */
export function getProfilePath(
  targetUserId: string | number | undefined,
  targetUsername: string | undefined,
  viewerId: string | number | undefined,
  guestMode: boolean = false,
): string {
  if (guestMode && targetUsername) {
    return `/(public)/profile/${targetUsername}`;
  }

  const targetId = targetUserId ? String(targetUserId) : "";
  const currentId = viewerId ? String(viewerId) : "";

  if (targetId && currentId && targetId === currentId) {
    return "/(protected)/(tabs)/profile";
  }

  if (targetUsername) {
    return `/(protected)/profile/${targetUsername}`;
  }

  if (targetId) {
    return `/(protected)/profile/${targetId}`;
  }

  return "/(protected)/(tabs)/profile";
}
