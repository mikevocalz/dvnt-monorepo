import { resetFollowAccessCaches } from "./reset-follow-access-caches";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { followsApi } from "@dvnt/app/lib/api/follows";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function useFollowRequestStatus(targetId?: string) {
  const viewer = useAuthStore(s => s.user?.id);
  const query = useQuery({
    queryKey: ["follow-request-status", viewer, targetId],
    enabled: Boolean(viewer && targetId && viewer !== targetId),
    queryFn: () => followsApi.getFollowRequestStatus(targetId!),
    staleTime: 0,
  });
  return { ...query, following: query.data?.following, data: query.data?.followRequestStatus };
}

export function useFollowRequests() {
  const owner = useAuthStore(s => s.user?.id);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["follow-requests", owner],
    enabled: Boolean(owner),
    queryFn: () => followsApi.getFollowRequests(),
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: async ({ requesterId, action }: { requesterId: string; action: "approve" | "decline" }) => {
      if (!owner || useAuthStore.getState().user?.id !== owner) throw new Error("Account changed. Reload requests.");
      await followsApi.respondToFollowRequest(requesterId, action);
    },
    onSuccess: async () => {
      if (useAuthStore.getState().user?.id !== owner) return;
      await resetFollowAccessCaches(client);
      if (useAuthStore.getState().user?.id !== owner) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["follow-requests", owner] }),
        client.invalidateQueries({ queryKey: ["profile", owner] }),
        client.invalidateQueries({ queryKey: ["users", "followers"] }),
      ]);
    },
  });
  return { query, mutation, owner };
}
