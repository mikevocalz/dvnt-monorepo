import { useRef } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { useFollowRequestStatus } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useVerificationState } from "@dvnt/app/lib/hooks/use-age-verification";
import { useVerifiedAdmission } from "@dvnt/app/lib/hooks/use-verified-admission";

export function useSpicyFollowGate(author?: {
  id?: string;
  username?: string;
}) {
  const inFlight = useRef(false);
  const viewer = useAuthStore((s) => s.user);
  const status = useFollowRequestStatus(author?.id);
  const verification = useVerificationState();
  const admission = useVerifiedAdmission();
  const follow = useFollow();
  const eligible =
    !!viewer?.authId &&
    verification.data?.state === "approved" &&
    !verification.isError &&
    !admission.isError &&
    !!admission.data &&
    admission.data.state !== "blocked";
  const pending = status.data === "pending";
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
      : status.data === "approved"
        ? "Unfollow"
        : "Request to FOLLOW",
    note: !viewer
      ? "Sign in and verify your age to continue."
      : !eligible
        ? "Verified adult access is required."
        : status.isError
          ? "Could not check follow status. Try again."
          : pending
            ? "Request pending approval. This post stays protected."
            : status.data === "approved"
              ? "Access is being checked. This post stays protected until the server permits it."
              : "Spicy posts require following. Private pages require approval.",
    disabled,
    failed: follow.isError,
    retry: () => status.refetch(),
    statusError: status.isError,
    act: () => {
      if (
        disabled ||
        !author?.id ||
        inFlight.current ||
        useAuthStore.getState().user?.authId !== viewer?.authId
      )
        return;
      inFlight.current = true;
      follow.mutate(
        {
          userId: author.id,
          username: author.username,
          action: pending || status.data === "approved" ? "unfollow" : "follow",
        },
        {
          onSettled: () => {
            inFlight.current = false;
          },
        },
      );
    },
  };
}
