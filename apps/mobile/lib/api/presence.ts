/**
 * Presence API
 *
 * Manages user online/offline status via the user_presence table.
 * Called from the usePresence hook.
 */

import { supabase } from "@/lib/supabase/client";

export const presenceApi = {
  /**
   * Upsert the current user's presence as online
   */
  async setOnline(userId: number) {
    const { error } = await supabase.from("user_presence").upsert(
      {
        user_id: userId,
        is_online: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.warn("[Presence] setOnline error:", error.message);
    }
  },

  /**
   * Mark the current user as offline
   */
  async setOffline(userId: number) {
    const { error } = await supabase.from("user_presence").upsert(
      {
        user_id: userId,
        is_online: false,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.warn("[Presence] setOffline error:", error.message);
    }
  },

  /**
   * Get presence status for a list of user IDs
   */
  async getPresence(
    userIds: number[],
  ): Promise<Array<{ userId: number; isOnline: boolean; lastSeenAt: string }>> {
    if (!userIds.length) return [];

    const { data, error } = await supabase
      .from("user_presence")
      .select("user_id, is_online, last_seen_at")
      .in("user_id", userIds);

    if (error) {
      console.warn("[Presence] getPresence error:", error.message);
      return [];
    }

    const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 min
    const now = Date.now();

    return (data || []).map((row: any) => {
      let isOnline = row.is_online ?? false;
      if (isOnline && row.last_seen_at) {
        const lastSeen = new Date(row.last_seen_at).getTime();
        if (now - lastSeen > STALE_THRESHOLD_MS) {
          isOnline = false;
        }
      }
      return {
        userId: row.user_id,
        isOnline,
        lastSeenAt: row.last_seen_at,
      };
    });
  },

  /**
   * Get presence for a single user
   */
  async getUserPresence(
    userId: number,
  ): Promise<{ isOnline: boolean; lastSeenAt: string } | null> {
    const { data, error } = await supabase
      .from("user_presence")
      .select("is_online, last_seen_at")
      .eq("user_id", userId)
      .single();

    if (error) return null;

    // Validate is_online against last_seen_at — if heartbeat is stale (>2min),
    // treat as offline regardless of DB flag (handles app crashes, force-closes)
    const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 min (4× heartbeat interval)
    let isOnline = data?.is_online ?? false;
    if (isOnline && data?.last_seen_at) {
      const lastSeen = new Date(data.last_seen_at).getTime();
      const now = Date.now();
      if (now - lastSeen > STALE_THRESHOLD_MS) {
        isOnline = false;
      }
    }

    return {
      isOnline,
      lastSeenAt: data?.last_seen_at ?? "",
    };
  },
};
