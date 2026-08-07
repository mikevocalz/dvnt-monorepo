/**
 * AddonUpsellStrip — WEB buyer-facing add-on upsell (Posh upsell bar, WS-3).
 * Rendered after tier selection in the event-detail checkout sheet and as the
 * post-purchase offer on ticket-upgrade. Presentation only: selections live in
 * the shared `useAddonUpsellStore`; they become cart line items (category
 * "addon") that flow through cart-create-hold → cart_create_hold, which
 * REPRICES every line under lock — the numbers here are preview.
 *
 * Design-system treatment: flat surface cards + hairlines, Space-Mono-voiced
 * prices (font-mono), gold urgency for low stock, no pills.
 */

import { ChevronDown, Minus, Plus, Sparkles } from "lucide-react";
import type { AddonRecord, AddonVariantRecord } from "@dvnt/app/lib/api/addons";
import {
  addonAvailable,
  effectiveAddonUnitPriceCents,
  filterEligibleAddons,
} from "@dvnt/app/lib/tickets/pricing";
import {
  addonSelectionKey,
  useAddonUpsellStore,
} from "@dvnt/app/lib/stores/addon-upsell-store";

const INT_MAX = 2147483647;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function Stepper({
  qty,
  max,
  onIncrement,
  onDecrement,
  label,
}: {
  qty: number;
  max: number;
  onIncrement: () => void;
  onDecrement: () => void;
  label: string;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={onIncrement}
        disabled={max <= 0}
        aria-label={`Add ${label}`}
        className="h-8 rounded-lg border border-[#3FDCFF]/40 bg-[#3FDCFF]/10 px-3 text-xs font-bold text-[#3FDCFF] disabled:opacity-40"
      >
        {max <= 0 ? "Sold out" : "Add"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onDecrement}
        aria-label={`Decrease ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 active:scale-95"
      >
        <Minus size={13} className="text-white" />
      </button>
      <span className="w-5 text-center font-mono text-sm font-bold text-white">
        {qty}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={qty >= max}
        aria-label={`Increase ${label}`}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 active:scale-95 disabled:opacity-40"
      >
        <Plus size={13} className="text-white" />
      </button>
    </div>
  );
}

function VariantRow({
  eventId,
  addon,
  variant,
}: {
  eventId: string;
  addon: AddonRecord;
  variant: AddonVariantRecord;
}) {
  const qty = useAddonUpsellStore(
    (s) =>
      (s.eventId === eventId &&
        s.selections[addonSelectionKey(addon.id, variant.id)]?.quantity) ||
      0,
  );
  const increment = useAddonUpsellStore((s) => s.increment);
  const decrement = useAddonUpsellStore((s) => s.decrement);
  const available = addonAvailable(variant);
  const unitCents = effectiveAddonUnitPriceCents(
    addon.price_cents,
    variant.price_cents,
  );

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm text-white/80">
        {variant.name}
      </span>
      {available > 0 && available <= 10 && available !== INT_MAX ? (
        <span className="shrink-0 font-mono text-[11px] font-bold text-[#F5C518]">
          {available} left
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-sm text-white/70">
        {money(unitCents)}
      </span>
      <Stepper
        qty={qty}
        max={Math.min(available, 20)}
        onIncrement={() => increment(eventId, addon.id, variant.id)}
        onDecrement={() => decrement(eventId, addon.id, variant.id)}
        label={`${addon.name} ${variant.name}`}
      />
    </div>
  );
}

function AddonCard({ eventId, addon }: { eventId: string; addon: AddonRecord }) {
  const hasVariants =
    addon.has_variants && (addon.ticket_addon_variants?.length ?? 0) > 0;
  const expanded = useAddonUpsellStore((s) => s.expandedAddonId === addon.id);
  const setExpandedAddonId = useAddonUpsellStore((s) => s.setExpandedAddonId);
  const qty = useAddonUpsellStore(
    (s) =>
      (s.eventId === eventId &&
        s.selections[addonSelectionKey(addon.id, null)]?.quantity) ||
      0,
  );
  const variantQty = useAddonUpsellStore((s) =>
    s.eventId === eventId
      ? Object.values(s.selections)
          .filter((sel) => sel.addonId === addon.id && sel.variantId)
          .reduce((sum, sel) => sum + sel.quantity, 0)
      : 0,
  );
  const increment = useAddonUpsellStore((s) => s.increment);
  const decrement = useAddonUpsellStore((s) => s.decrement);

  const available = addonAvailable(addon);
  const maxQty =
    addon.binding_mode === "per_order" ? 1 : Math.min(available, 20);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{addon.name}</p>
          {addon.description ? (
            <p className="truncate text-xs text-white/50">{addon.description}</p>
          ) : null}
          {!hasVariants &&
          available > 0 &&
          available <= 10 &&
          available !== INT_MAX ? (
            <p className="font-mono text-[11px] font-bold text-[#F5C518]">
              Only {available} left
            </p>
          ) : null}
        </div>
        {hasVariants ? (
          <button
            type="button"
            onClick={() => setExpandedAddonId(expanded ? null : addon.id)}
            aria-expanded={expanded}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-white/12 px-3 text-xs font-semibold text-white/80"
          >
            {variantQty > 0 ? (
              <span className="font-mono text-[#3FDCFF]">{variantQty} ·</span>
            ) : null}
            from {money(addon.price_cents)}
            <ChevronDown
              size={13}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <>
            <span className="shrink-0 font-mono text-sm text-white/80">
              {addon.addon_type === "donation" && addon.min_price_cents
                ? `${money(addon.min_price_cents)}+`
                : money(addon.price_cents)}
            </span>
            <Stepper
              qty={qty}
              max={maxQty}
              onIncrement={() => increment(eventId, addon.id, null)}
              onDecrement={() => decrement(eventId, addon.id, null)}
              label={addon.name}
            />
          </>
        )}
      </div>
      {hasVariants && expanded ? (
        <div className="mt-2 flex flex-col divide-y divide-white/[0.06] border-t border-white/10 pt-1">
          {[...(addon.ticket_addon_variants ?? [])]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((variant) => (
              <VariantRow
                key={variant.id}
                eventId={eventId}
                addon={addon}
                variant={variant}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function AddonUpsellStrip({
  eventId,
  addons,
  selectedTierIds,
  ownedTierIds,
  title = "Make it a night",
}: {
  eventId: string;
  addons: AddonRecord[];
  /** Tier ids currently in the buyer's selection/cart (checkout path). */
  selectedTierIds?: ReadonlySet<string>;
  /** Tier ids the buyer already holds a live ticket for (post-purchase). */
  ownedTierIds?: ReadonlySet<string>;
  title?: string;
}) {
  const eligible = filterEligibleAddons(addons, selectedTierIds, ownedTierIds);
  if (eligible.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Sparkles size={13} color="#FF5BFC" />
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">
          Add-ons
        </span>
        <span className="text-[11px] text-white/35">· {title}</span>
      </div>
      <div className="flex flex-col gap-2">
        {eligible.map((addon) => (
          <AddonCard key={addon.id} eventId={eventId} addon={addon} />
        ))}
      </div>
    </section>
  );
}

/**
 * Preview total (cents) for the current selections against a fetched add-on
 * list. Client display only — the server reprices at hold time.
 */
export function addonSelectionsTotalCents(
  addons: AddonRecord[],
  selections: Array<{ addonId: string; variantId: string | null; quantity: number }>,
): number {
  return selections.reduce((sum, sel) => {
    const addon = addons.find((a) => a.id === sel.addonId);
    if (!addon) return sum;
    const variant = sel.variantId
      ? addon.ticket_addon_variants?.find((v) => v.id === sel.variantId)
      : null;
    return (
      sum +
      effectiveAddonUnitPriceCents(addon.price_cents, variant?.price_cents) *
        sel.quantity
    );
  }, 0);
}

export default AddonUpsellStrip;
