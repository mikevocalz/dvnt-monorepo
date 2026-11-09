import { supabase } from "../supabase/client";
import { resolveUserIdInt } from "./auth-helper";
import { requireBetterAuthToken } from "../auth/identity";

interface ToggleFollowResponseData {
  following: boolean;
  followRequestStatus: "none" | "pending" | "approved";
  targetUserId: string;
  targetUsername: string;
  viewerFollows: boolean;
  targetFollowersCount: number;
  targetFollowingCount: number;
  callerFollowersCount: number;
  callerFollowingCount: number;
  updatedAt: string;
  correlationId: string;
}

interface ToggleFollowResponse {
  ok: boolean;
  data?: ToggleFollowResponseData;
  error?: { code: string; message: string };
}

export interface FollowMutationResult {
  success: boolean;
  following: boolean;
  followRequestStatus: "none" | "pending" | "approved";
  targetUsername: string;
  targetFollowersCount: number;
  targetFollowingCount: number;
  callerFollowersCount: number;
  callerFollowingCount: number;
  correlationId: string;
}

export const followsApi = {
  async requestAction(action: "status" | "requests" | "approve" | "decline", targetUserId?: string) {
    const token = await requireBetterAuthToken();
    const { data, error } = await supabase.functions.invoke("toggle-follow", {
      body: { action, ...(targetUserId ? { targetUserId: await resolveUserIdInt(targetUserId) } : {}) },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error || !data?.ok || !data.data) throw new Error(data?.error?.message || error?.message || "Follow request failed");
    return data.data;
  },
  async getFollowRequestStatus(targetUserId: string): Promise<{ following: boolean; followRequestStatus: "none" | "pending" | "approved" }> {
    return followsApi.requestAction("status", targetUserId);
  },
  async getFollowRequests(): Promise<Array<{ follower_id: number; created_at: string; requester: { username: string } | null }>> {
    return (await followsApi.requestAction("requests")).requests;
  },
  async respondToFollowRequest(requesterId: string, action: "approve" | "decline") {
    return followsApi.requestAction(action, requesterId);
  },
  /**
   * Follow/unfollow user via Edge Function.
   * Accepts explicit action for race-free, idempotent mutations.
   * Returns authoritative counts from server — NO extra query needed.
   */
  async followAction(
    targetUserId: string,
    action: "follow" | "unfollow",
  ): Promise<FollowMutationResult> {
    console.log(`[Follows] ${action} via Edge Function:`, targetUserId);

    const token = await requireBetterAuthToken();

    // Resolve to integer ID, or fall back to passing auth_id for server-side provisioning
    let bodyPayload: {
      targetUserId?: number;
      targetAuthId?: string;
      action: string;
    };
    try {
      const targetUserIdInt = await resolveUserIdInt(targetUserId);
      bodyPayload = { targetUserId: targetUserIdInt, action };
    } catch (e: any) {
      if (e?.message?.startsWith("NEEDS_PROVISION:")) {
        const authId = e.message.replace("NEEDS_PROVISION:", "");
        console.log(
          "[Follows] Auth-only user, passing authId for server-side resolution:",
          authId,
        );
        bodyPayload = { targetAuthId: authId, action };
      } else {
        throw e;
      }
    }

    const { data, error } =
      await supabase.functions.invoke<ToggleFollowResponse>("toggle-follow", {
        body: bodyPayload,
        headers: { Authorization: `Bearer ${token}` },
      });

    if (error) {
      console.error("[Follows] Edge Function error:", error);
      throw new Error(error.message || `Failed to ${action}`);
    }

    if (!data?.ok || !data?.data) {
      const errorMessage = data?.error?.message || `Failed to ${action}`;
      console.error(`[Follows] ${action} failed:`, errorMessage);
      throw new Error(errorMessage);
    }

    const result: FollowMutationResult = {
      success: true,
      following: data.data.following,
      followRequestStatus: data.data.followRequestStatus ?? "none",
      targetUsername: data.data.targetUsername,
      targetFollowersCount: data.data.targetFollowersCount,
      targetFollowingCount: data.data.targetFollowingCount,
      callerFollowersCount: data.data.callerFollowersCount,
      callerFollowingCount: data.data.callerFollowingCount,
      correlationId: data.data.correlationId,
    };

    console.log(`[Follows] ${action} result:`, result);
    return result;
  },

  /**
   * @deprecated Use followAction(targetUserId, action) instead.
   * Kept for backward compatibility during migration.
   */
  async toggleFollow(targetUserId: string, _isFollowing?: boolean) {
    return followsApi.followAction(
      targetUserId,
      _isFollowing ? "unfollow" : "follow",
    );
  },

  /**
   * Check if following user
   */
  async isFollowing(targetUserId: string): Promise<boolean> {
    try {
      return (await followsApi.getFollowRequestStatus(targetUserId)).following;
    } catch { return false; }
  },

  /**
   * Get followers list (Edge Function — bypasses RLS)
   */
  async getFollowers(userId: string) {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        docs?: { id: string; username: string; avatar: string }[];
        error?: string;
      }>("get-followers", {
        body: { userId: await resolveUserIdInt(userId), page: 1, limit: 100 },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Follows] getFollowers Edge Function error:", error);
        return [];
      }
      if (!data?.docs) {
        if (data?.error) console.error("[Follows] get-followers:", data.error);
        return [];
      }
      return data.docs.map((d) => ({
        id: d.id,
        username: d.username,
        avatar: d.avatar,
      }));
    } catch (error) {
      console.error("[Follows] getFollowers error:", error);
      return [];
    }
  },

  /**
   * Get following list (Edge Function — bypasses RLS)
   */
  async getFollowing(userId: string) {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        docs?: { id: string; username: string; avatar: string }[];
        error?: string;
      }>("get-following", {
        body: { userId: await resolveUserIdInt(userId), page: 1, limit: 100 },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Follows] getFollowing Edge Function error:", error);
        return [];
      }
      if (!data?.docs) {
        if (data?.error) console.error("[Follows] get-following:", data.error);
        return [];
      }
      return data.docs.map((d) => ({
        id: d.id,
        username: d.username,
        avatar: d.avatar,
      }));
    } catch (error) {
      console.error("[Follows] getFollowing error:", error);
      return [];
    }
  },
};
