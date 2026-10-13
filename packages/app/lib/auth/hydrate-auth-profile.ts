import type { AppUser } from "../auth-client";

/** Keep the complete owner DTO from auth-sync instead of rebuilding a public
 * profile whitelist at each sign-in entry. Missing private fields stay unknown;
 * no previous account or persisted snapshot is merged into a new login. */
export function hydrateAuthProfile(profile: AppUser, fallbackName = ""): AppUser {
  return {
    ...profile,
    name: profile.name || fallbackName || profile.username,
    avatar: profile.avatar || "",
    bio: profile.bio || "",
    website: profile.website || "",
    location: profile.location || "",
    hashtags: profile.hashtags || [],
  };
}
