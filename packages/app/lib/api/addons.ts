/**
 * Add-ons API — the rich add-on domain (Posh upsell bar, WS-3).
 *
 * Host catalog CRUD on `ticket_addons` / `ticket_addon_variants` goes through
 * the SAME authenticated PostgREST path the ticket_types editor uses
 * (host-scoped RLS policies, migration 20260806400000 — mirrors the 20260301
 * ticket_types predicate). Buyer purchases NEVER go through this module —
 * add-on lines ride the cart rail (cart-create-hold → cart-checkout →
 * cart_complete_issuance) so inventory holds and pricing stay server-side.
 *
 * Owned add-ons (`order_addons`) are read via the owner RLS policy
 * (user_id = jwt sub — needs the Supabase JWT bridge, same as ticket-types).
 *
 * Money is integer cents only.
 */

import { supabase } from "../supabase/client";
import type {
  Addon,
  AddonVariant,
} from "@dvnt/app/lib/contracts/dto";

const MUTATION_TIMEOUT_MS = 15000;

export type AddonType =
  | "merch"
  | "coat_check"
  | "drink_package"
  | "parking"
  | "skip_line"
  | "meet_greet"
  | "donation";

export type AddonBindingMode = "per_ticket" | "per_order" | "standalone";

export type AddonStatus = "draft" | "on_sale" | "paused" | "sold_out" | "ended";

/** The 7 `ticket_addons.addon_type` CHECK values (migration 20260613000100). */
export const ADDON_TYPE_OPTIONS: Array<{
  value: AddonType;
  label: string;
  hint: string;
}> = [
  { value: "merch", label: "Merch", hint: "Tees, hats, posters — supports size × color variants." },
  { value: "coat_check", label: "Coat check", hint: "Scanned at the door when the coat is dropped." },
  { value: "drink_package", label: "Drinks", hint: "Drink tokens or open-bar packages, redeemed at the bar." },
  { value: "parking", label: "Parking", hint: "A parking spot at or near the venue." },
  { value: "skip_line", label: "Skip line", hint: "Priority entry — scanned at the door." },
  { value: "meet_greet", label: "Meet & greet", hint: "Time with the artist or host — often tier-gated." },
  { value: "donation", label: "Donation", hint: "Pay-what-you-want with an optional floor." },
];

export const ADDON_BINDING_OPTIONS: Array<{
  value: AddonBindingMode;
  label: string;
  hint: string;
}> = [
  { value: "standalone", label: "Standalone", hint: "Buyable on its own — no ticket required." },
  { value: "per_order", label: "Per order", hint: "At most one per checkout." },
  { value: "per_ticket", label: "Per ticket", hint: "Quantity follows the number of tickets in the cart." },
];

export const ADDON_STATUS_OPTIONS: Array<{ value: AddonStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "on_sale", label: "On sale" },
  { value: "paused", label: "Paused" },
  { value: "sold_out", label: "Sold out" },
  { value: "ended", label: "Ended" },
];

/** Add-on types that warrant the size × color variant matrix. */
export const VARIANT_ADDON_TYPES: ReadonlySet<AddonType> = new Set(["merch"]);

/** Redeemable-at-door defaults per type (host can override). */
export const REDEEMABLE_DEFAULTS: Record<AddonType, boolean> = {
  merch: false,
  coat_check: true,
  drink_package: true,
  parking: true,
  skip_line: true,
  meet_greet: true,
  donation: false,
};

// ── Row shapes (DB column casing — mirrors ticket-types.ts convention) ──

export interface AddonVariantRecord {
  id: string;
  addon_id: string;
  name: string;
  option_values: Record<string, string>;
  price_cents: number | null;
  quantity_total: number | null;
  quantity_sold: number;
  quantity_held: number;
  sku: string | null;
  sort_order: number;
}

export interface AddonRecord {
  id: string;
  event_id: number;
  name: string;
  description: string | null;
  addon_type: AddonType;
  binding_mode: AddonBindingMode;
  price_cents: number;
  min_price_cents: number | null;
  currency: string;
  quantity_total: number | null;
  quantity_sold: number;
  quantity_held: number;
  has_variants: boolean;
  requires_tier_id: string | null;
  is_redeemable: boolean;
  image_url: string | null;
  sort_order: number;
  status: AddonStatus;
  ticket_addon_variants?: AddonVariantRecord[];
}

