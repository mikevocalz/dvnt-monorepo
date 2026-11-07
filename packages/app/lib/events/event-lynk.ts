/**
 * Client half of the event Sneaky Lynk waiting room.
 *
 * The server owns every decision (apps/mobile/supabase/functions/event-lynk-room):
 * who is a host, whether the room is live, who may wait. These helpers only
 * decide what to SHOW.
 */
import type { EventRole } from "./event-role";

/**
 * How often a guest in the waiting room heartbeats "wait", and how often a
 * host's waiting list refreshes. Mirrors WAIT_HEARTBEAT_MS in
 * event-lynk-room/index.ts; event-lynk.test.ts fails if the two drift.
 */
export const EVENT_LYNK_WAIT_POLL_MS = 5_000;

/**
 * Owner, or an accepted admin/editor co-organizer: the server's rule in
 * _shared/event-lynk-host.ts. useEventRole only returns accepted roles, so a
 * pending invite is already null here.
 */
export function canHostEventLynk(role: EventRole): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

/** Activity copy for a room_invite row. Follows the event_invite phrasing. */
export function roomInviteActivityText(eventTitle?: string | null): string {
  const title = typeof eventTitle === "string" ? eventTitle.trim() : "";
  return title
    ? ` invited you to ${title}'s Sneaky Lynk.`
    : " invited you to a Sneaky Lynk.";
}

/** "Waiting 3 min" for the host's list. Under a minute reads "Just arrived". */
export function waitingSinceLabel(joinedAt: string, now = Date.now()): string {
  const ms = now - Date.parse(joinedAt);
  if (!Number.isFinite(ms) || ms < 60_000) return "Just arrived";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `Waiting ${min} min`;
  return `Waiting ${Math.floor(min / 60)} h`;
}

/** Terminal waiting-room refusals stop polling. Network/server/rate-limit
 * failures remain retryable; old untyped responses retain a narrow fallback. */
export function isEventLynkWaitRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, reason, message } = error as { status?: number; reason?: string; message?: string };
  if (typeof status === "number") {
    return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
  }
  if (reason) return ["not_found", "room_ended", "event_unavailable", "event_ticket_required",
    "event_invite_required", "event_schedule_missing", "session_expired"].includes(reason);
  return typeof message === "string" &&
    /ticket|invitation|cancel|ended|not found|no longer available|unauthorized|not authenticated|session expired/i.test(message);
}
