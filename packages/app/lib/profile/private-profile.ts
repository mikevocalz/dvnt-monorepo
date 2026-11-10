/** Presentation only: the server remains authoritative for post access. */
export function privateProfilePresentation(input: {
  isPrivate?: boolean;
  isOwnProfile?: boolean;
  following?: boolean;
  requestPending?: boolean;
  mutationPending?: boolean;
  mutationAction?: "follow" | "unfollow";
  followsYou?: boolean;
}) {
  const locked = input.isPrivate === true && !input.isOwnProfile && input.following !== true;
  const buttonLabel = input.mutationPending
    ? input.mutationAction === "follow"
      ? locked ? "Requesting…" : "Following…"
      : input.requestPending ? "Cancelling…" : "Unfollowing…"
    : input.following ? "Following"
      : input.requestPending ? "Requested · Cancel"
        : input.followsYou ? "Follow Back" : "Follow";
  return {
    locked,
    buttonLabel,
    title: "This account is private",
    message: input.requestPending
      ? "Your follow request is pending. You'll be able to see their posts when they approve you."
      : "Follow this account to request access to their posts.",
  };
}
