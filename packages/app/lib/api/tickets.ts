import { supabase } from "../supabase/client";
import { getCurrentUserAuthId } from "./auth-helper";
import { useAuthStore } from "../stores/auth-store";
import { requireBetterAuthToken, getCurrentUserRow } from "../auth/identity";
import { invokeEdge } from "./invoke-edge";
import { ticketTransferError } from "./ticket-transfer-error";
import { scanFailureReasonForStatus } from "../tickets/scan-verdict";
import { getPendingPromoterRef } from "../stores/promoter-ref-store";
import {
  CartLineRefundResponseDTO,
  parseDTO,
  type CartLineRefundResponse,
} from "@dvnt/app/lib/contracts/dto";
import type { PlanKey } from "@dvnt/app/lib/subscription/types";
import type { PerkKey } from "@dvnt/app/lib/perks/perk-config";
import type { TicketSelfServiceAction } from "../tickets/self-service-action";

const offlineDownloadRevisions = new Map<string, number>();
const offlineReplayInFlight = new Set<string>();
function advanceOfflineRevision(eventId: string): number {
  const next = (offlineDownloadRevisions.get(eventId) ?? 0) + 1;
  offlineDownloadRevisions.set(eventId, next);
  return next;
}

/** An authoritative refusal revokes cached admission evidence, not audit queues. */
async function invalidateOfflineAdmission(eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  advanceOfflineRevision(eventId);
  const { useOfflineCheckinStore } = await import("@dvnt/app/lib/stores/offline-checkin-store");
  useOfflineCheckinStore.getState().invalidateAdmissionForEvent(eventId);
}

async function invalidateRejectedOfflineToken(eventId: string | undefined, qrToken: string, reason: string | undefined): Promise<void> {
  if (!eventId || !["already_scanned", "refunded", "voided", "void", "wrong_event", "transfer_pending", "ticket_not_found", "invalid_status", "addon_not_found", "already_redeemed"].includes(reason ?? "")) return;
  advanceOfflineRevision(eventId);
  const { useOfflineCheckinStore } = await import("@dvnt/app/lib/stores/offline-checkin-store");
  useOfflineCheckinStore.getState().invalidateAdmissionToken(eventId, qrToken);
}

/** Keyset cursor for the roster — the previous page's last row. */
export interface RosterCursor {
  value: string | number | null;
  id: string;
}

export interface TicketRecord {
  organizer_free_cancel?: { eligible: boolean; reason: string | null };
  /** Who this pass is for. The door reads it before the account name. */
  attendee_name?: string | null;
  /** Better Auth id of whoever handed this pass over, set on transfer accept. */
  transferred_from?: string | null;
  id: string;
  event_id: number;
  ticket_type_id: string;
  user_id: string;
  status: "active" | "scanned" | "refunded" | "void" | "transfer_pending";
  qr_token: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  purchase_amount_cents: number | null;
  category?: "admission" | "coat_check" | "product" | "service";
  /** Purchase identity returned by get-my-tickets for issuance confirmation. */
  stripe_payment_intent_id?: string | null;
  cart_id?: string | null;
  cart_line_item_id?: string | null;
  /** Server-verified amount, buyer, payment and policy eligibility. */
  self_service_action?: TicketSelfServiceAction | null;
  created_at: string;
  updated_at?: string;
  wallet_pass_updated_at?: string | null;
  // Joined fields
  ticket_type_name?: string;
  event_title?: string;
  event_image?: string;
  /**
   * `events.dominant_color` — the flyer's representative hex, joined by
   * get-my-tickets. Null until the first viewer's extraction writes it back
   * (see `lib/color/useEventDominantColor`). Consumed by the watch projection,
   * which needs an always-offline colour for a card that has no image.
   */
  event_dominant_color?: string | null;
  event_date?: string;
  /** IANA venue zone; null on older events (render unlabelled). */
  event_tz?: string | null;
  event_is_online?: boolean;
  event_location?: string;
  username?: string;
  /** Holder display name, resolved server-side. Guests carry `guest_name`. */
  holder_name?: string | null;
  /**
   * SUBSCRIPTION tier — deliberately NOT the ticket tier (`ticket_type_name`).
   * Server-resolved from `membership_subscriptions` at query time; the client
   * never derives or caches it. `null` for guests and for anyone whose
   * subscription doesn't currently confer a tier (lapsed past_due, ended
   * cancellation) — a lapsed member gets no perk, by law.
   *
   * Only present for roles permitted to see it; absent entirely otherwise.
   */
  membership_tier?: { planKey: PlanKey; rank: number } | null;
  /** WS-3 perks resolved for this holder at this event. */
  perks?: PerkKey[];
}

