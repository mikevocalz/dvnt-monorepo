/**
 * Promoters API (WS-4 promoter economy)
 *
 * Owner/admin CRUD + stats over event_promoters via the
 * manage-promoters edge function (verifySession + owner/admin gate,
 * service-role writes). Distinct from boosts (promotions.ts /
 * SpotlightCampaign) — a promoter is an event-scoped code holder
 * earning a locked bps rev-share on orders they drive.
 *
 * All money is integer cents, straight off the ledger — no client
 * re-math beyond formatting.
 */

import { invokeEdge } from "./invoke-edge";

export type PromoterStatus = "invited" | "active" | "paused" | "removed";

export interface EventPromoter {
  id: string;
  eventId: number;
  /** Better Auth id for linked accounts; null for external promoters. */
  userId: string | null;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  code: string;
  /** @deprecated Use customerDiscountBps + promoterCommissionBps. */
  revShareBps: number;
  customerDiscountBps: number;
  promoterCommissionBps: number;
  status: PromoterStatus;
  /** Attributed orders that reached paid (incl. later refunds). */
  attributedOrders: number;
  /** Sum of attributed orders' subtotal_cents. */
  grossCents: number;
  /** Net ledger earnings (earnings − reversals), signed sum. */
  earnedCents: number;
  createdAt: string;
}

export interface PromoterLeaderboardRow {
  promoterId: string;
  displayName: string;
  code: string;
  status: PromoterStatus | string;
  /** Net ledger earnings — matches the ledger exactly. */
  earnedCents: number;
}

/** Tracked share link for a promoter code (?promo= is taken by promo codes). */
export function promoterShareLink(
  eventId: string | number,
  code: string,
): string {
  return `https://dvntapp.live/public/events/${eventId}?ref=${encodeURIComponent(code)}`;
}

