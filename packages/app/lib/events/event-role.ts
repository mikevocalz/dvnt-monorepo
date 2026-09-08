/**
 * What an event-scoped role may do.
 *
 * The server already resolves these roles — `get-event-tickets/index.ts:176-195`
 * checks `events.host_id`, then `event_co_organizers` for an accepted
 * `admin` / `editor` / `scanner` row, and 403s anyone else. Every client gate
 * instead compared `user.id` to `event.host.id`, which is owner-only, so a
 * person explicitly given the scanner role was refused the scanner screen
 * before the server was ever asked.
 *
 * These predicates are the client's half of that contract. They decide what to
 * SHOW; the server still decides what is allowed, on every request.
 */

/** Mirrors the server's role ladder. `null` = not staff on this event. */
export type EventRole = "owner" | "admin" | "editor" | "scanner" | null;

const RANK: Record<Exclude<EventRole, null>, number> = {
  owner: 3,
  admin: 2,
  editor: 1,
  scanner: 0,
};

function atLeast(role: EventRole, floor: Exclude<EventRole, null>): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[floor];
}

/**
 * Scanning is the whole point of the scanner role, so it is the one capability
 * every staff role has.
 */
export function canScanTickets(role: EventRole): boolean {
  return role !== null;
}

/** Editing the event itself: content, schedule, tiers. */
export function canEditEvent(role: EventRole): boolean {
  return atLeast(role, "editor");
}

/** The guest roster with attendee identities. Scanners get a redacted view. */
export function canViewFullRoster(role: EventRole): boolean {
  return atLeast(role, "editor");
}

/** Staff management and anything that spends money. */
export function canManageStaff(role: EventRole): boolean {
  return atLeast(role, "admin");
}

/** Money out. Owner only — a co-organizer never sees payouts. */
export function canViewPayouts(role: EventRole): boolean {
  return role === "owner";
}

/** Destructive, irreversible, owner-only: delete, cancel, transfer ownership. */
export function canDeleteEvent(role: EventRole): boolean {
  return role === "owner";
}

/** Does this account have ANY host-side business with this event? */
export function isEventStaff(role: EventRole): boolean {
  return role !== null;
}

/**
 * What to call the role in the UI. A scanner seeing "Host tools" would be
 * misleading about what they can reach.
 */
export function eventRoleLabel(role: EventRole): string {
  switch (role) {
    case "owner":
      return "Host";
    case "admin":
      return "Co-host";
    case "editor":
      return "Editor";
    case "scanner":
      return "Door staff";
    default:
      return "";
  }
}