/** Add-on summary rendered on door scan result cards ("VIP table ×1 — unredeemed"). */
export interface ScanAddonSummary {
  id: string;
  name: string;
  variant_name: string | null;
  quantity: number;
  status: "unfulfilled" | "fulfilled" | "redeemed" | "refunded";
  redeemed_at: string | null;
  redeemable?: boolean;
}

/**
 * ticket-scan edge fn response. The server rides the redeem_ticket /
 * redeem_addon CAS RPCs — on `already_scanned` it returns the ORIGINAL
 * check-in facts (server always wins on double-scan).
 */
export interface ScanTicketResponse {
  valid: boolean;
  reason?: string;
  /** "addon" when the scanned QR belonged to an order_addons row. */
  kind?: "ticket" | "addon";
  status?: string;
  checked_in_at?: string | null;
  checked_in_by?: string | null;
  checked_in_by_name?: string | null;
  ticket?: any;
  /** The redeemed (or duplicate) add-on itself. */
  addon?: ScanAddonSummary;
  /** The scanned ticket's order add-ons (name, qty, redeemed state). */
  addons?: ScanAddonSummary[];
  /** WS-4: holder's subscription tier, resolved server-side after the redeem. */
  membership_tier?: { planKey: PlanKey; rank: number } | null;
  /** WS-4: perks this holder has at THIS event, already resolved by the server. */
  perks?: PerkKey[];
}

/**
 * A ticket read failed. Distinct from "this account holds no tickets" — the
 * screens must never render one as the other.
 */
export class TicketsUnavailableError extends Error {
  readonly status?: number;
  /**
   * The cold-start 401/403: the poll fired before the session token was in
   * hand. Worth retrying quietly rather than showing the member an error.
   */
  readonly authRace: boolean;

  constructor(
    message: string,
    opts: { status?: number; authRace?: boolean } = {},
  ) {
    super(message);
    this.name = "TicketsUnavailableError";
    this.status = opts.status;
    this.authRace = opts.authRace ?? false;
  }
}

