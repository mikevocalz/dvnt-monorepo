import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export interface AppUser {
  id: string;
  authId?: string;
  email: string;
  username: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  links?: string[];
  location?: string;
  hashtags?: string[];
  isVerified: boolean;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  gender?: string;
  pronouns?: string;
}

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

export const auth = {
  /**
   * Sign in with email/password
   */
  async signIn(email: string, password: string) {
    console.log("[Supabase Auth] Signing in:", email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[Supabase Auth] Sign in error:", error);
      throw error;
    }

    // Fetch user profile
    const profile = await this.getProfile(data.user.id);
    console.log("[Supabase Auth] Sign in successful, user ID:", data.user.id);

    return { user: data.user, session: data.session, profile };
  },

  /**
   * Sign up with email/password/username
   */
  async signUp(
    email: string,
    password: string,
    username: string,
    name?: string,
  ) {
    void email;
    void password;
    void username;
    void name;
    throw new Error(
      "Legacy Supabase signup is disabled. Use Better Auth signup and auth-sync.",
    );
  },

  /**
   * Sign out
   */
  async signOut() {
    console.log("[Supabase Auth] Signing out");
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("[Supabase Auth] Sign out error:", error);
      throw error;
    }
  },

  /**
   * Get current session
   */
  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("[Supabase Auth] Get session error:", error);
      return null;
    }
    return data.session;
  },

  /**
   * Get current user
   * NOTE: Uses Better Auth store, not supabase.auth.getUser()
   */
  getCurrentUser() {
    const { useAuthStore } = require("../stores/auth-store");
    return useAuthStore.getState().user;
  },

  /**
   * Get user profile from users table
   */
  async getProfile(userId: string, email?: string): Promise<AppUser | null> {
    try {
      const selectFields = `
          ${DB.users.id},
          ${DB.users.authId},
          ${DB.users.username},
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
          avatar:${DB.users.avatarId}(url)
        `;

      // Check if userId is numeric (users table integer ID)
      const isNumeric = /^\d+$/.test(userId);

      let data: any = null;
      let error: any = null;

      if (isNumeric) {
        // Query by internal ID
        const result = await supabase
          .from(DB.users.table)
          .select(selectFields)
          .eq(DB.users.id, parseInt(userId))
          .single();
        data = result.data;
        error = result.error;
      } else {
        // Try query by auth_id first
        const authIdResult = await supabase
          .from(DB.users.table)
          .select(selectFields)
          .eq(DB.users.authId, userId)
          .single();

        if (authIdResult.data) {
          data = authIdResult.data;
        } else {
          // No email fallback: clients cannot filter on users.email
          // (20261003150400). auth-sync links auth_id from the verified
          // session; until it has, the caller falls back to session data.
          error = authIdResult.error;
        }
      }

      if (error || !data) {
        console.error("[Auth] Get profile error:", error);
        return null;
      }

      return {
        id: String(data[DB.users.id]),
        authId: data[DB.users.authId] || userId,
        email: email ?? "",
        username: data[DB.users.username],
        name: data[DB.users.firstName] || data[DB.users.username],
        avatar: data.avatar?.url,
        bio: data[DB.users.bio],
        website: data[DB.users.website] || "",
        links: normalizeUserLinks(data[DB.users.links]),
        location: data[DB.users.location],
        isVerified: data[DB.users.verified] || false,
        postsCount: Number(data[DB.users.postsCount]) || 0,
        followersCount: Number(data[DB.users.followersCount]) || 0,
        followingCount: Number(data[DB.users.followingCount]) || 0,
        gender: data[DB.users.gender] || "",
        pronouns: data[DB.users.pronouns] || "",
        hashtags: [],
      };
    } catch (error) {
      console.error("[Supabase Auth] Get profile error:", error);
      return null;
    }
  },

  /**
   * Listen to auth state changes
   */
  onAuthStateChange(callback: (event: string, session: any) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
