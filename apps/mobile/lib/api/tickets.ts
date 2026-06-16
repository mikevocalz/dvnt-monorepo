import { supabase } from "../supabase/client";
import { getCurrentUserAuthId } from "./auth-helper";
import { requireBetterAuthToken } from "../auth/identity";
import { invokeEdge } from "./invoke-edge";
import {
  CartLineRefundResponseDTO,
  parseDTO,
  type CartLineRefundResponse,
} from "@/lib/contracts/dto";

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
  event_date?: string;
  event_location?: string;
  username?: string;
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
    } = {},
  ): Promise<{
    tickets: TicketRecord[];
    page: number;
    pageSize: number;
    total: number | null;
    hasMore: boolean;
    role: "owner" | "admin" | "editor" | "scanner" | null;
  }> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      tickets: TicketRecord[];
      page?: number;
      pageSize?: number;
      total?: number | null;
      hasMore?: boolean;
      role?: "owner" | "admin" | "editor" | "scanner";
    }>("get-event-tickets", {
      event_id: parseInt(eventId),
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      status: opts.status ?? "all",
      search: opts.search ?? "",
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
      console.error("[Tickets] getMyTickets error:", error.message);
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
      const { data, error } = await supabase.functions.invoke(
        "ticket-checkout",
        {
          body: {
            event_id: params.eventId,
            ticket_type_id: params.ticketTypeId,
            quantity: params.quantity,
            ...(params.promoCode ? { promo_code: params.promoCode } : {}),
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
   * Scan/validate a ticket by QR token (organizer)
   */
  async scanTicket(
    qrToken: string,
    scannedBy?: string,
    eventId?: string,
  ): Promise<{
    valid: boolean;
    reason?: string;
    ticket?: any;
  }> {
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
   * validate scans offline.
   */
  async downloadOfflineTokens(eventId: string): Promise<string[]> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      qr_tokens: string[];
    }>("get-event-tickets", {
      event_id: parseInt(eventId),
      offline: true,
    });
    if (error) {
      console.error("[Tickets] downloadOfflineTokens error:", error.message);
      return [];
    }
    return data?.ok ? (data.qr_tokens ?? []).filter(Boolean) : [];
  },

  /**
   * Sync offline scans back to the server.
   * Calls ticket-scan edge function for each pending scan.
   */
  async syncOfflineScans(
    scans: { qrToken: string; scannedAt: string; scannedBy?: string }[],
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
      console.error("[Tickets] getMyTicketForEvent error:", error.message);
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
