/**
 * React Query hooks for Lynk co-host invitations.
 *
 * Accepting is NOT optimistic. It is a privileged write — it grants a seat and
 * writes room membership — and the audit-trail rule in the project's product
 * guidance is explicit that those never pretend. Declining is not optimistic
 * either, for a plainer reason: if it fails, the invite must still be there.
 */

import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBridgeRequestEpoch } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
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
function invitationAccountKey(state: { isAuthenticated: boolean; user: { id: string; authId?: string } | null }) {
  return state.isAuthenticated && state.user?.id ? `${state.user.id}:${state.user.authId ?? ""}` : "";
}

export function useMyAuthId() {
  const accountKey = useAuthStore(invitationAccountKey);
  return useQuery({
    queryKey: ["my-auth-id", accountKey],
    queryFn: async () => {
      const epoch = getBridgeRequestEpoch();
      const isCurrent = () => !!accountKey && invitationAccountKey(useAuthStore.getState()) === accountKey && getBridgeRequestEpoch() === epoch;
      // A retry can execute after its original observer's account switched.
      // Its query key still belongs to that rendered account, not the new one.
      if (!isCurrent()) throw new Error("Your account changed");
      const authId = await getCurrentUserAuthId();
      if (!isCurrent()) throw new Error("Your account changed");
      if (!authId) throw new Error("Couldn't verify your invitation account");
      return authId;
    },
    enabled: !!accountKey,
    staleTime: 30_000,
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
  const accountKey = useAuthStore(invitationAccountKey);
  const identity = useMyAuthId();
  const authId = identity.isError ? undefined : identity.data;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: lynkInviteKeys.pending(authId ?? undefined),
    queryFn: () => {
      const isCurrent = () => !!accountKey && invitationAccountKey(useAuthStore.getState()) === accountKey;
      if (!isCurrent()) throw new Error("Your account changed");
      return lynkCohostInvites.listPending(authId!, { isCurrent });
    },
    enabled: !!authId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  return {
    ...query,
    data: identity.isError ? undefined : query.data,
    isError: identity.isError || query.isError,
    error: identity.error ?? query.error,
    isFetching: identity.isFetching || query.isFetching,
    refetch: async () => {
      // An identity-read failure must be retryable; retrying a disabled invite
      // query alone would never recover a cold-cache signed-in account.
      const refreshed = await identity.refetch();
      if (refreshed.data && !refreshed.error) {
        await queryClient.invalidateQueries({ queryKey: lynkInviteKeys.pending(refreshed.data) });
      }
    },
  };
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

// One write per account across the toast and durable card, including rapid taps
// before React has painted a pending state. The server remains authoritative.
const responsesInFlight = new Set<string>();

export function useRespondToCohostInvite(userId: string | undefined) {
  const queryClient = useQueryClient();
  const mutationKey = [...lynkInviteKeys.all, "respond", userId ?? "anon"];
  const pendingCount = useIsMutating({ mutationKey });
  const mutation = useMutation<
    CohostInviteResult,
    Error,
    { inviteId: number; action: "accept" | "decline" }
  >({
    mutationKey,
    mutationFn: async (v) => {
      const epoch = getBridgeRequestEpoch();
      const isCurrent = () => getBridgeRequestEpoch() === epoch;
      if (!userId || await getCurrentUserAuthId() !== userId || !isCurrent()) {
        throw new Error("Your account changed");
      }
      if (responsesInFlight.has(userId)) throw new Error("Already responding");
      responsesInFlight.add(userId);
      try {
        return await (v.action === "accept"
          ? lynkCohostInvites.accept(v.inviteId, { isCurrent })
          : lynkCohostInvites.decline(v.inviteId, { isCurrent }));
      } finally {
        responsesInFlight.delete(userId);
      }
    },
    onSuccess: (_result, variables) => {
      // Remove only after server confirmation, not optimistically.
      queryClient.setQueryData<LynkCohostInvite[]>(lynkInviteKeys.pending(userId),
        (current) => current?.filter((invite) => invite.id !== variables.inviteId));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: lynkInviteKeys.pending(userId) });
    },
  });
  return { ...mutation, isPending: mutation.isPending || pendingCount > 0 };
}

export type { LynkCohostInvite };