/** Purchased add-on (order_addons) + display joins for the holder wallet. */
export interface OrderAddonRecord {
  id: string;
  order_id: string | null;
  event_id: number;
  addon_id: string;
  variant_id: string | null;
  ticket_id: string | null;
  quantity: number;
  unit_price_cents: number;
  refunded_amount_cents: number;
  status: "unfulfilled" | "fulfilled" | "redeemed" | "refunded";
  qr_token: string | null;
  redeemed_at: string | null;
  created_at: string;
  ticket_addons: {
    name: string;
    addon_type: AddonType;
    is_redeemable: boolean;
    image_url: string | null;
  } | null;
  ticket_addon_variants: { name: string } | null;
}

export interface CreateAddonParams {
  eventId: string;
  name: string;
  description?: string;
  addonType: AddonType;
  bindingMode: AddonBindingMode;
  priceCents: number;
  minPriceCents?: number | null;
  quantityTotal?: number | null;
  requiresTierId?: string | null;
  isRedeemable?: boolean;
  imageUrl?: string | null;
  sortOrder?: number;
  status?: AddonStatus;
  /** Size × color matrix rows (merch). Presence flips has_variants. */
  variants?: Array<{
    name: string;
    optionValues: Record<string, string>;
    priceCents?: number | null;
    quantityTotal?: number | null;
    sku?: string | null;
    sortOrder?: number;
  }>;
}

