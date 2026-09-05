/**
 * Ticket Types API
 *
 * CRUD for ticket types (organizer creates these per event).
 * Used in event create/edit flow and organizer dashboard.
 */

import { supabase } from "../supabase/client";
import { invokeEdge } from "./invoke-edge";
import type {
  PriceScheduleEntry,
  SubAllocation,
  TierType,
  TierVisibility,
} from "../tickets/pricing";

const MUTATION_TIMEOUT_MS = 15000;

async function ensureBridgeAuth(): Promise<void> {
  try {
    const { ensureSupabaseJwt } = await import("../auth/supabase-jwt");
    await Promise.race([
      ensureSupabaseJwt(),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
  } catch {
    // Non-fatal: the DB mutation below still returns the authoritative RLS error.
  }
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export type TicketTypeCategory = "admission" | "product" | "service";

export const TICKET_TYPE_CATEGORIES: Array<{
  value: TicketTypeCategory;
  label: string;
  hint: string;
}> = [
  {
    value: "admission",
    label: "Admission",
    hint: "Entry to the event — GA, VIP, table service, etc.",
  },
  {
    value: "product",
    label: "Add-on",
    hint: "Physical items sold alongside entry — drink tokens, merch.",
  },
  {
    value: "service",
    label: "Service",
    hint: "Experiences sold alongside entry — coat check, bottle service.",
  },
];

/** Selectable subset of the v2 `tier_type` enum surfaced in host editors. */
export const TIER_TYPE_OPTIONS: Array<{ value: TierType; label: string }> = [
  { value: "ga", label: "GA" },
  { value: "vip", label: "VIP" },
  { value: "early_bird", label: "Early Bird" },
  { value: "table_service", label: "Table" },
  { value: "group_bundle", label: "Group" },
];

export const TIER_VISIBILITY_OPTIONS: Array<{
  value: TierVisibility;
  label: string;
  hint: string;
}> = [
  {
    value: "public",
    label: "Public",
    hint: "Everyone sees this tier on the event page.",
  },
  {
    value: "hidden",
    label: "Hidden",
    hint: "Never shown to buyers — for comps and holds.",
  },
  {
    value: "locked",
    label: "Locked",
    hint: "Buyers see “Have a code?” and must enter the unlock code.",
  },
];

export interface TicketTypeRecord {
  id: string;
  event_id: number;
  name: string;
  category: TicketTypeCategory;
  description: string | null;
  price_cents: number;
  currency: string;
  quantity_total: number;
  quantity_sold: number;
  max_per_user: number;
  sale_start: string | null;
  sale_end: string | null;
  is_active: boolean;
  created_at: string;
  // ── v2 tier model (migration 20260613000000). Optional: rows created
  //    before the migration ran fall back to the column defaults.
  tier_type?: TierType | null;
  tier_visibility?: TierVisibility | null;
  /** Host-side only. NEVER used for client-side code comparison. */
  unlock_code?: string | null;
  unlocks_after_tier_id?: string | null;
  price_schedule?: PriceScheduleEntry[] | null;
  sub_allocations?: SubAllocation[] | null;
  status?: string | null;
}

export interface CreateTicketTypeParams {
  eventId: string;
  name: string;
  category?: TicketTypeCategory;
  description?: string;
  priceCents: number;
  currency?: string;
  quantityTotal: number;
  maxPerUser?: number;
  saleStart?: string;
  saleEnd?: string;
  // ── v2 tier model
  tierType?: TierType;
  tierVisibility?: TierVisibility;
  unlockCode?: string;
  priceSchedule?: PriceScheduleEntry[];
  subAllocations?: SubAllocation[];
}

export const ticketTypesApi = {
  /**
   * Create a ticket type for an event
   */
  async create(
    params: CreateTicketTypeParams,
  ): Promise<TicketTypeRecord | null> {
    try {
      await ensureBridgeAuth();
      const { data, error } = await supabase
        .from("ticket_types")
        .insert({
          event_id: parseInt(params.eventId),
          name: params.name,
          category: params.category || "admission",
          description: params.description || null,
          price_cents: params.priceCents,
          currency: params.currency || "usd",
          quantity_total: params.quantityTotal,
          max_per_user: params.maxPerUser || 4,
          sale_start: params.saleStart || null,
          sale_end: params.saleEnd || null,
          is_active: true,
          // v2 tier model — column defaults ('ga'/'public'/[]) when omitted.
          ...(params.tierType ? { tier_type: params.tierType } : {}),
          ...(params.tierVisibility
            ? { tier_visibility: params.tierVisibility }
            : {}),
          ...(params.tierVisibility === "locked"
            ? { unlock_code: params.unlockCode?.trim() || null }
            : {}),
          ...(params.priceSchedule
            ? { price_schedule: params.priceSchedule }
            : {}),
          ...(params.subAllocations
            ? { sub_allocations: params.subAllocations }
            : {}),
        })
        .select()
        .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS))
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      console.error("[TicketTypes] create error:", err);
      throw err;
    }
  },

  /**
   * Get all ticket types for an event
   */
  async getByEvent(eventId: string): Promise<TicketTypeRecord[]> {
    try {
      const { data, error } = await supabase
        .from("ticket_types")
        .select("*")
        .eq("event_id", parseInt(eventId))
        .order("price_cents", { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error("[TicketTypes] getByEvent error:", err);
      return [];
    }
  },

  /**
   * Update a ticket type
   */
  async update(
    id: string,
    updates: Partial<
      Pick<
        TicketTypeRecord,
        | "name"
        | "category"
        | "description"
        | "price_cents"
        | "quantity_total"
        | "max_per_user"
        | "is_active"
        | "sale_start"
        | "tier_type"
        | "tier_visibility"
        | "unlock_code"
        | "price_schedule"
        | "sub_allocations"
      >
    >,
  ): Promise<boolean> {
    try {
      await ensureBridgeAuth();
      const { error } = await supabase
        .from("ticket_types")
        .update(updates)
        .eq("id", id)
        .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));

      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[TicketTypes] update error:", err);
      throw err;
    }
  },

  /**
   * Deactivate a ticket type (soft delete)
   */
  async deactivate(id: string): Promise<boolean> {
    return ticketTypesApi.update(id, { is_active: false });
  },

  /**
   * TODO(payments-wave) — SERVER SEAM: unlock a locked tier by code.
   *
   * Validation MUST be server-side: the client sends {event_id, code} and the
   * server compares against `ticket_types.unlock_code` and returns the ids of
   * the tiers that code unlocks. No `unlock-ticket-tier` edge function or RPC
   * exists yet (audited 2026-08-06 — only `validate-promo-code`, which reads
   * `promo_codes`, not tier unlock codes). Until it ships, this call returns a
   * soft failure and the "Have a code?" affordance surfaces the error.
   *
   * NEVER compare the typed code against a fetched `unlock_code` on the
   * client — that leaks the code to anyone reading network traffic.
   */
  async unlockTier(
    eventId: string,
    code: string,
  ): Promise<{ tierIds: string[]; error?: string }> {
    const { data, error } = await invokeEdge<{
      valid?: boolean;
      tier_ids?: string[];
      error?: string;
    }>(
      "unlock-ticket-tier",
      { event_id: parseInt(eventId), code: code.trim() },
      { requireAuth: false },
    );
    if (error || !data?.valid || !Array.isArray(data.tier_ids)) {
      return {
        tierIds: [],
        error:
          data?.error ||
          error?.message ||
          "Couldn't check that code. Please try again.",
      };
    }
    return { tierIds: data.tier_ids.map(String) };
  },

  /**
   * Create default "General Admission" ticket type for an event
   * Called automatically when organizer enables ticketing.
   */
  async createDefault(
    eventId: string,
    priceCents: number,
    quantity: number,
  ): Promise<TicketTypeRecord | null> {
    return ticketTypesApi.create({
      eventId,
      name: priceCents === 0 ? "Free" : "General Admission",
      category: "admission",
      priceCents,
      quantityTotal: quantity,
      maxPerUser: 4,
    });
  },
};
