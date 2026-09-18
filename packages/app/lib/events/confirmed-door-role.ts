/**
 * The last door role this device had CONFIRMED for an event.
 *
 * The scanner's gate asks the server who you are. At a venue that question is
 * exactly the one the network drops, and the honest answer to a failed ask is
 * "we could not check" — not "you are not staff". But a door cannot stop
 * admitting people because the signal did, so a device that has already been
 * told it is staff for THIS event remembers that, and may open offline.
 *
 * The deliberate limit: a device that has never been confirmed for an event
 * does not get in offline. Remembering a role you were granted is not the same
 * as granting yourself one, and this only ever widens what a previously
 * verified phone can do while it cannot reach the server.
 *
 * Not a store: it is read once during a render that is already gated on the
 * network, and written from a query callback. localStorage rather than the
 * offline store because it is per-device truth about the STAFFER, not about
 * the event's tickets.
 */

const KEY = "dvnt.door.confirmed-role.v1";

type Confirmed = Record<string, { role: string; at: number }>;

/**
 * How long a remembered role is worth trusting. A shift is hours; a week means
 * a phone that scanned one event still opens that same event's door offline
 * months later, which is a staffing decision nobody made.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function read(): Confirmed {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Confirmed;
  } catch {
    return {};
  }
}

/** Call when the SERVER has just confirmed a scan-capable role. */
export function rememberDoorRole(eventId: string, role: string): void {
  if (typeof window === "undefined" || !eventId || !role) return;
  try {
    const all = read();
    all[eventId] = { role, at: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode / quota. Offline opening is a bonus, never a requirement.
  }
}

/** The remembered role, or null when absent or stale. */
export function recallDoorRole(eventId: string, now: number = Date.now()): string | null {
  const entry = read()[eventId];
  if (!entry) return null;
  return now - entry.at <= MAX_AGE_MS ? entry.role : null;
}

export function forgetDoorRole(eventId: string): void {
  if (typeof window === "undefined") return;
  try {
    const all = read();
    delete all[eventId];
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // See rememberDoorRole.
  }
}
