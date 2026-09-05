import { supabase } from "../supabase/client";
import { getCurrentUserAuthId } from "./auth-helper";
import { requireBetterAuthToken } from "../auth/identity";
import { invokeEdge } from "./invoke-edge";
import { getPendingPromoterRef } from "../stores/promoter-ref-store";
import {
  CartLineRefundResponseDTO,
  parseDTO,
  type CartLineRefundResponse,
} from "@dvnt/app/lib/contracts/dto";
import type { PlanKey } from "@dvnt/app/lib/subscription/types";
import type { PerkKey } from "@dvnt/app/lib/perks/perk-config";

/** Keyset cursor for the roster — the previous page's last row. */
export interface RosterCursor {
  value: string | number | null;
  id: string;
}

export interface TicketRecord {
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
  cart_id?: string | null;
  cart_line_item_id?: string | null;
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

export const ticketsApi = {
  /**
   * Get all tickets for an event via the get-event-tickets edge fn.
   * Backwards-compat wrapper around the paginated variant — returns
   * the first 200 rows in one shot.
   *
   * For rosters > 200 attendees, callers should switch to
   * `getEventTicketsPaginated` which supports server-side pagination,
   * status filter, and qr_token prefix search.
   */
  async getEventTickets(eventId: string): Promise<TicketRecord[]> {
    const page = await ticketsApi.getEventTicketsPaginated(eventId, {
      page: 1,
      pageSize: 200,
    });
    return page.tickets;
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
      console.error(
        "[Tickets] getEventTicketsPaginated error:",
        error.message,
      );
      return {
        tickets: [],
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? 50,
        total: null,
        hasMore: false,
        role: null,
        nextCursor: null,
      };
    }
    const tickets = data?.ok ? (data.tickets ?? []) : [];
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
      return [];
    }
    return data?.ok ? (data.tickets ?? []) : [];
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
    promoCode?: string;
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
            ...(params.promoCode ? { promo_code: params.promoCode } : {}),
            ...(promoterCode ? { promoter_code: promoterCode } : {}),
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
    try {
      // ticket-scan now requires a Better Auth session (host-only). Without
      // this header it returns 401 and scans silently fail.
      const token = await requireBetterAuthToken();
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

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error("[Tickets] scanTicket error:", error);
      return { valid: false, reason: "network_error" };
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
      return [];
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
    const { data, error } = await invokeEdge<{
      ok: boolean;
      qr_tokens: string[];
      addon_qr_tokens?: string[];
    }>("get-event-tickets", {
      event_id: parseInt(eventId),
      offline: true,
    });
    if (error) {
      console.error("[Tickets] downloadOfflineTokens error:", error.message);
      return [];
    }
    if (!data?.ok) return [];
    const addonTokens = (data.addon_qr_tokens ?? []).filter(Boolean);
    try {
      // Lazy import mirrors the store→api dynamic import and avoids a
      // static cycle (the store lazy-imports this module for auto-drain).
      const { useOfflineCheckinStore } = await import(
        "@dvnt/app/lib/stores/offline-checkin-store"
      );
      useOfflineCheckinStore
        .getState()
        .setAddonTokensForEvent(eventId, addonTokens);
    } catch (e) {
      console.warn("[Tickets] offline addon-token seed failed:", e);
    }
    return (data.qr_tokens ?? []).filter(Boolean);
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
    }[],
  ): Promise<{ synced: string[]; failed: string[] }> {
    const synced: string[] = [];
    const failed: string[] = [];
    // Resolve once; one session token for the whole batch.
    let token: string | null = null;
    try {
      token = await requireBetterAuthToken();
    } catch {
      // Without a session every scan will 401 — mark all as failed so the
      // queue stays intact for the next online sync attempt.
      return { synced, failed: scans.map((s) => s.qrToken) };
    }
    for (const scan of scans) {
      try {
        const { data, error } = await supabase.functions.invoke("ticket-scan", {
          body: {
            qr_token: scan.qrToken,
            scanned_by: scan.scannedBy,
            offline_scanned_at: scan.scannedAt,
            ...(scan.eventId ? { event_id: scan.eventId } : {}),
          },
          headers: {
            Authorization: `Bearer ${token}`,
            "x-auth-token": token,
          },
        });
        if (error) throw error;
        synced.push(scan.qrToken);
      } catch {
        failed.push(scan.qrToken);
      }
    }
    return { synced, failed };
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

  /**
   * Get the current user's ticket for a specific event — routed
   * through the get-my-tickets edge function with an `event_id`
   * filter, returns the most recent matching row.
   */
  async getMyTicketForEvent(eventId: string): Promise<TicketRecord | null> {
    const eventIdInt = parseInt(eventId, 10);
    if (!Number.isFinite(eventIdInt)) {
      console.warn("[Tickets] getMyTicketForEvent: invalid eventId", eventId);
      return null;
    }
    const { data, error } = await invokeEdge<{
      ok: boolean;
      tickets: TicketRecord[];
    }>("get-my-tickets", { event_id: eventIdInt });
    if (error) {
      // "Not authenticated" is expected for logged-out viewers on public event
      // pages — they simply have no ticket. Don't log it as an error.
      if (!/not authenticated/i.test(error.message ?? "")) {
        console.error("[Tickets] getMyTicketForEvent error:", error.message);
      }
      return null;
    }
    return data?.ok ? (data.tickets?.[0] ?? null) : null;
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
      return { error: error.message || "Transfer failed" };
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
      return { error: error.message || "Accept failed" };
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
      return { error: error.message || "Decline failed" };
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
      return { error: error.message || "Cancel failed" };
    }
  },

  async getPendingTransfers(): Promise<{
    incoming: any[];
    outgoing: any[];
  }> {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) return { incoming: [], outgoing: [] };

      const { data: incoming } = await supabase
        .from("ticket_transfers")
        .select(
          "*, tickets(id, event_id, ticket_types(name), events(title, start_date))",
        )
        .eq("to_user_id", authId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("initiated_at", { ascending: false });

      const { data: outgoing } = await supabase
        .from("ticket_transfers")
        .select(
          "*, tickets(id, event_id, ticket_types(name), events(title, start_date))",
        )
        .eq("from_user_id", authId)
        .eq("status", "pending")
        .order("initiated_at", { ascending: false });

      return {
        incoming: incoming || [],
        outgoing: outgoing || [],
      };
    } catch (error) {
      console.error("[Tickets] getPendingTransfers error:", error);
      return { incoming: [], outgoing: [] };
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
    const result = await ticketsApi.scanTicket(data.qrToken);
    return {
      success: result.valid,
      alreadyCheckedIn: result.reason === "already_scanned",
    };
  },
};

export const tickets = ticketsApi;
