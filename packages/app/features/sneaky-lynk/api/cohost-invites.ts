/**
 * Co-host invitations for Lynk rooms.
 *
 * The host used to promote someone with `videoApi.changeRole`, which flips their
 * role underneath them. That is correct for a demotion and wrong for asking
 * someone to take on a seat: it needs consent, it needs to reach someone who
 * isn't already staring at the room, and it needs to survive the invitee closing
 * the app. So an invite is a durable pending row, and the notification points at
 * it — `changeRole` remains for demote/remove, which are decisions the host owns.
 *
 * Every write goes through the `lynk-cohost-invite` Edge Function: the table
 * grants clients SELECT only, because a client that could write it could make
 * itself a co-host. Reads come straight from Supabase so the notification list
 * can show a pending invite without a round trip through a function.
 */

import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";

export interface LynkCohostInvite {
  id: number;
  roomId: number;
  roomUuid: string | null;
  roomTitle: string | null;
  inviterId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke(
    "lynk-cohost-invite",
    { body, headers: { "x-auth-token": token } },
  );
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error?.message || "Something went wrong");
  return data.data as T;
}

export const lynkCohostInvites = {
  /** Host → "come co-host this". `roomId` may be the uuid or the integer id. */
  invite: (roomId: string | number, targetUserId: string) =>
    call<{ inviteId: number }>({ action: "invite", roomId, targetUserId }),

  /**
   * Accept. Returns the room uuid so the caller can route straight in — the
   * whole point of the flow is that saying yes puts you in the room, already
   * elevated, without a second navigation decision.
   */
  accept: (inviteId: number) =>
    call<{ status: "accepted"; roomId: string; role: "co-host" }>({
      action: "accept",
      inviteId,
    }),

  decline: (inviteId: number) =>
    call<{ status: "declined" }>({ action: "decline", inviteId }),

  /**
   * This user's OPEN invites, newest first. Used by the notification list and
   * the toast; a closed invite is history and belongs to the notifications feed,
   * not here.
   */
  async listPending(userId: string): Promise<LynkCohostInvite[]> {
    if (!userId) return [];
    const { data, error } = await supabase
      .from("lynk_cohost_invites")
      .select("id, room_id, inviter_id, status, created_at, video_rooms(uuid, title, status)")
      .eq("invitee_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[lynkCohostInvites] listPending:", error.message);
      return [];
    }

    return (data ?? [])
      // A room that ended takes its invites with it — showing "join" for a dead
      // room is the dead-end this flow exists to avoid.
      .filter((r: any) => r.video_rooms?.status === "open")
      .map((r: any) => ({
        id: r.id,
        roomId: r.room_id,
        roomUuid: r.video_rooms?.uuid ?? null,
        roomTitle: r.video_rooms?.title ?? null,
        inviterId: r.inviter_id,
        status: r.status,
        createdAt: r.created_at,
      }));
  },
};
