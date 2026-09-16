import { isSameUser, type UserRef } from "./same-user.ts";

/** Stable identity wins over a cached handle when opening your own story. */
export function storyProfilePath(
  story: { username?: string; userId?: string | number },
  viewer: (UserRef & { username?: string }) | null | undefined,
  platform: "web" | "native",
): string | null {
  const username = story.username?.trim();
  if (!username) return null;
  const own = story.userId
    ? isSameUser(viewer, { userId: story.userId })
    : username.toLowerCase() === viewer?.username?.toLowerCase();
  if (own) return platform === "web" ? "/feed/profile" : "/(protected)/(tabs)/profile";
  return `${platform === "web" ? "" : "/(protected)"}/profile/${encodeURIComponent(username)}`;
}
