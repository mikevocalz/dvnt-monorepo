import { useRef } from "react";
import {
  getFollowIdentity,
  isFollowIdentityCurrent,
  type FollowIdentity,
} from "@dvnt/app/lib/auth/follow-identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { useFollowRequestStatus } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useVerificationState } from "@dvnt/app/lib/hooks/use-age-verification";
import { useVerifiedAdmission } from "@dvnt/app/lib/hooks/use-verified-admission";

export function useSpicyFollowGate(author?: {
  id?: string;
  username?: string;
}) {
  const inFlight = useRef<{
    identity: FollowIdentity;
    targetId: string;
  } | null>(null);
  const identity = getFollowIdentity();
  const viewer = useAuthStore((s) => s.user);
  const status = useFollowRequestStatus(author?.id);
  const verification = useVerificationState();
  const admission = useVerifiedAdmission();
  const follow = useFollow();
  // Following does not grant content access. Do not apply publishing-only ID
  // requirements here; protected media is still authorized by the server.
  const eligible =
    !!identity &&
    !!verification.data &&
    !verification.isError &&
    !verification.isLoading &&
    verification.data.state !== "rejected" &&
    verification.data.reason !== "underage" &&
    !admission.isError &&
    !admission.isLoading &&
    (admission.data?.state === "allowed" || admission.data?.state === "grace");
  const pending = status.data === "pending";
  const isFollowing = status.following === true;
  const disabled =
    !eligible ||
    !author?.id ||
    status.isLoading ||
    status.isError ||
    !status.data ||
    follow.isPending;
  return {
    label: pending
      ? "Cancel follow request"
      : isFollowing
        ? "Unfollow"
        : "Request to FOLLOW",
    note: !viewer
      ? "Sign in to follow this member."
      : verification.isError || admission.isError
        ? "Account access is unavailable right now."
        : !verification.data || !admission.data
          ? "Checking account access…"
          : !eligible
            ? "This action isn’t available for your account."
            : status.isError
              ? "Could not check follow status. Try again."
              : pending
                ? "Request pending approval. This post stays protected."
                : isFollowing
                  ? "You’re following this member. This post is still protected by its access settings."
                  : "Spicy posts require following. Private pages require approval.",
    disabled,
    failed: follow.isError,
    retry: () => status.refetch(),
    statusError: status.isError,
    act: () => {
      if (disabled || !author?.id || !isFollowIdentityCurrent(identity)) return;
      const active = inFlight.current;
      if (
        active?.targetId === author.id &&
        isFollowIdentityCurrent(active.identity)
      )
        return;
      const operation = { identity, targetId: author.id };
      inFlight.current = operation;
      follow.mutate(
        {
          userId: author.id,
          username: author.username,
          action: pending || isFollowing ? "unfollow" : "follow",
        },
        {
          onSettled: () => {
            if (inFlight.current === operation) inFlight.current = null;
          },
        },
      );
    },
  };
}
