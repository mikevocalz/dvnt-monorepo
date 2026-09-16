/**
 * Guest list for a private event — the pure decisions.
 *
 * A guest is NOT a co-organizer. A co-organizer manages the event; a guest can
 * see it and attend it, and nothing more. The two live in different tables:
 * `event_co_organizers` for staff, `event_invites` for guests.
 *
 * Everything here is a pure function so it can be tested under `node --test`
 * without Deno, a database, or a network. The edge function does the IO; this
 * module decides what the IO should be.
 */

import { normalizeCompRecipient } from "./comp-recipients.ts";

/** Event-scoped role of the CALLER, as the server resolved it. */
export type CallerRole = "owner" | "admin" | "editor" | "scanner" | null;

/**
 * Who may edit the guest list. Deliberately identical to bulk-comp-tickets:
 * owner, or a co-organizer whose row is `accepted = true` AND `role = 'admin'`.
 * An editor can change the event's text; handing out access to a private room
 * is a different power and stays with the people who own it.
 */
export function canInviteGuests(role: CallerRole): boolean {
  return role === "owner" || role === "admin";
}

export type GuestRoute =
  | { route: "member"; username: string; raw: string }
  | { route: "email"; email: string; raw: string }
  | { route: "skip"; raw: string; reason: string };

/**
 * One raw recipient → where it goes. `account` is whatever the caller's
 * username lookup returned (null when nothing matched).
 *
 * An email always routes to `email`, account or not: the row is keyed by the
 * address and only becomes access once a real account proves it owns that
 * address. See `guestInviteGrantsAccess`.
 */
export function routeGuestRecipient(raw: unknown): GuestRoute {
  const text = typeof raw === "string" ? raw.trim() : "";
  const norm = normalizeCompRecipient(raw);
  if (!norm) {
    return {
      route: "skip",
      raw: text,
      reason: "Not a DVNT username or a valid email address",
    };
  }
  return norm.kind === "email"
    ? { route: "email", email: norm.value, raw: text }
    : { route: "member", username: norm.value, raw: text };
}

/** Parse + dedupe a batch. Same person twice is one invite, not two. */
export function parseGuestRecipients(raws: unknown[]): {
  routes: GuestRoute[];
  skipped: { recipient: string; reason: string }[];
} {
  const seen = new Set<string>();
  const routes: GuestRoute[] = [];
  const skipped: { recipient: string; reason: string }[] = [];
  for (const raw of raws) {
    const route = routeGuestRecipient(raw);
    if (route.route === "skip") {
      skipped.push({ recipient: route.raw, reason: route.reason });
      continue;
    }
    const key =
      route.route === "member" ? `u:${route.username}` : `e:${route.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(route);
  }
  return { routes, skipped };
}

/** A row as it exists (or will exist) in `public.event_invites`. */
export interface GuestInviteRow {
  invited_user_id?: string | null;
  invited_email?: string | null;
  status?: string | null;
}

/** What the edge function should insert, after resolving usernames. */
export interface ResolvedGuest {
  raw: string;
  /** auth_id, when a username resolved to an account. */
  authId?: string | null;
  /** Lower-cased address, when the recipient was an email. */
  email?: string | null;
}

/**
 * Idempotency. Existing rows win: re-inviting someone already on the list is a
 * no-op that reports success, never a duplicate row and never a second push.
 */
export function planGuestInviteRows(
  resolved: ResolvedGuest[],
  existing: GuestInviteRow[],
): {
  insert: ResolvedGuest[];
  alreadyInvited: { recipient: string; reason: string }[];
} {
  const haveUsers = new Set(
    existing
      .map((r) => (r.invited_user_id ? String(r.invited_user_id) : null))
      .filter((v): v is string => !!v),
  );
  const haveEmails = new Set(
    existing
      .map((r) =>
        r.invited_email ? String(r.invited_email).trim().toLowerCase() : null,
      )
      .filter((v): v is string => !!v),
  );
  const insert: ResolvedGuest[] = [];
  const alreadyInvited: { recipient: string; reason: string }[] = [];
  for (const guest of resolved) {
    const key = guest.authId
      ? `u:${guest.authId}`
      : guest.email
        ? `e:${guest.email.trim().toLowerCase()}`
        : null;
    if (!key) continue;
    const dup = guest.authId
      ? haveUsers.has(guest.authId)
      : haveEmails.has(guest.email!.trim().toLowerCase());
    if (dup) {
      alreadyInvited.push({
        recipient: guest.raw,
        reason: "Already on the guest list",
      });
      continue;
    }
    if (guest.authId) haveUsers.add(guest.authId);
    else haveEmails.add(guest.email!.trim().toLowerCase());
    insert.push(guest);
  }
  return { insert, alreadyInvited };
}

/** The viewer asking to open a private event. */
export interface GuestViewer {
  /** JWT `sub`. Absent for an anonymous viewer. */
  authId?: string | null;
  /** Address on the account, ONLY when Supabase Auth has confirmed it. */
  verifiedEmail?: string | null;
}

/**
 * Mirrors `can_view_event` in the guest-invite migration. Keep the two in step:
 * this is what the client believes, the SQL is what is enforced.
 *
 * The rule an email invite has to survive: a bare `invited_email` row grants
 * nothing. Access needs an account whose address Supabase Auth has confirmed
 * (`email_confirmed_at IS NOT NULL`) to match it. Anyone can type a string into
 * a signup form; only the mailbox owner can confirm it.
 */
export function guestInviteGrantsAccess(
  row: GuestInviteRow,
  viewer: GuestViewer,
): boolean {
  const status = (row.status ?? "pending").toLowerCase();
  if (status !== "pending" && status !== "accepted") return false;
  if (row.invited_user_id && viewer.authId) {
    if (String(row.invited_user_id) === String(viewer.authId)) return true;
  }
  if (!row.invited_email) return false;
  // An unverified address is not proof of ownership, and neither is a viewer id
  // with no session behind it.
  if (!viewer.authId || !viewer.verifiedEmail) return false;
  return (
    String(row.invited_email).trim().toLowerCase() ===
    viewer.verifiedEmail.trim().toLowerCase()
  );
}
