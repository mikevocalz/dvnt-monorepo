/**
 * Start an event's Sneaky Lynk: move event_lynk_lifecycle to 'live'.
 *
 * One implementation for every way a host starts the room: the Start button
 * (event-lynk-room "start") and a host joining their own room (event-lynk-room
 * "wait" and video_join_room), the way a Zoom meeting starts when the host
 * joins. Idempotent: a room that is already live answers started: false.
 *
 * The caller checks verified admission, creator standing and host authority.
 * The atomic RPC rechecks host authority and holds event/room locks through
 * lifecycle synchronization and start. Read/write failures throw; callers turn
 * that into a 500 or, after a join that already succeeded, into a log line.
 */

export interface EventLynkStartEvent {
  id: number;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  lynk_room_id?: string | null;
}

export type EventLynkStartResult =
  | { ok: true; started: boolean; admitted: number }
  | { ok: false; reason: "event_unavailable" | "event_ended" | "room_ended" | "event_schedule_missing" | "session_expired" | "event_link_ambiguous" | "event_link_changed" | "not_host"; message: string; state?: string };

export async function startEventLynk(
  db: any,
  event: EventLynkStartEvent,
  actor: string,
): Promise<EventLynkStartResult> {
  // No read/HTTP-write gap: all eligibility and lifecycle mutations happen
  // under database locks. Never fall back to the old non-atomic start when a
  // rollout has not installed the RPC yet.
  const { data, error } = await db.rpc("start_event_lynk_atomic", {
    p_event_id: event.id, p_actor: actor, p_room_uuid: event.lynk_room_id ?? null,
  });
  if (error || !data || typeof data.ok !== "boolean")
    throw new Error("Could not start the Lynk");
  if (data.ok) {
    if (typeof data.started !== "boolean" || !Number.isInteger(data.admitted) || data.admitted < 0)
      throw new Error("Could not confirm the Lynk start");
    return { ok: true, started: data.started, admitted: data.admitted };
  }
  const reasons = ["event_unavailable", "event_ended", "room_ended", "event_schedule_missing",
    "session_expired", "event_link_ambiguous", "event_link_changed", "not_host"];
  if (!reasons.includes(data.reason) || typeof data.message !== "string")
    throw new Error("Could not verify the Lynk start");
  return { ok: false, reason: data.reason, message: data.message,
    ...(typeof data.state === "string" ? { state: data.state } : {}) };
}