export const promotersApi = {
  async list(eventId: number): Promise<{
    promoters: EventPromoter[];
    callerRole: "owner" | "admin" | null;
  }> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      promoters: EventPromoter[];
      callerRole: "owner" | "admin";
      error?: string;
    }>("manage-promoters", { action: "list", event_id: eventId });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "Could not load promoters");
    return {
      promoters: data.promoters ?? [],
      callerRole: data.callerRole ?? null,
    };
  },

  async add(params: {
    eventId: number;
    username?: string;
    displayName?: string;
    /** @deprecated Use customerDiscountBps + promoterCommissionBps. */
    revShareBps?: number;
    customerDiscountBps?: number;
    promoterCommissionBps?: number;
    code?: string;
  }): Promise<EventPromoter> {
    const customerDiscountBps = params.customerDiscountBps ?? params.revShareBps;
    const promoterCommissionBps = params.promoterCommissionBps ??
      params.revShareBps;
    if (
      customerDiscountBps == null || promoterCommissionBps == null
    ) {
      throw new Error(
        "customerDiscountBps and promoterCommissionBps (or revShareBps) are required",
      );
    }
    const { data, error } = await invokeEdge<{
      ok: boolean;
      promoter: EventPromoter;
      error?: string;
    }>("manage-promoters", {
      action: "add",
      event_id: params.eventId,
      ...(params.username ? { username: params.username } : {}),
      ...(params.displayName ? { display_name: params.displayName } : {}),
      customer_discount_bps: customerDiscountBps,
      promoter_commission_bps: promoterCommissionBps,
      ...(params.code ? { code: params.code } : {}),
    });
    if (error) throw new Error(error.message);
    if (!data?.ok || !data.promoter) {
      throw new Error(data?.error || "Could not add promoter");
    }
    return data.promoter;
  },

  async update(params: {
    promoterId: string;
    /** @deprecated Use customerDiscountBps + promoterCommissionBps. */
    revShareBps?: number;
    customerDiscountBps?: number;
    promoterCommissionBps?: number;
    status?: "active" | "paused";
    displayName?: string;
  }): Promise<void> {
    const { data, error } = await invokeEdge<{ ok: boolean; error?: string }>(
      "manage-promoters",
      {
        action: "update",
        promoter_id: params.promoterId,
        ...(params.revShareBps !== undefined
          ? { rev_share_bps: params.revShareBps }
          : {}),
        ...(params.customerDiscountBps !== undefined
          ? { customer_discount_bps: params.customerDiscountBps }
          : {}),
        ...(params.promoterCommissionBps !== undefined
          ? { promoter_commission_bps: params.promoterCommissionBps }
          : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.displayName !== undefined
          ? { display_name: params.displayName }
          : {}),
      },
    );
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "Could not update promoter");
  },

  async remove(promoterId: string): Promise<void> {
    const { data, error } = await invokeEdge<{ ok: boolean; error?: string }>(
      "manage-promoters",
      { action: "remove", promoter_id: promoterId },
    );
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "Could not remove promoter");
  },

  /** Ranked by net ledger earnings — single ledger query server-side. */
  async leaderboard(eventId: number): Promise<PromoterLeaderboardRow[]> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      leaderboard: PromoterLeaderboardRow[];
      error?: string;
    }>("manage-promoters", { action: "leaderboard", event_id: eventId });
    if (error) throw new Error(error.message);
    if (!data?.ok) return [];
    return data.leaderboard ?? [];
  },

  /** Current user's own promoter record + earnings for an event. */
  async me(eventId: number): Promise<{
    isPromoter: boolean;
    promoter?: {
      id: string;
      code: string;
      status: string;
      customerDiscountBps: number;
      promoterCommissionBps: number;
      attributedOrders: number;
      earnedCents: number;
      connect: {
        stripeAccountId: string | null;
        chargesEnabled: boolean;
        payoutsEnabled: boolean;
        detailsSubmitted: boolean;
      };
    };
  }> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      isPromoter: boolean;
      promoter?: {
        id: string;
        code: string;
        status: string;
        customerDiscountBps: number;
        promoterCommissionBps: number;
        attributedOrders: number;
        earnedCents: number;
        connect: {
          stripeAccountId: string | null;
          chargesEnabled: boolean;
          payoutsEnabled: boolean;
          detailsSubmitted: boolean;
        };
      };
      error?: string;
    }>("promoter-self", { action: "me", event_id: eventId });
    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "Could not load promoter");
    return { isPromoter: data.isPromoter, promoter: data.promoter };
  },

  /** Start Stripe Connect onboarding for the current user's promoter account. */
  async connectStart(eventId: number): Promise<{ url: string; accountId: string }> {
    const { data, error } = await invokeEdge<{
      url?: string;
      account_id?: string;
      error?: string;
    }>("promoter-connect", { action: "start", event_id: eventId });
    if (error) throw new Error(error.message);
    if (!data?.url || !data?.account_id) {
      throw new Error(data?.error || "Could not start Connect onboarding");
    }
    return { url: data.url, accountId: data.account_id };
  },

  /** Poll Connect onboarding status for the current user's promoter account. */
  async connectStatus(eventId: number): Promise<{
    connected: boolean;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
    detailsSubmitted?: boolean;
    currentlyDue?: string[];
    pendingVerification?: string[];
    pastDue?: string[];
    disabledReason?: string | null;
  }> {
    const { data, error } = await invokeEdge<{
      connected: boolean;
      charges_enabled?: boolean;
      payouts_enabled?: boolean;
      details_submitted?: boolean;
      currently_due?: string[];
      pending_verification?: string[];
      past_due?: string[];
      disabled_reason?: string | null;
      error?: string;
    }>("promoter-connect", { action: "status", event_id: eventId });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return {
      connected: data?.connected ?? false,
      chargesEnabled: data?.charges_enabled,
      payoutsEnabled: data?.payouts_enabled,
      detailsSubmitted: data?.details_submitted,
      currentlyDue: data?.currently_due,
      pendingVerification: data?.pending_verification,
      pastDue: data?.past_due,
      disabledReason: data?.disabled_reason,
    };
  },
};
