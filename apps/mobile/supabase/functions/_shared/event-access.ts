/** Server-side event access. A URL, RSVP, or old room membership is not an invite. */
export interface EventAccessRow {
  id: number;
  host_id: string;
  visibility?: string | null;
  status?: string | null;
  ticketing_enabled?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
  is_hidden?: boolean | null;
  publish_at?: string | null;
}

/**
 * Hidden by the organizer, or publish_at not reached yet. Same rule as
 * can_view_event (20261003110000_event_hide_and_publish_at); an unparseable
 * publish_at counts as unpublished.
 */
export function isUnpublished(event: Pick<EventAccessRow, "is_hidden" | "publish_at">, now = Date.now()): boolean {
  if (event.is_hidden === true) return true;
  if (event.publish_at == null || event.publish_at === "") return false;
  const at = Date.parse(event.publish_at);
  return !Number.isFinite(at) || at > now;
}

async function exists(query: any): Promise<boolean> {
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error("Could not verify event access");
  return !!data;
}

export async function eventRelationships(db: any, event: EventAccessRow, userId: string | null) {
  if (!userId) return { organizer: false, ticket: false, invited: false };
  const [organizer, ticket, guestInvite, staffInvite] = await Promise.all([
    userId === event.host_id ? Promise.resolve(true) : exists(db.from("event_co_organizers")
      .select("id").eq("event_id", event.id).eq("user_id", userId).eq("accepted", true)),
    exists(db.from("tickets").select("id").eq("event_id", event.id).eq("user_id", userId)
      .in("status", ["active", "scanned"]).eq("category", "admission")),
    exists(db.from("event_invites").select("id").eq("event_id", event.id)
      .eq("invited_user_id", userId).in("status", ["pending", "accepted"])),
    // A staff invite the host has sent but the invitee has not accepted yet is
    // still an invitation. event_co_organizers has no INSERT policy, so the row
    // can only come from the host's invite-co-organizer call — nobody can
    // self-invite. It lands in `invited`, never in `organizer`: being invited
    // must open the event, not hand over host privileges before accepting.
    exists(db.from("event_co_organizers").select("id")
      .eq("event_id", event.id).eq("user_id", userId)),
  ]);
  return { organizer, ticket, invited: guestInvite || staffInvite };
}

/** Apply before inventory reservations, zero-cost issuance, or Stripe calls. */
export async function canAccessEvent(db: any, eventId: number, userId: string | null): Promise<boolean> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return false;
  const { data: event, error } = await db.from("events")
    .select("id, host_id, visibility, status, is_hidden, publish_at").eq("id", eventId).maybeSingle();
  if (error) throw new Error("Could not verify event access");
  if (!event || ["cancelled", "deleted"].includes(event.status)) return false;
  // A hidden or not-yet-published event admits the same people a private one
  // does: host, co-organizers, invitees and admission ticket holders.
  if (event.visibility !== "private" && !isUnpublished(event)) return true;
  const access = await eventRelationships(db, event, userId);
  return access.organizer || access.ticket || access.invited;
}

/** Assumed run-time when events.end_date is NULL — same convention as
 *  COALESCE(end_date, start_date + interval '6 hours') in the RPCs and
 *  _shared/sales-cutoff.ts. */
const ASSUMED_EVENT_LENGTH_MS = 6 * 60 * 60 * 1000;

export type EventRoomAccess =
  | { ok: true; linked: boolean; endsAt: string | null; event?: EventAccessRow & { lynk_room_id?: string | null } }
  | { ok: false; code: "forbidden" | "conflict"; message: string; detail: Record<string, unknown> };

/** Pure decision function, shared by all token rails through the resolver below. */
export function decideEventRoomAccess(
  event: EventAccessRow | null,
  access: { organizer: boolean; ticket: boolean; invited: boolean },
  room: { created_at?: string | null; ends_at?: string | null },
  now = Date.now(),
  /** event_lynk_lifecycle.state === 'live': a host pressed Start. */
  started = false,
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
  // The room opens when a host starts it, not when the clock reaches
  // start_date. Until then an eligible guest waits (event-lynk-room "wait").
  if (!access.organizer && !started)
    return { ok: false, code: "conflict", message: "Waiting for the host to start", detail: { reason: "waiting_for_host", startsAt: event.start_date } };
  const end = Date.parse(event.end_date ?? "");
  // Free-plan rooms used to expire five minutes after being created, days before
  // a scheduled event. Preserve the plan duration, starting at the event's start.
  const roomEnd = Date.parse(room.ends_at ?? "");
  const roomCreated = Date.parse(room.created_at ?? "");
  const durationEnd = Number.isFinite(roomEnd) && Number.isFinite(roomCreated)
    ? Math.max(start, roomCreated) + Math.max(0, roomEnd - roomCreated) : roomEnd;
  let effectiveEnd: number | null;
  if (Number.isFinite(end)) {
    const candidates = [end, durationEnd].filter(Number.isFinite);
    effectiveEnd = Math.min(...candidates);
  } else {
    // end_date NULL → the event is assumed to run start+6h. That bound is a
    // floor, not a cap: the plan-shifted window (start+5min for a free room
    // created before doors) must not report the session as ended while the
    // event is still running. A longer plan window still wins.
    effectiveEnd = Math.max(
      start + ASSUMED_EVENT_LENGTH_MS,
      ...[durationEnd].filter(Number.isFinite),
    );
  }
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
  let started = false;
  if (event && !access.organizer) {
    // Fail closed: an unreadable lifecycle row must not let a guest in early.
    const { data: lifecycle, error: lifecycleError } = await db.from("event_lynk_lifecycle")
      .select("state").eq("event_id", event.id).maybeSingle();
    if (lifecycleError) throw new Error("Could not verify the event room state");
    started = lifecycle?.state === "live";
  }
  const decision = decideEventRoomAccess(event, access, room, Date.now(), started);
  // video_join_room needs the row to start the room when a host joins.
  return decision.ok && event ? { ...decision, event: { ...event, lynk_room_id: room.uuid } } : decision;
}
