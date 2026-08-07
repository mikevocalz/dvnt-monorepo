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
  revShareBps: number;
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
    revShareBps: number;
    code?: string;
  }): Promise<EventPromoter> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      promoter: EventPromoter;
      error?: string;
    }>("manage-promoters", {
      action: "add",
      event_id: params.eventId,
      ...(params.username ? { username: params.username } : {}),
      ...(params.displayName ? { display_name: params.displayName } : {}),
      rev_share_bps: params.revShareBps,
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
    revShareBps?: number;
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
};
