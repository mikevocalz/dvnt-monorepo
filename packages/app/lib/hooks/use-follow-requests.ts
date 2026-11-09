import { useSyncExternalStore } from "react";
import { resetFollowAccessCaches } from "./reset-follow-access-caches";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { followsApi } from "@dvnt/app/lib/api/follows";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { assertFollowIdentity, getFollowIdentity, getFollowIdentityRevision, subscribeFollowIdentityRevision, isFollowIdentityCurrent, type FollowIdentity } from "@dvnt/app/lib/auth/follow-identity";

export function useFollowRequestStatus(targetId?: string) {
  const viewer = useAuthStore(s => s.user?.id);
  const session = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle);
  const revision = useSyncExternalStore(subscribeFollowIdentityRevision, getFollowIdentityRevision, getFollowIdentityRevision);
  const identity = getFollowIdentity();
  const query = useQuery({
    queryKey: ["follow-request-status", viewer, targetId, session.epoch, revision],
    enabled: Boolean(identity && targetId && viewer !== targetId),
    queryFn: () => {
      assertFollowIdentity(identity);
      return followsApi.getFollowRequestStatus(targetId!, identity);
    },
    staleTime: 0,
  });
  return { ...query, following: query.data?.following, data: query.data?.followRequestStatus };
}

type RequestVariables = { requesterId: string; action: "approve" | "decline" };
type OwnedRequestVariables = RequestVariables & { identity: FollowIdentity | null };

export function useFollowRequests() {
  const owner = useAuthStore(s => s.user?.id);
  const session = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle);
  const revision = useSyncExternalStore(subscribeFollowIdentityRevision, getFollowIdentityRevision, getFollowIdentityRevision);
  const identity = getFollowIdentity();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["follow-requests", owner, session.epoch, revision],
    enabled: Boolean(identity),
    queryFn: () => {
      assertFollowIdentity(identity);
      return followsApi.getFollowRequests(identity);
    },
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: async (variables: OwnedRequestVariables) => {
      assertFollowIdentity(variables.identity);
      await followsApi.respondToFollowRequest(variables.requesterId, variables.action, variables.identity);
      assertFollowIdentity(variables.identity);
    },
    onSuccess: async (_data, variables) => {
      const isCurrent = () => isFollowIdentityCurrent(variables.identity);
      if (!isCurrent()) return;
      await resetFollowAccessCaches(client, true, isCurrent);
      if (!isCurrent()) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["follow-requests", owner, variables.identity!.epoch, variables.identity!.revision] }),
        client.invalidateQueries({ queryKey: ["profile", owner] }),
        client.invalidateQueries({ queryKey: ["users", "followers"] }),
      ]);
    },
  });
  type Options = NonNullable<Parameters<typeof mutation.mutate>[1]>;
  const ownedOptions = (options?: Options): Options => ({
    ...options,
    onSuccess: (...args) => { if (isFollowIdentityCurrent(identity)) options?.onSuccess?.(...args); },
    onError: (...args) => { if (isFollowIdentityCurrent(identity)) options?.onError?.(...args); },
    onSettled: (...args) => { if (isFollowIdentityCurrent(identity)) options?.onSettled?.(...args); },
  });
  const stale = mutation.variables && !isFollowIdentityCurrent(mutation.variables.identity);
  return {
    query, owner,
    mutation: {
      ...mutation,
      ...(stale ? { error: null, data: undefined, variables: undefined, isError: false, isPending: false, isSuccess: false, isIdle: true, status: "idle" as const } : {}),
      mutate: (variables: RequestVariables, options?: Options) => mutation.mutate({ ...variables, identity }, ownedOptions(options)),
      mutateAsync: (variables: RequestVariables, options?: Options) => mutation.mutateAsync({ ...variables, identity }, ownedOptions(options)),
    },
  };
}
