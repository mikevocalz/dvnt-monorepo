/**
 * Add-on editor model — the SHARED core between the web catalog editors
 * (event-create.web / event-edit.web) and the native create wizard, exactly
 * like event-form.ts is for the event fields. Pure TS: editor rows in host
 * dollar-strings, serializers out to integer-cents `CreateAddonParams`
 * consumed by addonsApi (which mirrors the ticket_addons columns).
 */

import { dollarsToCents } from "@dvnt/app/lib/tickets/pricing";
import {
  REDEEMABLE_DEFAULTS,
  VARIANT_ADDON_TYPES,
  type AddonBindingMode,
  type AddonStatus,
  type AddonType,
  type CreateAddonParams,
} from "@dvnt/app/lib/api/addons";

/** One size × color cell of the merch variant matrix, as the host types it. */
export interface DraftAddonVariantRow {
  /** DB uuid when hydrated from an existing variant (edit flow). */
  dbId?: string;
  size: string;
  color: string;
  /** "" inherits the add-on base price. */
  priceDollars: string;
  /** "" = unlimited. */
  quantity: string;
}

/** One add-on as the host edits it (create draft or edit working copy). */
export interface DraftAddon {
  /** Local editor key (create) — stable across renders. */
  id: string;
  /** DB uuid when hydrated from an existing ticket_addons row (edit flow). */
  dbId?: string;
  name: string;
  description: string;
  addonType: AddonType;
  bindingMode: AddonBindingMode;
  priceDollars: string;
  /** Donation floor ("" = no floor). Only meaningful for addonType=donation. */
  minPriceDollars: string;
  /** "" = unlimited (ignored while variants exist — inventory lives there). */
  quantity: string;
  /**
   * Per-tier eligibility. In CREATE this holds the LOCAL tier editor id (the
   * tier has no DB uuid yet) and is resolved at publish; in EDIT it holds the
   * ticket_types uuid directly. null = any ticket / standalone.
   */
  requiresTierId: string | null;
  isRedeemable: boolean;
  status: AddonStatus;
  variants: DraftAddonVariantRow[];
}

export function addonTypeSupportsVariants(type: AddonType): boolean {
  return VARIANT_ADDON_TYPES.has(type);
}

export function newDraftAddon(addonType: AddonType = "merch"): DraftAddon {
  return {
    id: `addon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    description: "",
    addonType,
    bindingMode: "standalone",
    priceDollars: "",
    minPriceDollars: "",
    quantity: "",
    requiresTierId: null,
    isRedeemable: REDEEMABLE_DEFAULTS[addonType],
    status: "on_sale",
    variants: [],
  };
}

export function newVariantRow(): DraftAddonVariantRow {
  return { size: "", color: "", priceDollars: "", quantity: "" };
}

/** "M / Black" — the ticket_addon_variants.name display convention. */
export function variantDisplayName(size: string, color: string): string {
  return [size.trim(), color.trim()].filter(Boolean).join(" / ");
}

/** A variant row is real when at least one option value is typed. */
export function variantRowIsValid(row: DraftAddonVariantRow): boolean {
  return !!(row.size.trim() || row.color.trim());
}

/** An add-on row is persistable when it has a name. */
export function draftAddonIsValid(draft: DraftAddon): boolean {
  return draft.name.trim().length > 0;
}

/**
 * Editor row → CreateAddonParams (integer cents, exact ticket_addons shape).
 * `resolveTierId` maps the draft's requiresTierId to a real ticket_types uuid
 * (identity in the edit flow; local-id → created-row map at publish). A gate
 * pointing at a tier that no longer resolves is dropped (add-on stays open)
 * rather than blocking the publish.
 * Returns null for rows that shouldn't be persisted (no name).
 */
export function draftAddonToCreateParams(
  draft: DraftAddon,
  eventId: string,
  resolveTierId: (localTierId: string) => string | null = (id) => id,
  sortOrder = 0,
): CreateAddonParams | null {
  if (!draftAddonIsValid(draft)) return null;

  const priceCents = dollarsToCents(draft.priceDollars) ?? 0;
  const minPriceCents = dollarsToCents(draft.minPriceDollars);
  const quantityTotal = parsePositiveInt(draft.quantity);
  const requiresTierId = draft.requiresTierId
    ? resolveTierId(draft.requiresTierId)
    : null;

  const variants = addonTypeSupportsVariants(draft.addonType)
    ? draft.variants.filter(variantRowIsValid).map((row, i) => ({
        name: variantDisplayName(row.size, row.color),
        optionValues: {
          ...(row.size.trim() ? { size: row.size.trim() } : {}),
          ...(row.color.trim() ? { color: row.color.trim() } : {}),
        },
        priceCents: dollarsToCents(row.priceDollars),
        quantityTotal: parsePositiveInt(row.quantity),
        sortOrder: i,
      }))
    : [];

  return {
    eventId,
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    addonType: draft.addonType,
    bindingMode: draft.bindingMode,
    priceCents,
    minPriceCents: draft.addonType === "donation" ? minPriceCents : null,
    quantityTotal,
    requiresTierId,
    isRedeemable: draft.isRedeemable,
    sortOrder,
    status: draft.status,
    variants,
  };
}

/** DB row → editor working copy (edit flow hydration). */
export function addonRecordToDraft(record: {
  id: string;
  name: string;
  description: string | null;
  addon_type: AddonType;
  binding_mode: AddonBindingMode;
  price_cents: number;
  min_price_cents: number | null;
  quantity_total: number | null;
  requires_tier_id: string | null;
  is_redeemable: boolean;
  status: AddonStatus;
  ticket_addon_variants?: Array<{
    id: string;
    option_values: Record<string, string> | null;
    name: string;
    price_cents: number | null;
    quantity_total: number | null;
    sort_order: number;
  }>;
}): DraftAddon {
  return {
    id: record.id,
    dbId: record.id,
    name: record.name || "",
    description: record.description || "",
    addonType: record.addon_type,
    bindingMode: record.binding_mode,
    priceDollars: centsToDollars(record.price_cents),
    minPriceDollars:
      record.min_price_cents != null ? centsToDollars(record.min_price_cents) : "",
    quantity:
      record.quantity_total != null ? String(record.quantity_total) : "",
    requiresTierId: record.requires_tier_id,
    isRedeemable: record.is_redeemable,
    status: record.status,
    variants: [...(record.ticket_addon_variants ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => ({
        dbId: v.id,
        size: v.option_values?.size ?? splitLegacyName(v.name)[0],
        color: v.option_values?.color ?? splitLegacyName(v.name)[1],
        priceDollars: v.price_cents != null ? centsToDollars(v.price_cents) : "",
        quantity: v.quantity_total != null ? String(v.quantity_total) : "",
      })),
  };
}

function parsePositiveInt(input: string): number | null {
  const n = parseInt(input, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function centsToDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** "M / Black" → ["M","Black"] for legacy rows without option_values. */
function splitLegacyName(name: string): [string, string] {
  const parts = (name || "").split("/").map((p) => p.trim());
  return [parts[0] ?? "", parts[1] ?? ""];
}
