/** UI capabilities mirror existing video_* edge authorization; never grant it. */
export function isRoomModerator(role: string | null | undefined): boolean {
  return role === "host" || role === "co-host" || role === "moderator";
}

export function participantModeration(
  actorRole: string | null | undefined,
  actorId: string | null | undefined,
  targetId: string,
  targetRole: string,
) {
  const canTarget =
    !!actorId &&
    actorId !== targetId &&
    targetRole !== "host" &&
    isRoomModerator(actorRole);
  return {
    mute: canTarget,
    changeRole: canTarget && actorRole === "host",
    remove:
      canTarget && !(actorRole === "moderator" && targetRole === "moderator"),
  };
}
