/**
 * React Query hooks for Lynk co-host invitations.
 *
 * Accepting is NOT optimistic. It is a privileged write — it grants a seat and
 * writes room membership — and the audit-trail rule in the project's product
 * guidance is explicit that those never pretend. Declining is not optimistic
 * either, for a plainer reason: if it fails, the invite must still be there.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import {
  lynkCohostInvites,
  type LynkCohostInvite,
} from "@dvnt/app/features/sneaky-lynk/api/cohost-invites";

/**
 * OUR Better-Auth id — the value `lynk_cohost_invites.invitee_id` holds, because
 * room membership is keyed by it (`video_room_members.user_id` is TEXT).
 *
 * The auth store's `user.id` is NOT that value; passing it here matched nothing
 * and the invite silently never appeared. Exactly the mismatch that made the
 * Lynk room render a second tile of the host — worth its own hook so the next
 * caller cannot repeat it.
 */
export function useMyAuthId() {
  return useQuery({
    queryKey: ["my-auth-id"],
    queryFn: () => getCurrentUserAuthId(),
    staleTime: Infinity,
  });
}

export const lynkInviteKeys = {
  all: ["lynk-cohost-invites"] as const,
  pending: (userId: string | undefined) =>
    [...lynkInviteKeys.all, "pending", userId ?? "anon"] as const,
};

/** Open invites for this user. Polls, because a room is time-bounded and an
 *  invite that arrives while you are on the notifications screen is the case
 *  this feature exists for. */
export function usePendingCohostInvites(_ignored?: string | undefined) {
  const { data: authId } = useMyAuthId();
  return useQuery({
    queryKey: lynkInviteKeys.pending(authId ?? undefined),
    queryFn: () => lynkCohostInvites.listPending(authId!),
    enabled: !!authId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useInviteCohost() {
  return useMutation({
    mutationFn: (v: { roomId: string | number; targetUserId: string }) =>
      lynkCohostInvites.invite(v.roomId, v.targetUserId),
  });
}

/** Accept resolves with the room to route into; decline resolves with nothing
 *  to route to. One union so a single mutation covers both answers. */
export type CohostInviteResult =
  | { status: "accepted"; roomId: string; role: "co-host" }
  | { status: "declined" };

export function useRespondToCohostInvite(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<
    CohostInviteResult,
    Error,
    { inviteId: number; action: "accept" | "decline" }
  >({
    mutationFn: (v) =>
      v.action === "accept"
        ? lynkCohostInvites.accept(v.inviteId)
        : lynkCohostInvites.decline(v.inviteId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: lynkInviteKeys.pending(userId) });
    },
  });
}

export type { LynkCohostInvite };
