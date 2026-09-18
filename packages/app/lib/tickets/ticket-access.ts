/**
 * What a viewer is allowed to do with one pass.
 *
 * My Tickets and the ticket detail both have to answer three questions before
 * they paint: may this person see the credential, may they hand it to someone
 * else, may they ask for their money back. Getting any of them wrong is not a
 * layout bug — it shows one member another member's QR, or lets a pass that is
 * already halfway to a new owner be transferred or refunded a second time.
 *
 * Every rule here fails closed: an unknown viewer, a row with no `user_id`, or
 * a status this file does not recognise all resolve to "no".
 */

import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

/** `useTicketViewerId()` returns this for a signed-out read. */
export const ANON_VIEWER_ID = "anon";

/** A pass that can never be presented at a door again. */
const SPENT_STATUSES = new Set(["refunded", "void"]);

/**
 * May this pass be admitted tonight?
 *
 * `active` is unused, `scanned` is already inside. Everything else — refunded,
 * void, mid-transfer, or a status this build has never heard of — is not a
 * guest who is coming, and must not be counted as one.
 *
 * The door list used to exclude only `void`, which left refunded passes in the
 * roster, in the progress denominator, and behind a live "Check in" button
 * carrying nothing but a grey " · Refunded" suffix. On 2026-09-18 that meant
 * two people who had their money back could still be let in.
 */
export function isAdmissible(status: string | null | undefined): boolean {
  return status === "active" || status === "scanned";
}

/**
 * Should this pass appear in the door list at all?
 *
 * Wider than `isAdmissible` on purpose. A refunded guest who turns up insisting
 * they have a ticket is exactly who staff need to look up, and "not found"
 * reads as a broken scanner rather than as an answer. So refunded rows stay
 * visible and un-checkinable; only `void` — a pass that was never real — is
 * hidden outright.
 */
export function isListable(status: string | null | undefined): boolean {
  return status !== "void";
}

export type TicketAccessDenial =
  | "signed-out"
  | "not-holder"
  | "mid-transfer"
  | "spent";

export interface TicketAccess {
  /** The viewer is the account the row belongs to. */
  isHolder: boolean;
  /** QR token / wallet credential may be rendered. */
  canShowCredential: boolean;
  canTransfer: boolean;
  canRefund: boolean;
  /** Why the answer was no. `null` when nothing was denied. */
  denial: TicketAccessDenial | null;
}

const DENY = (denial: TicketAccessDenial, isHolder = false): TicketAccess => ({
  isHolder,
  canShowCredential: false,
  canTransfer: false,
  canRefund: false,
  denial,
});

/**
 * Ticket ids named by pending transfer rows. `getPendingTransfers()` returns
 * `ticket_transfers` joined to `tickets`, so the id can arrive on either the
 * join (`tickets.id`) or the FK column (`ticket_id`).
 */
export function pendingTransferTicketIds(
  transfers: readonly unknown[] | null | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const row of transfers ?? []) {
    const r = row as { ticket_id?: unknown; tickets?: { id?: unknown } };
    const id = r?.tickets?.id ?? r?.ticket_id;
    if (id != null && String(id).length > 0) out.add(String(id));
  }
  return out;
}

/**
 * Does this stamp name this viewer, in either id namespace?
 *
 * Empty strings are dropped on BOTH sides before comparing, so an unstamped
 * ticket can never match a viewer whose auth id is merely unknown.
 */
function isHeldBy(
  stamp: unknown,
  viewerId: string,
  viewerAuthId: string | null | undefined,
): boolean {
  const held = String(stamp ?? "");
  if (held.length === 0) return false;
  return held === String(viewerId) || (!!viewerAuthId && held === String(viewerAuthId));
}

/**
 * Resolve one pass against one viewer.
 *
 * `tickets` from `get-my-tickets` are already server-scoped to the session, so
 * the holder check is defence in depth — it catches a cache that outlived a
 * logout or an account switch, which is exactly when a credential would leak.
 *
 * A viewer has TWO ids and the check has to know both. `tickets.user_id` is an
 * untyped text column with no FK, and it is stamped with the Better Auth id:
 * ticket-checkout writes `verifySession().userId`, and the RSVP rail writes
 * `p_user_auth_id`. The auth store's `user.id`, meanwhile, is the users-table
 * integer as a string — `auth-helper.ts` says so outright, and
 * `getCurrentUserId()` treats an auth id there as a bug. So `viewerId` alone
 * matches nothing a holder actually owns; `get-my-tickets` itself queries
 * `user_id IN (authId, legacyUsersRowId)` for the same reason.
 */
export function resolveTicketAccess(input: {
  ticket: Pick<TicketRecord, "id" | "user_id" | "status"> | null | undefined;
  /** The users-table row id — also the ticket cache's bucket. */
  viewerId: string | null | undefined;
  /** The Better Auth id, which is what the ticket row is actually stamped with. */
  viewerAuthId?: string | null | undefined;
  /** From `pendingTransferTicketIds(usePendingTransfers().data)`. */
  transferringTicketIds?: ReadonlySet<string>;
}): TicketAccess {
  const { ticket, viewerId, viewerAuthId, transferringTicketIds } = input;

  if (!ticket) return DENY("not-holder");
  if (!viewerId || viewerId === ANON_VIEWER_ID) return DENY("signed-out");
  if (!isHeldBy(ticket.user_id, viewerId, viewerAuthId))
    return DENY("not-holder");

  const midTransfer =
    ticket.status === "transfer_pending" ||
    (transferringTicketIds?.has(String(ticket.id)) ?? false);
  if (midTransfer) return DENY("mid-transfer", true);

  if (SPENT_STATUSES.has(ticket.status)) return DENY("spent", true);

  // `scanned` is still the holder's pass — it just cannot be moved or refunded.
  if (ticket.status === "scanned")
    return {
      isHolder: true,
      canShowCredential: true,
      canTransfer: false,
      canRefund: false,
      denial: "spent",
    };

  if (ticket.status !== "active") return DENY("spent", true);

  return {
    isHolder: true,
    canShowCredential: true,
    canTransfer: true,
    canRefund: true,
    denial: null,
  };
}
