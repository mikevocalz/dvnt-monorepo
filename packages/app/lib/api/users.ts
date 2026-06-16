import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import { getCurrentUserId, getCurrentUserIdSync } from "./auth-helper";
import { updateProfilePrivileged } from "../supabase/privileged";
import { requireBetterAuthToken, getCurrentUserRow } from "../auth/identity";
import { invokeEdge } from "./invoke-edge";

function normalizeUserLinks(value: unknown): string[] {
  const sanitize = (items: unknown[]) =>
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);

  if (Array.isArray(value)) {
    return sanitize(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return sanitize(parsed);
      }
    } catch {
      return [trimmed];
    }
  }

  return [];
}

async function getViewerIdForRelationshipChecks(): Promise<number | null> {
  const viewerId = getCurrentUserIdSync();
  if (viewerId) return viewerId;

  const viewerRow = await getCurrentUserRow();
  return viewerRow?.id ?? null;
}

type BetterAuthUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  username: string | null;
  createdAt: string | null;
};

async function getBetterAuthUserById(
  authId: string | null | undefined,
): Promise<BetterAuthUserRow | null> {
  if (!authId) return null;

  const { data, error } = await supabase
    .from("user")
    .select("id, name, email, image, username, createdAt")
    .eq("id", authId)
    .maybeSingle();

  if (error) {
    console.error("[Users] getBetterAuthUserById error:", error);
    return null;
  }

  return (data as BetterAuthUserRow | null) ?? null;
}

function buildDisplayNameParts(displayName: string | null | undefined) {
  const trimmed = (displayName || "").trim();
  return {
    fullName: trimmed,
    firstName: trimmed.split(" ")[0] || "",
    lastName: trimmed.split(" ").slice(1).join(" ") || "",
  };
}

async function getLiveProfileCounts(targetUserId: number | null | undefined) {
  if (!targetUserId || !Number.isFinite(targetUserId)) {
    return null;
  }

  const [
    { count: followersCount, error: followersError },
    { count: followingCount, error: followingError },
    { count: postsCount, error: postsError },
  ] = await Promise.all([
    supabase
      .from(DB.follows.table)
      .select(DB.follows.id, { count: "exact", head: true })
      .eq(DB.follows.followingId, targetUserId),
    supabase
      .from(DB.follows.table)
      .select(DB.follows.id, { count: "exact", head: true })
      .eq(DB.follows.followerId, targetUserId),
    supabase
      .from(DB.posts.table)
      .select(DB.posts.id, { count: "exact", head: true })
      .eq(DB.posts.authorId, targetUserId),
  ]);

  if (followersError || followingError || postsError) {
    console.error("[Users] getLiveProfileCounts error:", {
      targetUserId,
      followersError,
      followingError,
      postsError,
    });
  }

  return {
    followersCount:
      typeof followersCount === "number" ? followersCount : undefined,
    followingCount:
      typeof followingCount === "number" ? followingCount : undefined,
    postsCount: typeof postsCount === "number" ? postsCount : undefined,
  };
}

