/** Presentation only. An invitation never overrides server admission or media consent. */
export interface CohostEventWindow {
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
}
export function isOpenCohostInvitation(
  room: { status?: string; created_at?: string | null; ends_at?: string | null } | null | undefined,
  now = Date.now(),
  event?: CohostEventWindow,
): boolean {
  if (room?.status !== "open") return false;
  const end = Date.parse(room.ends_at ?? "");
  if (room.ends_at && !Number.isFinite(end)) return false;
  if (!event) return !room.ends_at || end > now;
  if (["cancelled", "deleted"].includes(event.status ?? "")) return false;
  const start = Date.parse(event.start_date ?? "");
  if (!Number.isFinite(start)) return false;
  const created = Date.parse(room.created_at ?? "");
  // Match event-access.ts and atomic admission: a room prepared days ahead
  // keeps its hosting-plan duration, measured from the event schedule.
  const durationEnd = Number.isFinite(end) && Number.isFinite(created)
    ? Math.max(start, created) + Math.max(0, end - created) : end;
  const eventEnd = Date.parse(event.end_date ?? "");
  const effectiveEnd = Number.isFinite(eventEnd)
    ? Math.min(eventEnd, ...[durationEnd].filter(Number.isFinite))
    : Math.max(start + 6 * 60 * 60 * 1000, ...[durationEnd].filter(Number.isFinite));
  return effectiveEnd > now;
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
  if (/waiting.*host|host.*start/i.test(message))
    return "The event host hasn't started this Lynk yet. Your invitation is still pending. Try again after it starts.";
  if (/admission ticket|event ticket/i.test(message))
    return "You need an active admission ticket for this event before accepting its co-host invitation.";
  if (/event requires an invitation/i.test(message))
    return "Ask the event host to invite your account to the event before accepting its co-host invitation.";
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
