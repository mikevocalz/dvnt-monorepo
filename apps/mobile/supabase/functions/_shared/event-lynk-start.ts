/**
 * Start an event's Sneaky Lynk: move event_lynk_lifecycle to 'live'.
 *
 * One implementation for every way a host starts the room: the Start button
 * (event-lynk-room "start") and a host joining their own room (event-lynk-room
 * "wait" and video_join_room), the way a Zoom meeting starts when the host
 * joins. Idempotent: a room that is already live answers started: false.
 *
 * The caller decides who is a host (_shared/event-lynk-host.ts). Read and
 * write failures throw; callers turn that into a 500 or, after a join that
 * already succeeded, into a log line.
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
  | { ok: false; reason: "event_unavailable" | "event_ended" | "room_ended"; message: string; state?: string };

const ASSUMED_EVENT_LENGTH_MS = 6 * 60 * 60 * 1000;

export function eventLynkEnd(event: EventLynkStartEvent): number {
  const start = Date.parse(event.start_date ?? "");
  const end = Date.parse(event.end_date ?? "");
  return Number.isFinite(end) ? end : start + ASSUMED_EVENT_LENGTH_MS;
}

export async function startEventLynk(
  db: any,
  event: EventLynkStartEvent,
  actor: string,
): Promise<EventLynkStartResult> {
  if (["cancelled", "deleted"].includes(String(event.status)))
    return { ok: false, reason: "event_unavailable", message: "This event was cancelled" };
  if (Date.now() >= eventLynkEnd(event))
    return { ok: false, reason: "event_ended", message: "This event has ended" };

  const { data: room, error: roomError } = await db.from("video_rooms").select("status")
    .eq("uuid", event.lynk_room_id).maybeSingle();
  if (roomError) throw new Error("Could not read the Lynk room");
  if (!room || room.status !== "open")
    return { ok: false, reason: "room_ended", message: "This Lynk has ended" };

  const { data: synced, error: syncError } = await db.rpc("sync_event_lynk_lifecycle", { p_event_id: event.id });
  if (syncError || (synced && synced.ok === false)) throw new Error("Could not sync the Lynk lifecycle");

  const now = new Date().toISOString();
  const { data: flipped, error: flipError } = await db.from("event_lynk_lifecycle")
    .update({ state: "live", live_at: now, started_by: actor, updated_at: now })
    .eq("event_id", event.id).in("state", ["scheduled", "ready"])
    .select("state").maybeSingle();
  if (flipError) throw new Error("Could not start the Lynk");
  const started = !!flipped;
  if (!started) {
    const { data: current, error: readError } = await db.from("event_lynk_lifecycle").select("state")
      .eq("event_id", event.id).maybeSingle();
    if (readError) throw new Error("Could not read the Lynk lifecycle");
    const state = current?.state || "scheduled";
    if (state !== "live") return { ok: false, reason: "room_ended", message: "This Lynk has ended", state };
  }

  // Bookkeeping only: waiting guests learn the room is live from their next
  // "wait" heartbeat and then join through video_join_room, which still runs
  // the ban, capacity and verified-admission gates.
  const { data: admittedRows, error: admitError } = await db.from("event_lynk_waiting")
    .update({ admitted_at: now }).eq("event_id", event.id).is("admitted_at", null)
    .select("user_id");
  if (admitError) console.error("[event-lynk-start] marking waiters admitted failed:", admitError.message);
  return { ok: true, started, admitted: admitError ? 0 : (admittedRows || []).length };
}
