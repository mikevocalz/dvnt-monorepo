import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import { getCurrentUserIdSync, resolveUserIdInt } from "./auth-helper";
import { requireBetterAuthToken } from "../auth/identity";

export const blocksApi = {
  /**
   * Get blocked users for current user
   */
  async getBlockedUsers() {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) return [];

      // Note: This assumes a 'blocks' table exists in the schema
      // If not, this will return empty array
      const { data, error } = await supabase
        .from("blocks")
        .select(
          `
          id,
          created_at,
          blocked:blocked_id(
            id,
            username,
            first_name,
            last_name,
            avatar:avatar_id(url)
          )
        `,
        )
        .eq("blocker_id", userId);

      if (error) {
        console.log(
          "[Blocks] getBlockedUsers - table may not exist:",
          error.message,
        );
        return [];
      }

      return (data || []).map((block: any) => ({
        id: String(block.id),
        blockId: String(block.id),
        userId: String(block.blocked?.id),
        username: block.blocked?.username || "unknown",
        name: block.blocked?.first_name || block.blocked?.username || "Unknown",
        avatar: block.blocked?.avatar?.url || null,
        blockedAt: block.created_at,
      }));
    } catch (error) {
      console.error("[Blocks] getBlockedUsers error:", error);
      return [];
    }
  },

  /**
   * Block a user via Edge Function
   */
  async blockUser(targetUserId: string) {
    try {
      const token = await requireBetterAuthToken();

      let bodyPayload: { targetUserId?: number; targetAuthId?: string };
      try {
        const targetUserIdInt = await resolveUserIdInt(targetUserId);
        bodyPayload = { targetUserId: targetUserIdInt };
      } catch (e: any) {
        if (e?.message?.startsWith("NEEDS_PROVISION:")) {
          bodyPayload = {
            targetAuthId: e.message.replace("NEEDS_PROVISION:", ""),
          };
        } else {
          throw e;
        }
      }

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { blocked: boolean };
        error?: { code: string; message: string };
      }>("toggle-block", {
        body: bodyPayload,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to block user");
      if (!response?.ok)
        throw new Error(response?.error?.message || "Failed to block user");

      return { success: true, blocked: response.data?.blocked };
    } catch (error) {
      console.error("[Blocks] blockUser error:", error);
      throw error;
    }
  },

  /**
   * Unblock a user via Edge Function
   */
  async unblockUser(targetUserId: string) {
    try {
      const token = await requireBetterAuthToken();

      let bodyPayload: { targetUserId?: number; targetAuthId?: string };
      try {
        const targetUserIdInt = await resolveUserIdInt(targetUserId);
        bodyPayload = { targetUserId: targetUserIdInt };
      } catch (e: any) {
        if (e?.message?.startsWith("NEEDS_PROVISION:")) {
          bodyPayload = {
            targetAuthId: e.message.replace("NEEDS_PROVISION:", ""),
          };
        } else {
          throw e;
        }
      }

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { blocked: boolean };
        error?: { code: string; message: string };
      }>("toggle-block", {
        body: bodyPayload,
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to unblock user");
      if (!response?.ok)
        throw new Error(response?.error?.message || "Failed to unblock user");

      return { success: true, blocked: response.data?.blocked };
    } catch (error) {
      console.error("[Blocks] unblockUser error:", error);
      throw error;
    }
  },
};