export const ticketsApi = {
  /**
   * Resolve a transfer sender's handle for display.
   *
   * `tickets.transferred_from` stores a Better Auth id and nothing else, so
   * the pass can say a ticket was handed over but not by whom. Degrades to
   * null rather than throwing — "Transferred to you" without a name is still
   * true, and a failed lookup must not take the pass screen down with it.
   */
  async lookupTransferSender(authId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("username")
        .eq("auth_id", authId)
        .maybeSingle();
      if (error || !data) return null;
      return (data as { username?: string | null }).username ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Name the person a ticket is for.
   *
   * `attendee_name` is read by the door (it resolves `holder_name` from
   * attendee_name, then the account, then guest_name), by GuestTicketView and
   * by WalletGroupCard — and until now it could only ever be written once, at
   * checkout, and only when the event had `attendee_name_requirement` switched
   * on. Event 79 has it off, so all 111 of its tickets carry a null name.
   *
   * Goes through `set_ticket_attendee_name` rather than a direct update
   * because RLS on `tickets` grants UPDATE to the host alone, and RLS cannot
   * restrict a column — opening it to holders would open `status` and
   * `qr_token` with it. The function writes one column and authorises the
   * holder (in either id namespace) or the buyer of the order.
   */
  async setAttendeeName(
    ticketId: string,
    attendeeName: string,
  ): Promise<{ ok: boolean; error?: string; attendee_name?: string | null }> {
    const { data, error } = await supabase.rpc("set_ticket_attendee_name", {
      p_ticket_id: ticketId,
      p_attendee_name: attendeeName,
    });
    if (error) {
      console.error("[Tickets] setAttendeeName failed:", error);
      return { ok: false, error: error.message };
    }
    return (data ?? { ok: false, error: "no_response" }) as {
      ok: boolean;
      error?: string;
      attendee_name?: string | null;
    };
  },

  /**
   * Complete event roster for management totals. Each request remains bounded
   * to 200 rows; follow the server's stable cursor, never an offset that moves
   * under new sales. Do not publish a partial roster if any page fails.
   */
  async getEventTickets(eventId: string): Promise<TicketRecord[]> {
    const rows = new Map<string, TicketRecord>();
    const seenCursors = new Set<string>();
    let cursor: RosterCursor | null = null;
    for (;;) {
      const page = await ticketsApi.getEventTicketsPaginated(eventId, {
        pageSize: 200,
        sort: "purchased_at",
        cursor,
      });
      const previousSize = rows.size;
      for (const ticket of page.tickets) rows.set(ticket.id, ticket);
      if (!page.hasMore) return [...rows.values()];
      const next = page.nextCursor;
      const key = next ? JSON.stringify([next.value, next.id]) : "";
      if (rows.size === previousSize || !next?.id || seenCursors.has(key)) {
        throw new Error("Could not load the complete ticket roster. Please refresh.");
      }
      seenCursors.add(key);
      cursor = next;
    }
  },

  /**
   * Paginated + filtered roster fetch. Hits the same edge function but
   * passes the new (V2-SEC-02b) pagination + filter + search params.
   *
   * Status options:
   *   'all' (default) | 'active' | 'scanned' | 'refunded'
   *   'transfer_pending' | 'void'
   *
   * Search currently matches qr_token prefix (case-insensitive). The
   * server escapes %, _, \ so any raw input is safe to pass.
   *
   * Returns { tickets, page, pageSize, total, hasMore, role } where
   * `role` is the caller's effective role ('owner' | 'admin' | 'editor'
   * | 'scanner'). Scanner-role responses are PII-redacted server-side.
   */
  async getEventTicketsPaginated(
    eventId: string,
    opts: {
      page?: number;
      pageSize?: number;
      status?:
        | "all"
        | "active"
        | "scanned"
        | "refunded"
        | "transfer_pending"
        | "void";
      search?: string;
      /** WS-2 sort key; defaults server-side to `purchased_at`. */
      sort?: "purchased_at" | "checked_in" | "ticket_tier" | "status";
      /**
       * Keyset cursor from the previous page's `nextCursor`. Prefer this over
       * `page` on a live roster: offset paging duplicates and skips rows as
       * tickets are sold mid-scroll.
       */
      cursor?: RosterCursor | null;
    } = {},
  ): Promise<{
    tickets: TicketRecord[];
    page: number;
    pageSize: number;
    total: number | null;
    hasMore: boolean;
    role: "owner" | "admin" | "editor" | "scanner" | null;
    nextCursor: RosterCursor | null;
  }> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      tickets: TicketRecord[];
      page?: number;
      pageSize?: number;
      total?: number | null;
      hasMore?: boolean;
      role?: "owner" | "admin" | "editor" | "scanner";
      nextCursor?: RosterCursor | null;
    }>("get-event-tickets", {
      event_id: parseInt(eventId),
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      status: opts.status ?? "all",
      search: opts.search ?? "",
      sort: opts.sort ?? "purchased_at",
      cursor: opts.cursor ?? null,
    });
    if (error) {
      // Same split patch 01 made in scanTicket, for the same reason and with
      // the same consequence if it is missing. Returning `role: null` for BOTH
      // a refusal and a dropped connection made `useEventRole` resolve
      // successfully with "no role", so the scanner's gate told a staffer
      // standing in a basement that they were not on the door — a network
      // failure rendered as a refusal, the exact class of bug patch 01 exists
      // to remove.
      //
      // The field is `error.status`, not `error.context.status`: invokeEdge
      // already unwraps the FunctionsHttpError Response and normalises it
      // (invoke-edge.ts:26-35), and leaves status undefined when the function
      // never answered. That normalisation is the whole reason it exists.
      const { status } = error;
      if (typeof status !== "number") {
        console.warn(
          "[Tickets] getEventTicketsPaginated transport failure:",
          error,
        );
        throw error;
      }
      // THROW, do not return an empty roster.
      //
      // A 401, a 403 or a 500 answered with `{tickets: []}` is indistinguishable
      // from an event where nobody has arrived. React Query saw a successful
      // read, `isError` stayed false, and the door list rendered its empty
      // state — "Everyone here is checked in", with chips reading All 0 ·
      // Checked in 0 · Not in yet 0 — while the retry branch that owns the only
      // way out sat unreachable behind `isError`.
      //
      // Staff at a door cannot tell a failure from an empty venue. The query
      // must fail so the screen can say so.
      console.error("[Tickets] getEventTicketsPaginated HTTP", status);
      throw Object.assign(new Error(`Could not load the guest list (HTTP ${status}).`), { status });
    }
    if (!data?.ok || !Array.isArray(data.tickets)) {
      throw new Error("Could not load the guest list. Please refresh.");
    }
    const tickets = data.tickets;
    return {
      tickets,
      page: data?.page ?? opts.page ?? 1,
      pageSize: data?.pageSize ?? opts.pageSize ?? 50,
      total: data?.total ?? null,
      hasMore: data?.hasMore ?? false,
      role: data?.role ?? null,
      nextCursor: data?.nextCursor ?? null,
    };
  },

  /**
   * Get the current user's tickets across all events via the
   * get-my-tickets edge function. Legacy integer-user-id rows are
   * picked up server-side.
   *
   * THROWS on failure. It used to `return []`, which rendered a request
   * failure as the "No tickets yet" empty state — a member standing at a door
   * with a dead connection was told they had never bought anything. The caller
   * distinguishes empty from failed; only the server decides empty.
   */
  async getMyTickets(): Promise<TicketRecord[]> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      tickets: TicketRecord[];
    }>("get-my-tickets", {});
    if (error) {
      // A 401/403 here is the cold-start race: the ticket poll fires before the
      // session token is in hand, and the very next poll (~5s) succeeds. It is
      // not worth a red LogBox on every launch. Anything else still shouts.
      const authRace =
        error.status === 401 ||
        error.status === 403 ||
        /not authenticated/i.test(error.message ?? "");
      if (!authRace) {
        console.error("[Tickets] getMyTickets error:", error.message);
      }
      throw new TicketsUnavailableError(
        error.message || "Could not load tickets",
        { status: error.status, authRace },
      );
    }
    if (!data?.ok) {
      throw new TicketsUnavailableError("Could not load tickets");
    }
    return data.tickets ?? [];
  },

  /**
   * Every pass this account holds for one event, newest row first as the
   * server returns them.
   *
   * Replaces `getMyTicketForEvent`, which returned `tickets[0]`. With an
   * admission ticket and a coat-check claim on the same event, "the first
   * matching row" is whichever the server happened to order first, so the
   * pass on screen could change identity on any refetch.
   */
  async getMyTicketsForEvent(eventId: string): Promise<TicketRecord[]> {
    const eventIdInt = parseInt(eventId, 10);
    if (!Number.isFinite(eventIdInt)) {
      console.warn("[Tickets] getMyTicketsForEvent: invalid eventId", eventId);
      return [];
    }
    const { data, error } = await invokeEdge<{
      ok: boolean;
      tickets: TicketRecord[];
    }>("get-my-tickets", { event_id: eventIdInt });
    if (error) {
      const authRace =
        error.status === 401 ||
        error.status === 403 ||
        /not authenticated/i.test(error.message ?? "");
      if (!authRace) {
        console.error("[Tickets] getMyTicketsForEvent error:", error.message);
      }
      throw new TicketsUnavailableError(
        error.message || "Could not load tickets",
        { status: error.status, authRace },
      );
    }
    if (!data?.ok) {
      throw new TicketsUnavailableError("Could not load tickets");
    }
    return data.tickets ?? [];
  },

  /**
   * Purchase tickets (free or paid via Stripe Checkout)
   */
  async checkout(params: {
    eventId: string;
    ticketTypeId: string;
    quantity: number;
    userId?: string; // deprecated — server derives from session
    promoCode?: string;
    idempotencyKey?: string;
    /** Normalized phone, sent once the server has asked for one. */
    phone?: string;
  }): Promise<{
    url?: string;
    tickets?: any[];
    free?: boolean;
    error?: string;
  }> {
    try {
      const token = await requireBetterAuthToken();
      // Promoter attribution (WS-4): a pending ?ref= from a tracked
      // share link, MMKV-persisted so the Stripe redirect can't lose
      // it. Never affects pricing — attribution only.
      const promoterCode = getPendingPromoterRef(params.eventId);
      const { data, error } = await supabase.functions.invoke(
        "ticket-checkout",
        {
          body: {
            event_id: params.eventId,
            ticket_type_id: params.ticketTypeId,
            quantity: params.quantity,
            ...(params.promoCode ? { promo_code: params.promoCode } : {}),
            ...(promoterCode ? { promoter_code: promoterCode } : {}),
            ...(params.idempotencyKey
              ? { idempotency_key: params.idempotencyKey }
              : {}),
            ...(params.phone ? { phone: params.phone } : {}),
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error("[Tickets] checkout error:", error);
      return { error: error.message || "Checkout failed" };
    }
  },

  /**
   * Guest checkout — no account required. The server stamps the ticket
   * with `guest_email` and mails the QR + magic-link to that address
   * after payment completes.
   */
  async guestCheckout(params: {
    eventId: string;
    ticketTypeId: string;
    quantity: number;
    guestEmail: string;
    guestName?: string;
    /** Restricted-profile fields; send all three (see checkout-profile-fields). */
    username?: string;
    fullName?: string;
    phoneE164?: string;
    promoCode?: string;
    idempotencyKey?: string;
  }): Promise<{
    url?: string;
    tickets?: any[];
    free?: boolean;
    error?: string;
  }> {
    try {
      // Promoter attribution (WS-4) — same pending-ref read as the
      // authed path; guests arriving from tracked links attribute too.
      const promoterCode = getPendingPromoterRef(params.eventId);
      const { data, error } = await supabase.functions.invoke(
        "ticket-checkout",
        {
          body: {
            event_id: params.eventId,
            ticket_type_id: params.ticketTypeId,
            quantity: params.quantity,
            guest_email: params.guestEmail,
            ...(params.guestName ? { guest_name: params.guestName } : {}),
            ...(params.username ? { username: params.username } : {}),
            ...(params.fullName ? { full_name: params.fullName } : {}),
            ...(params.phoneE164 ? { phone: params.phoneE164 } : {}),
            ...(params.promoCode ? { promo_code: params.promoCode } : {}),
            ...(promoterCode ? { promoter_code: promoterCode } : {}),
            ...(params.idempotencyKey
              ? { idempotency_key: params.idempotencyKey }
              : {}),
          },
          // No Authorization header — the server only checks for it
          // when guest_email is missing, so this routes to the guest
          // path automatically.
        },
      );

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error("[Tickets] guestCheckout error:", error);
      return { error: error.message || "Guest checkout failed" };
    }
  },

  /**
   * Scan/validate a ticket OR add-on by QR token (organizer / door staff).
   * The server resolves which rail the token belongs to and redeems it
   * atomically (redeem_ticket / redeem_addon CAS).
   */
  async scanTicket(
    qrToken: string,
    scannedBy?: string,
    eventId?: string,
  ): Promise<ScanTicketResponse> {
    // A door verdict is never guessed (see lib/tickets/scan-verdict.ts):
    //   • no session / 401 / 403 / 429 / 5xx → a typed NO-VERDICT reason the
    //     scanners render as "Scan Error", never as "Invalid Ticket".
    //   • transport failure (no HTTP response at all) → THROW. This used to be
    //     swallowed into `{ valid:false, reason:"network_error" }`, which (a)
    //     painted a red "Invalid Ticket" on a real ticket whenever the venue
    //     signal dropped, and (b) made the scanners' `onError` offline
    //     fallback unreachable, because the mutation could never reject.
    let token: string;
    try {
      // ticket-scan requires a Better Auth session (host / door staff).
      token = await requireBetterAuthToken();
    } catch {
      // Token retrieval also fails during transport outages. Only a known
      // logged-out state is authority to revoke the cached admission evidence.
      if (useAuthStore.getState().authStatus === "unauthenticated") await invalidateOfflineAdmission(eventId);
      return { valid: false, reason: "unauthorized" };
    }

    const { data, error } = await supabase.functions.invoke("ticket-scan", {
      body: {
        qr_token: qrToken,
        scanned_by: scannedBy,
        ...(eventId ? { event_id: eventId } : {}),
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "x-auth-token": token,
      },
    });

    if (error) {
      // FunctionsHttpError carries the Response in `context`; a fetch failure
      // (FunctionsFetchError) has none — that one is a genuine network error.
      const status = (error as { context?: { status?: number } })?.context
        ?.status;
      if (typeof status !== "number") {
        console.warn("[Tickets] scanTicket transport failure:", error);
        throw error;
      }
      if ([401, 403, 404, 409].includes(status)) await invalidateOfflineAdmission(eventId);
      console.error("[Tickets] scanTicket HTTP", status);
      return { valid: false, reason: scanFailureReasonForStatus(status) };
    }
    try {
      const verdict = typeof data === "string" ? JSON.parse(data) : data;
      if (!verdict || typeof verdict.valid !== "boolean") {
        return { valid: false, reason: "server_error" };
      }
      if (verdict.reason === "event_cancelled") await invalidateOfflineAdmission(eventId);
      else if (verdict.valid === false) await invalidateRejectedOfflineToken(eventId, qrToken, verdict.reason);
      return verdict;
    } catch {
      // A malformed HTTP response is not a transport outage and must never
      // fall into the scanner's offline-admission branch.
      return { valid: false, reason: "server_error" };
    }
  },

  /**
   * Get ticket types for an event
   */
  async getTicketTypes(eventId: string) {
    try {
      const { data, error } = await supabase
        .from("ticket_types")
        .select("*")
        .eq("event_id", parseInt(eventId))
        .order("price_cents", { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("[Tickets] getTicketTypes error:", error);
      // A failed read is not a tier-less event. Let the query expose its error
      // so public buyers can retry instead of entering the free RSVP rail.
      throw error;
    }
  },

  /**
   * Get event financials (organizer)
   */
  async getEventFinancials(eventId: string) {
    try {
      const { data, error } = await supabase
        .from("event_financials")
        .select("*")
        .eq("event_id", parseInt(eventId))
        .single();

      if (error && error.code !== "PGRST116") throw error;
      return data;
    } catch (error) {
      console.error("[Tickets] getEventFinancials error:", error);
      return null;
    }
  },

  /**
   * Download the active QR tokens for an event so the host can
   * validate scans offline. Also seeds the offline store's add-on token
   * allowlist (order_addons redeemable tokens) when the server sends it,
   * so add-on scans queue with the right kind while offline — the return
   * type stays ticket-tokens-only for existing callers.
   */
  async downloadOfflineTokens(eventId: string): Promise<string[]> {
    const revision = advanceOfflineRevision(eventId);
    const viewerId = useAuthStore.getState().user?.id;
    let obsolete = false;
    const unsubscribe = useAuthStore.subscribe((state) => { if (state.user?.id !== viewerId) obsolete = true; });
    const assertCurrent = () => {
      if (!viewerId || obsolete || useAuthStore.getState().user?.id !== viewerId || offlineDownloadRevisions.get(eventId) !== revision) throw new Error("Offline ticket refresh was superseded");
    };
    try {
    assertCurrent();
    const { data, error } = await invokeEdge<{
      ok: boolean;
      qr_tokens: string[];
      addon_qr_tokens?: string[];
    }>("get-event-tickets", {
      event_id: parseInt(eventId),
      offline: true,
    });
    assertCurrent();
    if (error) {
      if ([401, 403, 404, 409].includes(Number(error.status))) await invalidateOfflineAdmission(eventId);
      console.error("[Tickets] downloadOfflineTokens failed");
      throw new Error("Could not refresh offline ticket data");
    }
    if (!data?.ok || !Array.isArray(data.qr_tokens) ||
        (data.addon_qr_tokens !== undefined && !Array.isArray(data.addon_qr_tokens))) {
      throw new Error("Invalid offline ticket data response");
    }
    assertCurrent();
    const addonTokens = (data.addon_qr_tokens ?? []).filter(Boolean);
    const tokens = data.qr_tokens.filter(Boolean);
    // Commit both rails atomically here, not in an awaiting caller whose late
    // continuation could resurrect a snapshot after cancellation invalidated it.
    const { useOfflineCheckinStore } = await import("@dvnt/app/lib/stores/offline-checkin-store");
    assertCurrent();
    useOfflineCheckinStore.getState().setOfflineSnapshot(eventId, tokens, addonTokens);
    return tokens;
    } finally { unsubscribe(); }
  },

  /**
   * Sync offline scans back to the server.
   * Calls ticket-scan edge function for each pending scan — the server
   * routes each token through the same redeem_ticket / redeem_addon CAS
   * used for live scans (p_offline := true via offline_scanned_at), so
   * the server always wins on double-scan and audit rows carry offline
   * provenance. `kind` is the store's discriminator; the server
   * re-resolves the rail from the token itself.
   */
  async syncOfflineScans(
    scans: {
      qrToken: string;
      scannedAt: string;
      scannedBy?: string;
      eventId?: string;
      kind?: "ticket" | "addon";
      conflict?: { reason: string };
    }[],
  ): Promise<{ synced: string[]; failed: string[] }> {
    const synced: string[] = [];
    const failed: string[] = [];
    const viewerId = useAuthStore.getState().user?.id;
    let obsolete = false;
    const current = () => !!viewerId && !obsolete && useAuthStore.getState().user?.id === viewerId;
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.user?.id !== viewerId) obsolete = true;
    });
    try {
      if (!current()) return { synced, failed: scans.map((scan) => scan.qrToken) };
      const owner = await getCurrentUserRow();
      if (!current() || !owner?.authId || (viewerId !== String(owner.id) && viewerId !== owner.authId)) {
        return { synced, failed: scans.map((scan) => scan.qrToken) };
      }
      const token = await requireBetterAuthToken();
      for (const scan of scans) {
        let heldReplayKey: string | undefined;
        try {
          // Preserve legacy/unattributed entries for explicit staff review;
          // never replay another account's queue with the current session.
          if (scan.conflict || !current() || !scan.scannedBy ||
              ![String(owner.id), owner.authId].includes(scan.scannedBy)) {
            throw new Error("Offline scan belongs to another account");
          }
          const { useOfflineCheckinStore } = await import("@dvnt/app/lib/stores/offline-checkin-store");
          const stored = useOfflineCheckinStore.getState().pendingScans.find((pending) => pending.eventId === scan.eventId && pending.qrToken === scan.qrToken);
          const replayKey = JSON.stringify([owner.authId, scan.eventId, scan.qrToken]);
          if (!current() || stored?.conflict || offlineReplayInFlight.has(replayKey)) throw new Error("Offline scan already needs review or is syncing");
          offlineReplayInFlight.add(replayKey);
          heldReplayKey = replayKey;
          const { data, error } = await supabase.functions.invoke("ticket-scan", {
            body: {
              qr_token: scan.qrToken,
              scanned_by: owner.authId,
              offline_scanned_at: scan.scannedAt,
              ...(scan.eventId ? { event_id: scan.eventId } : {}),
            },
            headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
          });
          if (!current()) throw new Error("Offline sync account changed");
          if (error) {
            const status = (error as { context?: { status?: number } })?.context?.status;
            if ([401, 403, 404, 409].includes(Number(status))) await invalidateOfflineAdmission(scan.eventId);
            if (scan.eventId && current() && [403, 404, 409].includes(Number(status))) {
              useOfflineCheckinStore.getState().markScanConflict(scan.eventId, scan.qrToken, {
                reason: status === 403 ? "forbidden" : status === 409 ? "event_cancelled" : "event_unavailable",
                lastAttemptAt: new Date().toISOString(),
              });
            }
            throw error;
          }
          const verdict = typeof data === "string" ? JSON.parse(data) : data;
          if (verdict?.reason === "event_cancelled") await invalidateOfflineAdmission(scan.eventId);
          else if (verdict?.valid === false) await invalidateRejectedOfflineToken(scan.eventId, scan.qrToken, verdict.reason);
          if (verdict?.valid === false && scan.eventId &&
              ["already_scanned", "refunded", "voided", "void", "wrong_event", "transfer_pending", "ticket_not_found", "invalid_status", "addon_not_found", "already_redeemed", "event_cancelled"].includes(verdict.reason)) {
            const { useOfflineCheckinStore } = await import("@dvnt/app/lib/stores/offline-checkin-store");
            if (current()) useOfflineCheckinStore.getState().markScanConflict(scan.eventId, scan.qrToken, {
              reason: verdict.reason,
              lastAttemptAt: new Date().toISOString(),
              checkedInAt: typeof verdict.checked_in_at === "string" ? verdict.checked_in_at : null,
              checkedInByName: typeof verdict.checked_in_by_name === "string" ? verdict.checked_in_by_name : null,
            });
          }
          // A 200 rejection (including another device's duplicate) is not an
          // acknowledgement. Preserve it in the queue for staff review.
          if (!current() || verdict?.valid !== true) throw new Error("Offline scan was not confirmed");
          synced.push(scan.qrToken);
        } catch {
          failed.push(scan.qrToken);
        } finally {
          if (heldReplayKey) offlineReplayInFlight.delete(heldReplayKey);
        }
      }
      return { synced, failed };
    } catch {
      return { synced, failed: scans.filter((scan) => !synced.includes(scan.qrToken)).map((scan) => scan.qrToken) };
    } finally {
      unsubscribe();
    }
  },

  /**
   * Issue a ticket for a free RSVP (legacy path when ticketing is OFF).
   * Creates a real DB row with a crypto-random token via server-side RPC.
   */
  async issueRsvpTicket(params: { eventId: string; userId: string }): Promise<{
    id: string;
    qr_token: string;
    already_existed: boolean;
  } | null> {
    try {
      const { data, error } = await invokeEdge<{
        ok: boolean;
        data?: { id: string; qr_token: string; already_existed: boolean };
        error?: { code: string; message: string };
      }>("rsvp-issue-ticket", { eventId: parseInt(params.eventId, 10) });

      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error?.message || "Failed to issue ticket");
      }
      return data.data ?? null;
    } catch (error) {
      console.error("[Tickets] issueRsvpTicket error:", error);
      return null;
    }
  },


  // ── Ticket Transfers ──────────────────────────────────────────

  async initiateTransfer(
    ticketId: string,
    toUsername: string,
  ): Promise<{ transfer_id?: string; expires_at?: string; error?: string }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "transfer-ticket",
        {
          body: {
            action: "initiate",
            ticket_id: ticketId,
            to_username: toUsername,
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (result.error) return { error: result.error };
      return result;
    } catch (error: any) {
      console.error("[Tickets] initiateTransfer error:", error);
      return { error: await ticketTransferError(error) };
    }
  },

  async acceptTransfer(transferId: string): Promise<{
    success?: boolean;
    ticket_id?: string;
    qr_token?: string;
    error?: string;
  }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "transfer-ticket",
        {
          body: { action: "accept", transfer_id: transferId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (result.error) return { error: result.error };
      return result;
    } catch (error: any) {
      console.error("[Tickets] acceptTransfer error:", error);
      return { error: await ticketTransferError(error) };
    }
  },

  async declineTransfer(
    transferId: string,
  ): Promise<{ success?: boolean; error?: string }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "transfer-ticket",
        {
          body: { action: "decline", transfer_id: transferId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (result.error) return { error: result.error };
      return result;
    } catch (error: any) {
      console.error("[Tickets] declineTransfer error:", error);
      return { error: await ticketTransferError(error) };
    }
  },

  async cancelTransfer(
    transferId: string,
  ): Promise<{ success?: boolean; error?: string }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "transfer-ticket",
        {
          body: { action: "cancel", transfer_id: transferId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (result.error) return { error: result.error };
      return result;
    } catch (error: any) {
      console.error("[Tickets] cancelTransfer error:", error);
      return { error: await ticketTransferError(error) };
    }
  },

  async getPendingTransfers(): Promise<{
    incoming: any[];
    outgoing: any[];
  }> {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) throw new Error("Authentication required");

      const { data: incoming, error: incomingError } = await supabase
        .from("ticket_transfers")
        .select(
          "*, tickets(id, event_id, ticket_types(name), events(title, start_date))",
        )
        .eq("to_user_id", authId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("initiated_at", { ascending: false });

      if (incomingError) throw incomingError;

      const { data: outgoing, error: outgoingError } = await supabase
        .from("ticket_transfers")
        .select(
          "*, tickets(id, event_id, ticket_types(name), events(title, start_date))",
        )
        .eq("from_user_id", authId)
        .eq("status", "pending")
        .order("initiated_at", { ascending: false });

      if (outgoingError) throw outgoingError;

      return {
        incoming: incoming || [],
        outgoing: outgoing || [],
      };
    } catch (error) {
      console.error("[Tickets] getPendingTransfers error:", error);
      throw new Error("Could not load ticket transfers. Please try again.");
    }
  },

  /**
   * Buyer-initiated ticket refund.
   * Only works before event starts and for active tickets.
   */
  async requestRefund(ticketId: string): Promise<{
    ok?: boolean;
    stripe_refund_id?: string;
    message?: string;
    error?: string;
  }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("ticket-refund", {
        body: { ticket_id: ticketId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      const result = typeof data === "string" ? JSON.parse(data) : data;
      return result;
    } catch (error: any) {
      console.error("[Tickets] requestRefund error:", error);
      return { error: error.message || "Refund request failed" };
    }
  },

  /** Organizer correction: never calls a refund or issues a replacement. */
  async cancelOrganizerFreeTicket(params: { ticket_id: string; event_id: number; expected_owner_id: string; reason: string }): Promise<{ ok?: boolean; error?: string }> {
    const fallback = "Cancellation could not be confirmed. Refresh the roster before trying again.";
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("organizer-cancel-free-ticket", {
        body: params, headers: { Authorization: `Bearer ${token}` },
      });
      if (error) {
        const response = error.context;
        if (response && response.status >= 400 && response.status < 500) {
          const body = await response.clone().json();
          const message = typeof body?.error === "string" ? body.error : body?.error?.message;
          if (typeof message === "string" && message.length < 300 && !/[<>\u0000-\u001f]/.test(message)) return { error: message };
        }
        return { error: fallback };
      }
      const result = typeof data === "string" ? JSON.parse(data) : data;
      return result?.ok === true ? { ok: true } : { error: fallback };
    } catch { return { error: fallback }; }
  },

  /** Explicit zero-money cancellation. The server rechecks eligibility atomically. */
  async cancelFreeTicket(ticketId: string): Promise<{
    ok?: boolean;
    message?: string;
    error?: string;
  }> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("ticket-refund", {
        body: { ticket_id: ticketId, action: "cancel_free" },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      return typeof data === "string" ? JSON.parse(data) : data;
    } catch (error: any) {
      console.error("[Tickets] cancelFreeTicket error:", error);
      return { error: error.message || "Cancellation failed" };
    }
  },

  /**
   * Buyer-initiated mixed-cart line refund.
   * Cancels only the selected cart line item; sibling line items remain active.
   */
  async requestLineRefund(params: {
    cartId: string;
    lineItemId: string;
  }): Promise<
    (CartLineRefundResponse & { error?: undefined }) | { error: string }
  > {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "cart-line-refund",
        {
          body: params,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (error) throw error;
      const result = typeof data === "string" ? JSON.parse(data) : data;
      return parseDTO(CartLineRefundResponseDTO, result);
    } catch (error: any) {
      console.error("[Tickets] requestLineRefund error:", error);
      return { error: error.message || "Line-item refund request failed" };
    }
  },

  // Legacy compat
  async checkInTicket(ticketId: string): Promise<{ success: boolean }> {
    return { success: false };
  },
  async checkIn(data: {
    qrToken: string;
  }): Promise<{ success: boolean; alreadyCheckedIn?: boolean }> {
    // Legacy contract: never throws (scanTicket now rejects on transport failure).
    try {
      const result = await ticketsApi.scanTicket(data.qrToken);
      return {
        success: result.valid,
        alreadyCheckedIn: result.reason === "already_scanned",
      };
    } catch {
      return { success: false };
    }
  },
};

export const tickets = ticketsApi;
