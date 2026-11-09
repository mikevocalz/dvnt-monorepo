import { eventRoomDeadline, type EventAccessRow } from "./event-access.ts";

export const HEARTBEAT_FRESHNESS_MS = 90 * 1000;
export type LynkAvailability = "live" | "inactive" | "scheduled" | "ended" | "unknown";
export interface ListMember {
  id: number;
  room_id: number;
  user_id: string;
  role?: string | null;
  status?: string | null;
  last_seen_at?: string | null;
  left_at?: string | null;
}
export interface RoomPresence {
  activeCount: number;
  historicalCount: number;
  hostExpiresAt: number | null;
}

/** Membership IDs are the table's monotonic serial PK. An older active row must
 * never overrule a newer leave, ban, demotion or rejoin for the same user. */
export function buildRoomPresence(members: ListMember[], now: number): Map<number, RoomPresence> {
  const newest = new Map<number, Map<string, ListMember>>();
  for (const member of members) {
    if (!Number.isSafeInteger(member.id) || member.id <= 0) throw new Error("Invalid membership identifier");
    if (!member.user_id) continue;
    let users = newest.get(member.room_id);
    if (!users) newest.set(member.room_id, users = new Map());
    const previous = users.get(member.user_id);
    if (!previous || member.id > previous.id) users.set(member.user_id, member);
  }
  const result = new Map<number, RoomPresence>();
  for (const [roomId, users] of newest) {
    const presence: RoomPresence = { activeCount: 0, historicalCount: users.size, hostExpiresAt: null };
    for (const member of users.values()) {
      const seen = Date.parse(member.last_seen_at ?? "");
      // Neither joined_at nor stored participant_count establishes presence.
      if (member.status !== "active" || member.left_at != null || !Number.isFinite(seen) ||
          seen > now || now - seen >= HEARTBEAT_FRESHNESS_MS) continue;
      presence.activeCount++;
      if (member.role === "host" || member.role === "co-host") {
        presence.hostExpiresAt = Math.max(presence.hostExpiresAt ?? 0, seen + HEARTBEAT_FRESHNESS_MS);
      }
    }
    result.set(roomId, presence);
  }
  return result;
}

export interface ListEvent extends EventAccessRow { lynk_room_id?: string | null }
export interface ListLifecycle { event_id: number; room_uuid: string; state: string }
export type EventLink =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "linked"; event: ListEvent; lifecycle: ListLifecycle };

/** Both directions must agree. In particular a lifecycle-only orphan is not a
 * public ordinary room, even if events.lynk_room_id no longer points at it. */
export function resolveListEventLink(uuid: string, events: ListEvent[], lifecycles: ListLifecycle[]): EventLink {
  const direct = events.filter((event) => event.lynk_room_id === uuid);
  const reverse = lifecycles.filter((lifecycle) => lifecycle.room_uuid === uuid);
  if (!direct.length && !reverse.length) return { kind: "none" };
  if (direct.length !== 1 || reverse.length !== 1) return { kind: "invalid" };
  const event = direct[0];
  const lifecycle = reverse[0];
  if (event.id !== lifecycle.event_id || lifecycles.filter((row) => row.event_id === event.id).length !== 1) {
    return { kind: "invalid" };
  }
  return { kind: "linked", event, lifecycle };
}

export function resolveListAvailability(
  room: { status: string; created_at?: string | null; ends_at?: string | null },
  presence: RoomPresence | undefined,
  link: EventLink,
  now: number,
): { availability: LynkAvailability; presenceKnown: boolean; observedAt: string; presenceExpiresAt: string | null; endsAt: string | null } {
  const base = { presenceKnown: true, observedAt: new Date(now).toISOString(), presenceExpiresAt: null as string | null };
  if (link.kind === "invalid") return { ...base, availability: "unknown", endsAt: null };
  const end = link.kind === "linked" ? eventRoomDeadline(link.event, room)
    : room.ends_at == null ? null : Date.parse(room.ends_at);
  const endsAt = end !== null && Number.isFinite(end) ? new Date(end).toISOString() : null;
  const result = (availability: LynkAvailability) => ({ ...base, availability, endsAt });
  if (room.status === "ended" || room.status === "closed") return result("ended");
  if (room.status !== "open") return result("unknown");
  if ((end !== null && !Number.isFinite(end)) || (link.kind === "linked" && end === null)) return result("unknown");
  if (end !== null && now >= end) return result("ended");
  if (link.kind === "linked") {
    if (["cancelled", "deleted"].includes(link.event.status ?? "") || ["ended", "cancelled"].includes(link.lifecycle.state)) return result("ended");
    if (["scheduled", "ready"].includes(link.lifecycle.state)) return result("scheduled");
    if (link.lifecycle.state !== "live") return result("unknown");
    // An explicit host Start allows early access; the clock alone never opens it.
  }
  const expiry = presence?.hostExpiresAt;
  if (expiry == null || expiry <= now) return result("inactive");
  return { ...result("live"), presenceExpiresAt: new Date(Math.min(expiry, end ?? Infinity)).toISOString() };
}
