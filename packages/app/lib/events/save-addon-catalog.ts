import { addonsApi, type AddonVariantRecord } from "../api/addons";
import {
  addonTypeSupportsVariants,
  draftAddonToCreateParams,
  variantRowIsValid,
  type DraftAddon,
} from "../../features/events/create/addon-form";

export interface SaveAddonCatalogOptions {
  eventId: string;
  addons: DraftAddon[];
  originalIds: string[];
  assertCurrent: () => void;
  current: () => boolean;
  onCreated: (draftIndex: number, confirmedId: string, confirmedVariants?: AddonVariantRecord[]) => void;
  onVariantPersisted: (draftIndex: number, originalVariantIndex: number, persisted: AddonVariantRecord) => void;
  onRemoved: (id: string) => void;
}

/** Shared edit save. Drain every in-flight mutation before releasing the caller's
 * save lock, including when a sibling fails. API transport deadlines apply; do
 * not race these operations against a second editor-level timeout.
 */
export async function saveAddonCatalog(options: SaveAddonCatalogOptions): Promise<void> {
  const { eventId, addons, originalIds, assertCurrent, current, onCreated, onVariantPersisted, onRemoved } = options;
  assertCurrent();
  const writes = addons.map(async (draft, draftIndex) => {
    assertCurrent();
    const params = draftAddonToCreateParams(draft, eventId, id => id, draftIndex);
    if (!params) return;
    if (!draft.dbId) {
      try {
        const created = await addonsApi.create(params);
        if (!created?.id) throw new Error("Add-on creation was not confirmed. Reload before retrying.");
        if (current()) onCreated(draftIndex, created.id, created.ticket_addon_variants);
      } catch (error) {
        const addonId = (error as { addonId?: unknown } | null)?.addonId;
        if (typeof addonId === "string" && current()) onCreated(draftIndex, addonId);
        throw error;
      }
      return;
    }
    const updated = await addonsApi.update(draft.dbId, {
      name: params.name,
      description: params.description ?? null,
      addon_type: params.addonType,
      binding_mode: params.bindingMode,
      price_cents: params.priceCents,
      min_price_cents: params.minPriceCents ?? null,
      quantity_total: params.variants?.length ? null : (params.quantityTotal ?? null),
      requires_tier_id: params.requiresTierId ?? null,
      is_redeemable: params.isRedeemable ?? false,
      sort_order: draftIndex,
      status: params.status ?? "on_sale",
    });
    if (!updated) throw new Error("Add-on update was not confirmed.");
    assertCurrent();
    // Serializer filters empty rows and suppresses variants for non-merch.
    // Keep the original indices so confirmed IDs attach to the right draft.
    const validRows = addonTypeSupportsVariants(draft.addonType)
      ? draft.variants.map((row, index) => ({ row, index })).filter(({ row }) => variantRowIsValid(row))
      : [];
    const variants = (params.variants ?? []).map((row, index) => ({ ...row, id: validRows[index]?.row.dbId }));
    const synced = await addonsApi.syncVariants(draft.dbId, variants, (index, row) => {
      const originalIndex = validRows[index]?.index;
      if (originalIndex != null && current()) onVariantPersisted(draftIndex, originalIndex, row);
    });
    if (!synced) throw new Error("Add-on variants were not confirmed.");
  });
  const keptIds = new Set(addons.flatMap(draft => draft.dbId ? [draft.dbId] : []));
  const removals = [...new Set(originalIds)].filter(id => !keptIds.has(id)).map(async id => {
    assertCurrent();
    if (!await addonsApi.remove(id)) throw new Error("Add-on removal was not confirmed.");
    if (current()) onRemoved(id);
  });
  const results = await Promise.allSettled([...writes, ...removals]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  assertCurrent();
}
