/**
 * The last door role this account/device had CONFIRMED for an event.
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

// v1 was event-only: deliberately do not import another account's old proof.
const KEY = "dvnt.door.confirmed-role.v2";
const SCAN_ROLES = new Set(["owner", "admin", "editor", "scanner"]);
const identityKey = (viewerId: string, eventId: string) => JSON.stringify([viewerId, eventId]);

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
    const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Confirmed : {};
  } catch {
    return {};
  }
}

/** Call when the SERVER has just confirmed a scan-capable role. */
export function rememberDoorRole(viewerId: string, eventId: string, role: string): void {
  if (typeof window === "undefined" || !viewerId || !eventId || !SCAN_ROLES.has(role)) return;
  try {
    const all = read();
    all[identityKey(viewerId, eventId)] = { role, at: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode / quota. Offline opening is a bonus, never a requirement.
  }
}

/** The remembered role, or null when absent or stale. */
export function recallDoorRole(viewerId: string, eventId: string, now: number = Date.now()): string | null {
  if (!viewerId || !eventId) return null;
  const entry = read()[identityKey(viewerId, eventId)];
  if (!entry || !SCAN_ROLES.has(entry.role) || typeof entry.at !== "number" || !Number.isFinite(entry.at)) return null;
  const age = now - entry.at;
  return age >= 0 && age <= MAX_AGE_MS ? entry.role : null;
}

export function forgetDoorRole(viewerId: string, eventId: string): void {
  if (typeof window === "undefined" || !viewerId || !eventId) return;
  try {
    const all = read();
    delete all[identityKey(viewerId, eventId)];
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // See rememberDoorRole.
  }
}
