import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getFollowIdentity,
  isFollowIdentityCurrent,
  type FollowIdentity,
} from "@dvnt/app/lib/auth/follow-identity";
import { useFollowRequestStatus } from "@dvnt/app/lib/hooks/use-follow-requests";
import { resetFollowAccessCaches } from "@dvnt/app/lib/hooks/reset-follow-access-caches";

type Status = "none" | "pending" | "approved";
type ObservedStatus = {
  owner: string;
  targetId: string;
  status: Status;
  following: boolean;
};
type AccessRefresh = { version: string; promise: Promise<void> };

// Several posts can show the same author's gate. Refresh their shared caches
// once per confirmed relationship change, not once per visible card.
const refreshes = new WeakMap<
  QueryClient,
  {
    owner: string;
    targets: Map<string, AccessRefresh>;
    recoveredFollows: Set<string>;
  }
>();

function refreshProtectedAccess(
  client: QueryClient,
  identity: FollowIdentity,
  targetId: string,
  status: Status,
  following: boolean,
  updatedAt: number,
  initialFollowingOnly = false,
) {
  if (!isFollowIdentityCurrent(identity)) return Promise.resolve();
  const owner = JSON.stringify(identity);
  let account = refreshes.get(client);
  if (!account || account.owner !== owner) {
    account = { owner, targets: new Map(), recoveredFollows: new Set() };
    refreshes.set(client, account);
  }
  // A still-protected post remounts its gate after this refetch. Do not loop
  // on the same relationship, even if the status query is recreated on remount.
  if (initialFollowingOnly && account.recoveredFollows.has(targetId))
    return Promise.resolve();
  if (following) account.recoveredFollows.add(targetId);
  else account.recoveredFollows.delete(targetId);
  const version = `${updatedAt}:${status}:${following}`;
  const previous = account.targets.get(targetId);
  if (previous?.version === version) return previous.promise;

  const promise = resetFollowAccessCaches(client, true, () =>
    isFollowIdentityCurrent(identity),
  );
  account.targets.set(targetId, { version, promise });
  return promise;
}

export function useFollowStatusRefresh(
  targetId?: string,
  recoverLockedPost = false,
) {
  const status = useFollowRequestStatus(targetId);
  const following = status.following === true;
  const client = useQueryClient();
  const identity = getFollowIdentity();
  const owner = identity ? JSON.stringify(identity) : "";
  const previous = useRef<ObservedStatus | undefined>(undefined);

  // Refresh after successful focus/background reads too. Newly confirmed
  // follows must not leave mounted posts stuck behind stale gates.
  useEffect(() => {
    const observedIdentity = getFollowIdentity();
    if (
      !targetId ||
      !observedIdentity ||
      JSON.stringify(observedIdentity) !== owner
    ) {
      previous.current = undefined;
      return;
    }
    if (
      previous.current?.owner !== owner ||
      previous.current?.targetId !== targetId
    ) {
      previous.current = undefined;
    }
    if (
      !status.isSuccess ||
      status.isFetching ||
      status.isPaused ||
      !status.data
    )
      return;
    if (!following) {
      const account = refreshes.get(client);
      if (account?.owner === owner) account.recoveredFollows.delete(targetId);
    }
    const before = previous.current;
    previous.current = { owner, targetId, status: status.data, following };
    const changed =
      !!before &&
      (before.status !== status.data || before.following !== following);
    const recoverInitialFollowing = recoverLockedPost && following;
    if (changed || recoverInitialFollowing) {
      void refreshProtectedAccess(
        client,
        observedIdentity,
        targetId,
        status.data,
        following,
        status.dataUpdatedAt,
        !changed,
      ).catch(() => {
        // Post queries display their own read failures and never reuse old media.
      });
    }
  }, [
    client,
    owner,
    targetId,
    recoverLockedPost,
    following,
    status.data,
    status.dataUpdatedAt,
    status.isSuccess,
    status.isFetching,
    status.isPaused,
  ]);

  const refresh = async () => {
    if (!targetId || !isFollowIdentityCurrent(identity)) return;
    const before = { status: status.data, following };
    const result = await status.refetch();
    if (!isFollowIdentityCurrent(identity) || !result.isSuccess || !result.data)
      return;
    if (
      before.status !== result.data.followRequestStatus ||
      before.following !== result.data.following
    ) {
      await refreshProtectedAccess(
        client,
        identity,
        targetId,
        result.data.followRequestStatus,
        result.data.following,
        result.dataUpdatedAt,
      ).catch(() => {
        // The protected post queries own their error and retry UI.
      });
    }
  };

  return { ...status, refresh };
}
