/** Presentation only. An invitation never overrides server admission or media consent. */
export function isOpenCohostInvitation(
  room: { status?: string; ends_at?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (room?.status !== "open") return false;
  if (!room.ends_at) return true;
  const end = Date.parse(room.ends_at);
  return Number.isFinite(end) && end > now;
}

export function cohostRoomRoute(roomId: string, platform: "web" | "native") {
  const prefix = platform === "web" ? "/feed" : "/(protected)";
  // Accepting a role is not camera/microphone consent. Always review prejoin.
  return `${prefix}/sneaky-lynk/room/${encodeURIComponent(roomId)}`;
}

export function cohostActivityRoute(type: string, platform: "web" | "native") {
  if (!["lynk_cohost_invited", "lynk_cohost_accepted", "lynk_cohost_declined"].includes(type)) return null;
  // A push/tap is not acceptance. The durable cards expose the explicit choice.
  return platform === "web" ? "/feed/activity" : "/(protected)/(tabs)/activity";
}

export function cohostInviteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/full|capacity/i.test(message))
    return "This Lynk is full. Your invitation is still pending. Try again when a seat opens; a seat is not reserved.";
  if (/ended|no longer open/i.test(message))
    return "This Lynk has ended. Ask the host for a new invitation.";
  if (/already|answered|resolved/i.test(message))
    return "This invitation has already been answered. Refresh your invitations to see what's current.";
  if (/original host|inviter_unavailable/i.test(message))
    return "The host can no longer offer this co-host role. Ask the current host for a new invitation.";
  if (/not found/i.test(message))
    return "This invitation is no longer available. Refresh your invitations.";
  if (/session|sign in|unauthorized/i.test(message))
    return "Sign in again to respond to this invitation.";
  if (/account changed/i.test(message))
    return "Your account changed. Refresh your invitations before responding.";
  if (/already responding/i.test(message))
    return "Your response is still being saved. Please wait.";
  // Backend access restrictions are not all invite-only. Never expose raw errors.
  if (/cannot join|verification|verified|18|suspend|paused|forbidden/i.test(message))
    return "Your account can't accept this co-host invitation right now. Check your account access and try again.";
  return "We couldn't save your response. Your invitation has not been dismissed. Try again.";
}
