/** Server-side event access. A URL, RSVP, or old room membership is not an invite. */
export interface EventAccessRow {
  id: number;
  host_id: string;
  visibility?: string | null;
  status?: string | null;
  ticketing_enabled?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
}

async function exists(query: any): Promise<boolean> {
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error("Could not verify event access");
  return !!data;
}

export async function eventRelationships(db: any, event: EventAccessRow, userId: string | null) {
  if (!userId) return { organizer: false, ticket: false, invited: false };
  const [organizer, ticket, invited] = await Promise.all([
    userId === event.host_id ? Promise.resolve(true) : exists(db.from("event_co_organizers")
      .select("id").eq("event_id", event.id).eq("user_id", userId).eq("accepted", true)),
    exists(db.from("tickets").select("id").eq("event_id", event.id).eq("user_id", userId)
      .in("status", ["active", "scanned"]).eq("category", "admission")),
    exists(db.from("event_invites").select("id").eq("event_id", event.id)
      .eq("invited_user_id", userId).in("status", ["pending", "accepted"])),
  ]);
  return { organizer, ticket, invited };
}

/** Apply before inventory reservations, zero-cost issuance, or Stripe calls. */
export async function canAccessEvent(db: any, eventId: number, userId: string | null): Promise<boolean> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return false;
  const { data: event, error } = await db.from("events")
    .select("id, host_id, visibility, status").eq("id", eventId).maybeSingle();
  if (error) throw new Error("Could not verify event access");
  if (!event || ["cancelled", "deleted"].includes(event.status)) return false;
  if (event.visibility !== "private") return true;
  const access = await eventRelationships(db, event, userId);
  return access.organizer || access.ticket || access.invited;
}

export type EventRoomAccess =
  | { ok: true; linked: boolean; endsAt: string | null }
  | { ok: false; code: "forbidden" | "conflict"; message: string; detail: Record<string, unknown> };

/** Pure decision function, shared by all token rails through the resolver below. */
export function decideEventRoomAccess(
  event: EventAccessRow | null,
  access: { organizer: boolean; ticket: boolean; invited: boolean },
  room: { created_at?: string | null; ends_at?: string | null },
  now = Date.now(),
): EventRoomAccess {
  const deny = (reason: string, message: string, code: "forbidden" | "conflict" = "forbidden"): EventRoomAccess =>
    ({ ok: false, code, message, detail: { reason } });
  if (!event) return { ok: true, linked: false, endsAt: room.ends_at ?? null };
  if (["cancelled", "deleted"].includes(event.status ?? ""))
    return deny("event_unavailable", "This event is no longer available", "conflict");
  // Even a room invite/old membership cannot replace admission to a paid event.
  if (!access.organizer && (event.ticketing_enabled ? !access.ticket : !access.ticket && !access.invited))
    return deny(event.ticketing_enabled ? "event_ticket_required" : "event_invite_required",
      event.ticketing_enabled ? "An active admission ticket is required for this event" : "This event requires an invitation");
  const start = Date.parse(event.start_date ?? "");
  if (!Number.isFinite(start)) return deny("event_schedule_missing", "The event schedule is not ready", "conflict");
  if (!access.organizer && now < start)
    return { ok: false, code: "conflict", message: "This event has not started yet", detail: { reason: "event_not_started", startsAt: event.start_date } };
  const end = Date.parse(event.end_date ?? "");
  // Free-plan rooms used to expire five minutes after being created, days before
  // a scheduled event. Preserve the plan duration, starting at the event's start.
  const roomEnd = Date.parse(room.ends_at ?? "");
  const roomCreated = Date.parse(room.created_at ?? "");
  const durationEnd = Number.isFinite(roomEnd) && Number.isFinite(roomCreated)
    ? Math.max(start, roomCreated) + Math.max(0, roomEnd - roomCreated) : roomEnd;
  const candidates = [end, durationEnd].filter(Number.isFinite);
  const effectiveEnd = candidates.length ? Math.min(...candidates) : null;
  if (effectiveEnd !== null && now >= effectiveEnd)
    return deny("session_expired", "This event's live session has ended", "conflict");
  return { ok: true, linked: true, endsAt: effectiveEnd === null ? null : new Date(effectiveEnd).toISOString() };
}

export async function resolveEventRoomAccess(db: any, room: any, userId: string): Promise<EventRoomAccess> {
  if (room.room_kind === "call") return { ok: true, linked: false, endsAt: room.ends_at ?? null };
  const { data: events, error } = await db.from("events")
    .select("id, host_id, visibility, status, ticketing_enabled, start_date, end_date")
    .eq("lynk_room_id", room.uuid).limit(2);
  if (error || events?.length > 1) throw new Error("Could not verify the linked event");
  const event = events?.[0] ?? null;
  const access = event ? await eventRelationships(db, event, userId)
    : { organizer: false, ticket: false, invited: false };
  return decideEventRoomAccess(event, access, room);
}