export const usersApi = {
  /**
   * Get user profile by username
   */
  async getProfileByUsername(username: string) {
    try {
      if (!username) return null;

      const currentUserId = await getViewerIdForRelationshipChecks();

      // Fire user fetch + follow check in parallel (no waterfall)
      const userFetch = supabase
        .from(DB.users.table)
        .select(
          `
          ${DB.users.id},
          ${DB.users.authId},
          ${DB.users.username},
          ${DB.users.email},
          ${DB.users.firstName},
          ${DB.users.lastName},
          ${DB.users.bio},
          ${DB.users.location},
          ${DB.users.website},
          ${DB.users.links},
          ${DB.users.pronouns},
          ${DB.users.gender},
          ${DB.users.verified},
          ${DB.users.followersCount},
          ${DB.users.followingCount},
          ${DB.users.postsCount},
          ${DB.users.isPrivate},
          ${DB.users.createdAt},
          avatar:${DB.users.avatarId}(url)
        `,
        )
        .eq(DB.users.username, username)
        .single();

      const [{ data, error }] = await Promise.all([userFetch]);

      if (data) {
        const targetUserId = data[DB.users.id];
        const authId = data[DB.users.authId];
        const dbAvatar =
          (data.avatar as any)?.url || (data.avatar as any)?.[0]?.url || "";
        const [betterAuthUser, liveCounts] = await Promise.all([
          !dbAvatar && authId ? getBetterAuthUserById(authId) : null,
          getLiveProfileCounts(targetUserId),
        ]);
        const displayNameParts = buildDisplayNameParts(betterAuthUser?.name);
        const resolvedUsername =
          data[DB.users.username] || betterAuthUser?.username || username;

        // Follow check fires only when we have both IDs and they differ
        let isFollowing = false;
        if (currentUserId && targetUserId && currentUserId !== targetUserId) {
          const { data: followData } = await supabase
            .from(DB.follows.table)
            .select("id")
            .eq(DB.follows.followerId, currentUserId)
            .eq(DB.follows.followingId, targetUserId)
            .maybeSingle();
          isFollowing = !!followData;
        }

        return {
          id: String(targetUserId),
          authId,
          username: resolvedUsername,
          email: data[DB.users.email] || betterAuthUser?.email || "",
          firstName: data[DB.users.firstName] || displayNameParts.firstName,
          lastName: data[DB.users.lastName] || displayNameParts.lastName,
          name:
            data[DB.users.firstName] ||
            displayNameParts.fullName ||
            resolvedUsername,
          bio: data[DB.users.bio] || "",
          location: data[DB.users.location],
          website: data[DB.users.website] || "",
          links: normalizeUserLinks(data[DB.users.links]),
          pronouns: data[DB.users.pronouns] || "",
          gender: data[DB.users.gender] || "",
          avatar: dbAvatar || betterAuthUser?.image || "",
          verified: data[DB.users.verified] || false,
          followersCount:
            (liveCounts?.followersCount ??
              Number(data[DB.users.followersCount])) ||
            0,
          followingCount:
            (liveCounts?.followingCount ??
              Number(data[DB.users.followingCount])) ||
            0,
          postsCount:
            (liveCounts?.postsCount ?? Number(data[DB.users.postsCount])) || 0,
          isPrivate: data[DB.users.isPrivate] || false,
          isFollowing,
          createdAt: data[DB.users.createdAt],
        };
      }

      // Fallback: Better Auth `user` table by username (single indexed query)
      const { data: baUser } = await supabase
        .from("user")
        .select("id, name, email, image, username, createdAt")
        .eq("username", username)
        .maybeSingle();

      if (baUser) {
        // Re-check by auth_id so freshly provisioned users do not fall back to
        // a stale auth-only shape when the username in `users` differs or lags.
        const authProfile = await usersApi.getProfileByAuthUserId(baUser.id);
        if (authProfile) {
          return {
            ...authProfile,
            username: authProfile.username || baUser.username || username,
            avatar: authProfile.avatar || baUser.image || "",
          };
        }
      }

      return null;
    } catch (error) {
      console.error("[Users] getProfileByUsername error:", error);
      return null;
    }
  },

  /**
   * Get user profile by ID (supports both integer ID and UUID auth_id)
   */
  async getProfileById(userId: string) {
    try {
      console.log("[Users] getProfileById:", userId);

      if (!userId) return null;
      const currentUserId = await getViewerIdForRelationshipChecks();

      // Determine if userId is a numeric integer ID or a string auth_id
      // Better Auth IDs are non-numeric strings (no dashes); integer IDs are all digits
      const isNumericId = /^\d+$/.test(userId);

      const { data, error } = await supabase
        .from(DB.users.table)
        .select(
          `
          ${DB.users.id},
          ${DB.users.authId},
          ${DB.users.username},
          ${DB.users.email},
          ${DB.users.firstName},
          ${DB.users.lastName},
          ${DB.users.bio},
          ${DB.users.location},
          ${DB.users.website},
          ${DB.users.links},
          ${DB.users.pronouns},
          ${DB.users.gender},
          ${DB.users.verified},
          ${DB.users.followersCount},
          ${DB.users.followingCount},
          ${DB.users.postsCount},
          ${DB.users.isPrivate},
          ${DB.users.createdAt},
          avatar:${DB.users.avatarId}(url)
        `,
        )
        .eq(
          isNumericId ? DB.users.id : DB.users.authId,
          isNumericId ? parseInt(userId) : userId,
        )
        .single();

      if (error) {
        console.error("[Users] getProfileById error:", error);
        return null;
      }

      const authId = data[DB.users.authId];
      const dbAvatar =
        (data.avatar as any)?.url || (data.avatar as any)?.[0]?.url || "";
      const [betterAuthUser, liveCounts] = await Promise.all([
        !dbAvatar && authId ? getBetterAuthUserById(authId) : null,
        getLiveProfileCounts(data[DB.users.id]),
      ]);
      const displayNameParts = buildDisplayNameParts(betterAuthUser?.name);
      const resolvedUsername =
        data[DB.users.username] || betterAuthUser?.username || "";
      let isFollowing = false;
      if (
        currentUserId &&
        data[DB.users.id] &&
        currentUserId !== data[DB.users.id]
      ) {
        const { data: followData } = await supabase
          .from(DB.follows.table)
          .select("id")
          .eq(DB.follows.followerId, currentUserId)
          .eq(DB.follows.followingId, data[DB.users.id])
          .maybeSingle();
        isFollowing = !!followData;
      }

      return {
        id: String(data[DB.users.id]),
        authId,
        username: resolvedUsername,
        email: data[DB.users.email] || betterAuthUser?.email || "",
        firstName: data[DB.users.firstName] || displayNameParts.firstName,
        lastName: data[DB.users.lastName] || displayNameParts.lastName,
        name:
          data[DB.users.firstName] ||
          displayNameParts.fullName ||
          resolvedUsername,
        bio: data[DB.users.bio] || "",
        location: data[DB.users.location],
        website: data[DB.users.website] || "",
        links: normalizeUserLinks(data[DB.users.links]),
        pronouns: data[DB.users.pronouns] || "",
        gender: data[DB.users.gender] || "",
        avatar: dbAvatar || betterAuthUser?.image || "",
        verified: data[DB.users.verified] || false,
        followersCount:
          (liveCounts?.followersCount ??
            Number(data[DB.users.followersCount])) ||
          0,
        followingCount:
          (liveCounts?.followingCount ??
            Number(data[DB.users.followingCount])) ||
          0,
        postsCount:
          (liveCounts?.postsCount ?? Number(data[DB.users.postsCount])) || 0,
        isPrivate: data[DB.users.isPrivate] || false,
        isFollowing,
        createdAt: data[DB.users.createdAt],
      };
    } catch (error) {
      console.error("[Users] getProfileById error:", error);
      return null;
    }
  },

  /**
   * Get profile by Better Auth user ID (fallback for users without app profile)
   * Queries the Better Auth `user` table directly when `users` table has no row
   */
  async getProfileByAuthUserId(authId: string) {
    try {
      if (!authId) return null;
      const currentUserId = await getViewerIdForRelationshipChecks();

      // First try the app `users` table via auth_id
      const { data: profile } = await supabase
        .from(DB.users.table)
        .select(
          `
          ${DB.users.id},
          ${DB.users.authId},
          ${DB.users.username},
          ${DB.users.email},
          ${DB.users.firstName},
          ${DB.users.lastName},
          ${DB.users.bio},
          ${DB.users.location},
          ${DB.users.website},
          ${DB.users.links},
          ${DB.users.pronouns},
          ${DB.users.gender},
          ${DB.users.verified},
          ${DB.users.followersCount},
          ${DB.users.followingCount},
          ${DB.users.postsCount},
          ${DB.users.isPrivate},
          ${DB.users.createdAt},
          avatar:${DB.users.avatarId}(url)
        `,
        )
        .eq(DB.users.authId, authId)
        .maybeSingle();

      if (profile) {
        const targetUserId = profile[DB.users.id];
        const resolvedAuthId = profile[DB.users.authId];
        const dbAvatar =
          (profile.avatar as any)?.url ||
          (profile.avatar as any)?.[0]?.url ||
          "";
        const [betterAuthUser, liveCounts] = await Promise.all([
          (!dbAvatar || !profile[DB.users.firstName]) && resolvedAuthId
            ? getBetterAuthUserById(resolvedAuthId)
            : null,
          getLiveProfileCounts(targetUserId),
        ]);
        const displayNameParts = buildDisplayNameParts(betterAuthUser?.name);
        const resolvedUsername =
          profile[DB.users.username] || betterAuthUser?.username || authId;
        let isFollowing = false;
        if (currentUserId && targetUserId && currentUserId !== targetUserId) {
          const { data: followData } = await supabase
            .from(DB.follows.table)
            .select("id")
            .eq(DB.follows.followerId, currentUserId)
            .eq(DB.follows.followingId, targetUserId)
            .maybeSingle();
          isFollowing = !!followData;
        }

        return {
          id: String(profile[DB.users.id]),
          username: resolvedUsername,
          authId: resolvedAuthId,
          email: profile[DB.users.email] || betterAuthUser?.email || "",
          firstName: profile[DB.users.firstName] || displayNameParts.firstName,
          lastName: profile[DB.users.lastName] || displayNameParts.lastName,
          name:
            profile[DB.users.firstName] ||
            displayNameParts.fullName ||
            resolvedUsername,
          bio: profile[DB.users.bio] || "",
          location: profile[DB.users.location],
          website: profile[DB.users.website] || "",
          links: normalizeUserLinks(profile[DB.users.links]),
          pronouns: profile[DB.users.pronouns] || "",
          gender: profile[DB.users.gender] || "",
          avatar: dbAvatar || betterAuthUser?.image || "",
          verified: profile[DB.users.verified] || false,
          followersCount:
            (liveCounts?.followersCount ??
              Number(profile[DB.users.followersCount])) ||
            0,
          followingCount:
            (liveCounts?.followingCount ??
              Number(profile[DB.users.followingCount])) ||
            0,
          postsCount:
            (liveCounts?.postsCount ?? Number(profile[DB.users.postsCount])) ||
            0,
          isPrivate: profile[DB.users.isPrivate] || false,
          isFollowing,
          createdAt: profile[DB.users.createdAt],
        };
      }

      // Fallback: query Better Auth `user` table directly
      const { data: authUser, error } = await supabase
        .from("user")
        .select("id, name, email, image, username, createdAt")
        .eq("id", authId)
        .single();

      if (error || !authUser) return null;

      const displayName = (authUser.name || "").trim();
      return {
        id: authId,
        authId,
        username:
          authUser.username ||
          displayName.toLowerCase().replace(/\s+/g, "_") ||
          authId,
        email: authUser.email,
        firstName: displayName.split(" ")[0] || "",
        lastName: displayName.split(" ").slice(1).join(" ") || "",
        name: displayName || "New User",
        bio: "",
        location: null,
        website: "",
        links: [],
        pronouns: "",
        gender: "",
        avatar: authUser.image || "",
        verified: false,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        isPrivate: false,
        isFollowing: false,
        createdAt: authUser.createdAt,
      };
    } catch (error) {
      console.error("[Users] getProfileByAuthUserId error:", error);
      return null;
    }
  },

  /**
   * Update current user's profile via Edge Function
   * Uses privileged wrapper to bypass RLS securely
   */
  async updateProfile(updates: {
    firstName?: string;
    lastName?: string;
    username?: string;
    pronouns?: string;
    gender?: string;
    bio?: string;
    location?: string;
    name?: string;
    website?: string;
    links?: string[];
    avatar?: string;
  }) {
    try {
      console.log("[Users] updateProfile via Edge Function:", updates);

      const primaryPayload = {
        name: updates.name,
        firstName: updates.firstName,
        lastName: updates.lastName,
        username: updates.username,
        bio: updates.bio,
        location: updates.location,
        website: updates.website,
        avatarUrl: updates.avatar,
        ...(updates.pronouns !== undefined
          ? { pronouns: updates.pronouns.trim() }
          : {}),
        ...(updates.gender !== undefined
          ? { gender: updates.gender.trim() }
          : {}),
        ...(Array.isArray(updates.links) ? { links: updates.links } : {}),
      };

      const fallbackPayload = {
        name: updates.name,
        firstName: updates.firstName,
        lastName: updates.lastName,
        username: updates.username,
        bio: updates.bio,
        location: updates.location,
        website: updates.website,
        avatarUrl: updates.avatar,
      };

      let updatedUser;
      try {
        updatedUser = await updateProfilePrivileged(primaryPayload);
      } catch (error: any) {
        const errorMessage = String(error?.message || "");
        const usedOptionalFields =
          "pronouns" in primaryPayload ||
          "gender" in primaryPayload ||
          "links" in primaryPayload;
        const shouldRetryBasePayload =
          usedOptionalFields &&
          (errorMessage === "Failed to update profile" ||
            errorMessage === "An unexpected error occurred");

        if (!shouldRetryBasePayload) {
          throw error;
        }

        console.warn(
          "[Users] updateProfile retrying without optional fields:",
          errorMessage,
        );
        updatedUser = await updateProfilePrivileged(fallbackPayload);
      }

      const normalizedUser = {
        ...updatedUser,
        links: normalizeUserLinks((updatedUser as any)?.links),
      };

      console.log("[Users] updateProfile success:", normalizedUser);
      return normalizedUser;
    } catch (error) {
      console.error("[Users] updateProfile error:", error);
      throw error;
    }
  },

  /**
   * Get liked posts for current user (Edge Function — bypasses RLS)
   */
  async getLikedPosts(): Promise<string[]> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        postIds?: string[];
        error?: string;
      }>("get-liked-posts", {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Users] getLikedPosts Edge Function error:", error);
        return [];
      }
      if (!data?.postIds) {
        if (data?.error) console.error("[Users] get-liked-posts:", data.error);
        return [];
      }
      return data.postIds;
    } catch (error) {
      console.error("[Users] getLikedPosts error:", error);
      return [];
    }
  },

  /**
   * Get newest users (for "Discover New Profiles" section)
   * Queries Better Auth `user` table for real signups, then enriches
   * with app `users` profile data where available.
   */
  async getNewestUsers(limit: number = 15) {
    try {
      // Get current user's auth_id to exclude from results
      const currentUserRow = await getCurrentUserRow();
      const currentAuthId = currentUserRow?.authId || null;

      // Query Better Auth `user` table — this is where real signups live
      let query = supabase
        .from("user")
        .select("id, name, email, image, username, createdAt")
        .order("createdAt", { ascending: false })
        .limit(limit * 3);

      if (currentAuthId) {
        query = query.neq("id", currentAuthId);
      }

      const { data: authUsers, error } = await query;

      if (error) {
        console.error("[Users] getNewestUsers BA query error:", error);
        throw error;
      }
      if (!authUsers?.length) {
        console.log("[Users] getNewestUsers: no BA users found");
        return [];
      }

      console.log("[Users] getNewestUsers BA raw count:", authUsers.length);

      // Phase 1: Filter out test accounts by email only
      const TEST_EMAILS = ["@test.com", "@example.com", "@deviant.test"];
      const emailFiltered = authUsers.filter((u: any) => {
        const email = (u.email || "").toLowerCase();
        if (TEST_EMAILS.some((t) => email.endsWith(t))) return false;
        const name = (u.name || "").toLowerCase().trim();
        if (name.startsWith("test")) return false;
        return true;
      });

      // Enrich with app profile data (username, avatar, bio)
      const authIds = emailFiltered.map((u: any) => u.id);
      const { data: profiles } = await supabase
        .from(DB.users.table)
        .select(
          `${DB.users.authId}, ${DB.users.username}, ${DB.users.bio}, ${DB.users.verified}, avatar:${DB.users.avatarId}(url)`,
        )
        .in(DB.users.authId, authIds);

      const profileMap: Record<string, any> = {};
      for (const p of profiles || []) {
        profileMap[p[DB.users.authId]] = p;
      }

      // Phase 2: Filter out hidden accounts by BOTH name and username
      const HIDDEN_USERNAMES = ["mike_test", "applereview"];
      const filtered = emailFiltered.filter((u: any) => {
        const profile = profileMap[u.id];
        const name = (u.name || "").toLowerCase().trim();
        const username = (profile?.[DB.users.username] || "").toLowerCase();
        if (HIDDEN_USERNAMES.includes(name)) return false;
        if (HIDDEN_USERNAMES.includes(username)) return false;
        return true;
      });

      console.log("[Users] getNewestUsers filtered count:", filtered.length);

      return filtered.slice(0, limit).map((u: any) => {
        const profile = profileMap[u.id];
        const displayName = (u.name || "").trim();
        const username =
          profile?.[DB.users.username] ||
          u.username ||
          displayName.toLowerCase().replace(/\s+/g, "_");
        return {
          id: u.id,
          username,
          name: displayName || username,
          avatar: profile?.avatar?.url || u.image || "",
          verified: profile?.[DB.users.verified] || false,
          bio: profile?.[DB.users.bio] || "",
          postsCount: 0,
        };
      });
    } catch (error) {
      console.error("[Users] getNewestUsers error:", error);
      return [];
    }
  },

  /**
   * Search users by query
   */
  async searchUsers(query: string, limit: number = 20) {
    try {
      if (!query || query.length < 1) return { docs: [], totalDocs: 0 };

      const { data, error, count } = await supabase
        .from(DB.users.table)
        .select(
          `
          ${DB.users.id},
          ${DB.users.authId},
          ${DB.users.username},
          ${DB.users.firstName},
          ${DB.users.lastName},
          ${DB.users.bio},
          ${DB.users.verified},
          avatar:${DB.users.avatarId}(url)
        `,
          { count: "exact" },
        )
        .or(
          `${DB.users.username}.ilike.%${query}%,${DB.users.firstName}.ilike.%${query}%`,
        )
        .limit(limit);

      if (error) throw error;

      const docs = (data || []).map((user: any) => ({
        id: String(user[DB.users.id]),
        authId: user[DB.users.authId] || "",
        username: user[DB.users.username] || "unknown",
        name: user[DB.users.firstName] || user[DB.users.username] || "Unknown",
        firstName: user[DB.users.firstName],
        lastName: user[DB.users.lastName],
        avatar: user.avatar?.url || "",
        bio: user[DB.users.bio] || "",
        verified: user[DB.users.verified] || false,
      }));

      return { docs, totalDocs: count || 0 };
    } catch (error) {
      console.error("[Users] searchUsers error:", error);
      return { docs: [], totalDocs: 0 };
    }
  },

  /**
   * Get followers for a user (Edge Function — bypasses RLS)
   */
  async getFollowers(userId: string, page: number = 1, limit: number = 20) {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        docs?: any[];
        totalDocs?: number;
        hasNextPage?: boolean;
        page?: number;
        error?: string;
      }>("get-followers", {
        body: { userId, page, limit },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Users] getFollowers Edge Function error:", error);
        return { docs: [], totalDocs: 0, hasNextPage: false, page };
      }
      if (!data?.docs) {
        if (data?.error) console.error("[Users] get-followers:", data.error);
        return { docs: [], totalDocs: 0, hasNextPage: false, page };
      }
      return {
        docs: data.docs,
        totalDocs: data.totalDocs ?? 0,
        hasNextPage: data.hasNextPage ?? false,
        page: data.page ?? page,
      };
    } catch (error) {
      console.error("[Users] getFollowers error:", error);
      return { docs: [], totalDocs: 0, hasNextPage: false, page };
    }
  },

  /**
   * Get following for a user (Edge Function — bypasses RLS)
   */
  async getFollowing(userId: string, page: number = 1, limit: number = 20) {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        docs?: any[];
        totalDocs?: number;
        hasNextPage?: boolean;
        page?: number;
        error?: string;
      }>("get-following", {
        body: { userId, page, limit },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Users] getFollowing Edge Function error:", error);
        return { docs: [], totalDocs: 0, hasNextPage: false, page };
      }
      if (!data?.docs) {
        if (data?.error) console.error("[Users] get-following:", data.error);
        return { docs: [], totalDocs: 0, hasNextPage: false, page };
      }
      return {
        docs: data.docs,
        totalDocs: data.totalDocs ?? 0,
        hasNextPage: data.hasNextPage ?? false,
        page: data.page ?? page,
      };
    } catch (error) {
      console.error("[Users] getFollowing error:", error);
      return { docs: [], totalDocs: 0, hasNextPage: false, page };
    }
  },

  /**
   * Update avatar
   */
  async updateAvatar(avatarUrl: string) {
    try {
      console.log("[Users] updateAvatar via Edge Function");

      const token = await requireBetterAuthToken();

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { success: boolean; avatarUrl: string };
        error?: { code: string; message: string };
      }>("update-avatar", {
        body: { avatarUrl },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to update avatar");
      if (!response?.ok)
        throw new Error(response?.error?.message || "Failed to update avatar");

      return { success: true, avatarUrl };
    } catch (error) {
      console.error("[Users] updateAvatar error:", error);
      throw error;
    }
  },

  /**
   * Get current user
   */
  async getCurrentUser() {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) return null;

      const { data, error } = await supabase
        .from(DB.users.table)
        .select(
          `
          ${DB.users.id},
          ${DB.users.username},
          ${DB.users.email},
          ${DB.users.firstName},
          ${DB.users.lastName},
          ${DB.users.bio},
          ${DB.users.verified},
          avatar:${DB.users.avatarId}(url)
        `,
        )
        .eq(DB.users.id, userId)
        .single();

      if (error) return null;

      return {
        id: String(data[DB.users.id]),
        username: data[DB.users.username],
        email: data[DB.users.email],
        firstName: data[DB.users.firstName],
        lastName: data[DB.users.lastName],
        name: data[DB.users.firstName] || data[DB.users.username],
        bio: data[DB.users.bio] || "",
        avatar:
          (data.avatar as any)?.url || (data.avatar as any)?.[0]?.url || "",
        verified: data[DB.users.verified] || false,
      };
    } catch (error) {
      console.error("[Users] getCurrentUser error:", error);
      return null;
    }
  },

  /**
   * Submit a host verification request
   */
  async submitVerificationRequest(reason?: string, socialUrl?: string) {
    try {
      const { data, error } = await invokeEdge<{
        ok: boolean;
        data?: { success: boolean; error?: string; request_id?: number };
        error?: { code: string; message: string };
      }>("submit-verification", {
        reason: reason || null,
        socialUrl: socialUrl || null,
      });

      if (error) throw error;
      if (!data?.ok) {
        return {
          success: false,
          error: data?.error?.message || "Failed to submit request",
        };
      }
      return (
        data.data ?? { success: false, error: "No response from server" }
      );
    } catch (error) {
      console.error("[Users] submitVerificationRequest error:", error);
      return { success: false, error: "Failed to submit request" };
    }
  },

  /**
   * Get current user's verification status
   */
  async getVerificationStatus() {
    try {
      const authId = await getCurrentUserId();
      if (!authId) return null;

      const { data, error } = await supabase.rpc("get_verification_status", {
        p_user_auth_id: authId,
      });

      if (error) throw error;
      return data as {
        is_verified: boolean;
        has_pending_request: boolean;
        last_request_status: string | null;
        last_request_date: string | null;
      };
    } catch (error) {
      console.error("[Users] getVerificationStatus error:", error);
      return null;
    }
  },
};
