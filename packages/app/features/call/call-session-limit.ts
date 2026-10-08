/**
 * Personal-call session limit helpers.
 *
 * The server owns the deadline in video_rooms.ends_at. Clients never invent a
 * five-minute window from mount time; they only display and react to the
 * server-provided timestamp so web/native/group participants share one clock.
 */

export const CALL_SESSION_WARNING_SECONDS = 30;

/**
 * Server clock minus device clock, in ms, from a response's serverNow.
 * requestStartedMs/responseReceivedMs are the device times around the call;
 * the server stamped serverNow somewhere in between, so the midpoint is the
 * best local estimate of that instant. Returns 0 when serverNow is missing
 * or unparseable (older edge deployments), which means "trust the device".
 */
export function serverClockOffsetMs(
  serverNow: string | null | undefined,
  requestStartedMs: number,
  responseReceivedMs: number = requestStartedMs,
): number {
  if (!serverNow) return 0;
  const serverMs = Date.parse(serverNow);
  if (!Number.isFinite(serverMs)) return 0;
  return Math.round(serverMs - (requestStartedMs + responseReceivedMs) / 2);
}

/**
 * Seconds left until the server deadline. clockOffsetMs (from
 * serverClockOffsetMs) maps the device clock onto the server clock, so a
 * phone running five minutes fast still sees the full window.
 */
export function callSessionSecondsRemaining(
  endsAt: string | null | undefined,
  nowMs = Date.now(),
  clockOffsetMs = 0,
): number | null {
  if (!endsAt) return null;
  const deadlineMs = Date.parse(endsAt);
  if (!Number.isFinite(deadlineMs)) return null;
  const serverNowMs = nowMs + (Number.isFinite(clockOffsetMs) ? clockOffsetMs : 0);
  return Math.max(0, Math.ceil((deadlineMs - serverNowMs) / 1000));
}

/** One read of video_rooms.ends_at for the call's room (uuid). */
export type CallDeadlineRead = () => PromiseLike<{
  data: { ends_at: string | null } | null;
  error: { message: string } | null;
}>;

/**
 * Re-reads video_rooms.ends_at. The host joins while ends_at is still NULL
 * (the deadline starts when the first invitee connects), and a single missed
 * realtime UPDATE would leave the host without a countdown. Call this each
 * time the room channel reaches SUBSCRIBED, which covers the first subscribe
 * and every reconnect. Returns undefined when the read fails.
 */
export async function fetchCallDeadline(
  read: CallDeadlineRead,
): Promise<string | null | undefined> {
  try {
    const { data, error } = await read();
    if (error || !data) return undefined;
    return data.ends_at ?? null;
  } catch {
    return undefined;
  }
}

export function shouldShowCallSessionWarning(
  secondsRemaining: number | null,
): boolean {
  return (
    secondsRemaining !== null &&
    secondsRemaining > 0 &&
    secondsRemaining <= CALL_SESSION_WARNING_SECONDS
  );
}

export function formatCallSessionCountdown(secondsRemaining: number): string {
  const safeSeconds = Math.max(0, Math.ceil(secondsRemaining));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