async function ensureBridgeAuth(): Promise<void> {
  try {
    const { ensureSupabaseJwt } = await import("../auth/supabase-jwt");
    await Promise.race([
      ensureSupabaseJwt(),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
  } catch {
    // Non-fatal: the DB call below still returns the authoritative RLS error.
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

export const addonsApi = {
  /** All add-ons for an event, variants embedded (public read). */
  async getByEvent(eventId: string): Promise<AddonRecord[]> {
    try {
      const { data, error } = await supabase
        .from("ticket_addons")
        .select("*, ticket_addon_variants(*)")
        .eq("event_id", parseInt(eventId))
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AddonRecord[];
    } catch (err) {
      console.error("[Addons] getByEvent error:", err);
      return [];
    }
  },

  /** Create an add-on (+ its variant rows). Host RLS enforced. */
  async create(params: CreateAddonParams): Promise<AddonRecord | null> {
    try {
      await ensureBridgeAuth();
      const hasVariants = (params.variants?.length ?? 0) > 0;
      const { data, error } = await supabase
        .from("ticket_addons")
        .insert({
          event_id: parseInt(params.eventId),
          name: params.name,
          description: params.description || null,
          addon_type: params.addonType,
          binding_mode: params.bindingMode,
          price_cents: params.priceCents,
          min_price_cents: params.minPriceCents ?? null,
          // Inventory lives on variants when the matrix is present.
          quantity_total: hasVariants ? null : (params.quantityTotal ?? null),
          has_variants: hasVariants,
          requires_tier_id: params.requiresTierId ?? null,
          is_redeemable:
            params.isRedeemable ?? REDEEMABLE_DEFAULTS[params.addonType],
          image_url: params.imageUrl ?? null,
          sort_order: params.sortOrder ?? 0,
          status: params.status ?? "on_sale",
        })
        .select()
        .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS))
        .single();
      if (error) throw error;

      if (hasVariants && data?.id) {
        const rows = (params.variants ?? []).map((v, i) => ({
          addon_id: data.id,
          name: v.name,
          option_values: v.optionValues,
          price_cents: v.priceCents ?? null,
          quantity_total: v.quantityTotal ?? null,
          sku: v.sku ?? null,
          sort_order: v.sortOrder ?? i,
        }));
        const { error: variantError } = await supabase
          .from("ticket_addon_variants")
          .insert(rows)
          .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
        if (variantError) throw variantError;
      }
      return data as AddonRecord;
    } catch (err) {
      console.error("[Addons] create error:", err);
      throw err;
    }
  },

  /** Patch an add-on definition (host RLS enforced). Column-cased updates. */
  async update(
    id: string,
    updates: Partial<
      Pick<
        AddonRecord,
        | "name"
        | "description"
        | "addon_type"
        | "binding_mode"
        | "price_cents"
        | "min_price_cents"
        | "quantity_total"
        | "has_variants"
        | "requires_tier_id"
        | "is_redeemable"
        | "image_url"
        | "sort_order"
        | "status"
      >
    >,
  ): Promise<boolean> {
    try {
      await ensureBridgeAuth();
      const { error } = await supabase
        .from("ticket_addons")
        .update(updates)
        .eq("id", id)
        .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[Addons] update error:", err);
      throw err;
    }
  },

  /**
   * Retire an add-on. Hard-deletes when nothing sold (order_addons FKs are
   * ON DELETE RESTRICT); falls back to status='ended' when the delete is
   * blocked so sold history is never orphaned.
   */
  async remove(id: string): Promise<boolean> {
    try {
      await ensureBridgeAuth();
      const { error } = await supabase
        .from("ticket_addons")
        .delete()
        .eq("id", id)
        .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
      if (!error) return true;
      // 23503 = foreign_key_violation (already-sold add-on) → soft-retire.
      return addonsApi.update(id, { status: "ended" });
    } catch (err) {
      console.error("[Addons] remove error:", err);
      throw err;
    }
  },

  /** Replace an add-on's variant matrix (delete-and-recreate diff-free path
   *  is unsafe once sold; only unreferenced variants are deleted, the rest
   *  are updated in place, new rows inserted). */
  async syncVariants(
    addonId: string,
    variants: Array<{
      id?: string;
      name: string;
      optionValues: Record<string, string>;
      priceCents?: number | null;
      quantityTotal?: number | null;
      sku?: string | null;
      sortOrder?: number;
    }>,
  ): Promise<boolean> {
    try {
      await ensureBridgeAuth();
      const { data: existing, error: readError } = await supabase
        .from("ticket_addon_variants")
        .select("id")
        .eq("addon_id", addonId);
      if (readError) throw readError;

      const keptIds = new Set(
        variants.filter((v) => v.id).map((v) => String(v.id)),
      );
      const removedIds = (existing || [])
        .map((row: { id: string }) => String(row.id))
        .filter((id) => !keptIds.has(id));

      if (removedIds.length > 0) {
        // RESTRICT FKs will block deleting a sold variant — surface that error.
        const { error: deleteError } = await supabase
          .from("ticket_addon_variants")
          .delete()
          .in("id", removedIds)
          .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
        if (deleteError) throw deleteError;
      }

      for (const [i, v] of variants.entries()) {
        const row = {
          name: v.name,
          option_values: v.optionValues,
          price_cents: v.priceCents ?? null,
          quantity_total: v.quantityTotal ?? null,
          sku: v.sku ?? null,
          sort_order: v.sortOrder ?? i,
        };
        if (v.id) {
          const { error } = await supabase
            .from("ticket_addon_variants")
            .update(row)
            .eq("id", v.id)
            .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("ticket_addon_variants")
            .insert({ ...row, addon_id: addonId })
            .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
          if (error) throw error;
        }
      }

      const { error: flagError } = await supabase
        .from("ticket_addons")
        .update({
          has_variants: variants.length > 0,
          ...(variants.length > 0 ? { quantity_total: null } : {}),
        })
        .eq("id", addonId)
        .abortSignal(timeoutSignal(MUTATION_TIMEOUT_MS));
      if (flagError) throw flagError;
      return true;
    } catch (err) {
      console.error("[Addons] syncVariants error:", err);
      throw err;
    }
  },

  /** The signed-in holder's purchased add-ons for one event (RLS owner read). */
  async getMyAddonsForEvent(eventId: string): Promise<OrderAddonRecord[]> {
    try {
      await ensureBridgeAuth();
      const { data, error } = await supabase
        .from("order_addons")
        .select(
          "*, ticket_addons(name, addon_type, is_redeemable, image_url), ticket_addon_variants(name)",
        )
        .eq("event_id", parseInt(eventId))
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as OrderAddonRecord[];
    } catch (err) {
      console.error("[Addons] getMyAddonsForEvent error:", err);
      return [];
    }
  },

  /** All the signed-in holder's purchased add-ons (my-tickets badges). */
  async getMyAddons(): Promise<OrderAddonRecord[]> {
    try {
      await ensureBridgeAuth();
      const { data, error } = await supabase
        .from("order_addons")
        .select(
          "*, ticket_addons(name, addon_type, is_redeemable, image_url), ticket_addon_variants(name)",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as OrderAddonRecord[];
    } catch (err) {
      console.error("[Addons] getMyAddons error:", err);
      return [];
    }
  },
};

export type { Addon, AddonVariant };
