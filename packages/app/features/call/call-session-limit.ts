/**
 * Personal-call session limit helpers.
 *
 * The server owns the deadline in video_rooms.ends_at. Clients never invent a
 * five-minute window from mount time; they only display and react to the
 * server-provided timestamp so web/native/group participants share one clock.
 */

export const CALL_SESSION_WARNING_SECONDS = 30;

export function callSessionSecondsRemaining(
  endsAt: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!endsAt) return null;
  const deadlineMs = Date.parse(endsAt);
  if (!Number.isFinite(deadlineMs)) return null;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
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
