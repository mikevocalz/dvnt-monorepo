/**
 * AddonsEditor — WEB host catalog editor for the add-on upsell bar (WS-3).
 * Shared by event-create.web (draft store rows) and event-edit.web (working
 * copy hydrated from ticket_addons). Follows the TicketTiersEditor idiom:
 * rounded-2xl row cards, chip selectors for enums (type / binding / status),
 * per-tier eligibility chips fed by the event's own tiers, and a size × color
 * variant matrix for merch. Prices are host dollar-strings here; serialization
 * to integer cents happens in addon-form.ts. Raw semantic HTML + Tailwind.
 */

import { Plus, Trash2, X } from "lucide-react";
import {
  ADDON_BINDING_OPTIONS,
  ADDON_STATUS_OPTIONS,
  ADDON_TYPE_OPTIONS,
} from "@dvnt/app/lib/api/addons";
import {
  addonTypeSupportsVariants,
  newDraftAddon,
  newVariantRow,
  variantDisplayName,
  type DraftAddon,
} from "./addon-form";

export interface AddonTierOption {
  /** Local editor id (create) or ticket_types uuid (edit). */
  id: string;
  name: string;
}

const chipCls = (selected: boolean) =>
  `h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${
    selected
      ? "bg-white text-black border-transparent"
      : "bg-transparent text-white/50 border-white/12 hover:text-white/80"
  }`;

const miniInputCls =
  "h-9 rounded-lg bg-white/8 px-2 text-sm text-white outline-none placeholder:text-white/40";

export function AddonsEditor({
  addons,
  onChange,
  tierOptions,
}: {
  addons: DraftAddon[];
  onChange: (next: DraftAddon[]) => void;
  tierOptions: AddonTierOption[];
}) {
  const update = (idx: number, patch: Partial<DraftAddon>) =>
    onChange(addons.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  const remove = (idx: number) => onChange(addons.filter((_, i) => i !== idx));
  const add = () => onChange([...addons, newDraftAddon()]);

  return (
    <div className="flex flex-col gap-3">
      {addons.map((addon, idx) => {
        const supportsVariants = addonTypeSupportsVariants(addon.addonType);
        const activeType = ADDON_TYPE_OPTIONS.find(
          (o) => o.value === addon.addonType,
        );
        return (
          <div
            key={addon.id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col gap-2"
          >
            {/* Name + remove */}
            <div className="flex items-center justify-between gap-2">
              <input
                className="flex-1 h-9 rounded-lg bg-white/8 px-2 text-sm font-semibold text-white outline-none placeholder:text-white/40"
                value={addon.name}
                placeholder="Add-on name (e.g. Coat check, Event tee)"
                onChange={(e) => update(idx, { name: e.target.value })}
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove add-on"
                className="text-white/40 hover:text-white/80"
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* Type chips — the 7 addon_type enum values */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-white/55">Type</span>
              <div className="flex flex-wrap gap-1.5">
                {ADDON_TYPE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() =>
                      update(idx, {
                        addonType: o.value,
                        // Variant matrix only survives on types that use it.
                        ...(addonTypeSupportsVariants(o.value)
                          ? {}
                          : { variants: [] }),
                      })
                    }
                    className={chipCls(addon.addonType === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {activeType ? (
                <p className="text-[11px] text-white/40">{activeType.hint}</p>
              ) : null}
            </div>

            {/* Price / floor / inventory — server recomputes at hold time */}
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-white/55">
                {addon.addonType === "donation" ? "Suggested $" : "Price $"}
                <input
                  className={`mt-1 w-full font-mono ${miniInputCls}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={addon.priceDollars}
                  onChange={(e) => update(idx, { priceDollars: e.target.value })}
                />
              </label>
              {addon.addonType === "donation" ? (
                <label className="text-[11px] text-white/55">
                  Minimum $
                  <input
                    className={`mt-1 w-full font-mono ${miniInputCls}`}
                    inputMode="decimal"
                    placeholder="No floor"
                    value={addon.minPriceDollars}
                    onChange={(e) =>
                      update(idx, { minPriceDollars: e.target.value })
                    }
                  />
                </label>
              ) : null}
              <label className="text-[11px] text-white/55">
                Inventory
                <input
                  className={`mt-1 w-full ${miniInputCls} disabled:opacity-40`}
                  inputMode="numeric"
                  placeholder="Unlimited"
                  disabled={supportsVariants && addon.variants.length > 0}
                  value={addon.quantity}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                />
              </label>
            </div>
            {supportsVariants && addon.variants.length > 0 ? (
              <p className="text-[11px] text-white/40 -mt-1">
                Inventory is tracked per variant below.
              </p>
            ) : null}

            <input
              className="h-9 rounded-lg bg-white/8 px-2 text-xs text-white outline-none placeholder:text-white/40"
              placeholder="Description (optional)"
              value={addon.description}
              onChange={(e) => update(idx, { description: e.target.value })}
            />

            {/* Binding mode */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-white/55">Sold</span>
              <div className="flex gap-1.5">
                {ADDON_BINDING_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => update(idx, { bindingMode: o.value })}
                    className={`flex-1 ${chipCls(addon.bindingMode === o.value)}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-white/40">
                {
                  ADDON_BINDING_OPTIONS.find(
                    (o) => o.value === addon.bindingMode,
                  )?.hint
                }
              </p>
            </div>

            {/* Per-tier eligibility (requires_tier_id) */}
            {tierOptions.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-white/55">Who can buy it</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => update(idx, { requiresTierId: null })}
                    className={chipCls(addon.requiresTierId == null)}
                  >
                    Anyone
                  </button>
                  {tierOptions.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => update(idx, { requiresTierId: tier.id })}
                      className={chipCls(addon.requiresTierId === tier.id)}
                    >
                      {tier.name || "Untitled tier"} only
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Redeemable at door */}
            <label className="flex items-center gap-2 text-[13px] text-white/75">
              <input
                type="checkbox"
                checked={addon.isRedeemable}
                onChange={(e) => update(idx, { isRedeemable: e.target.checked })}
              />
              Scanned at the door (gets its own QR)
            </label>

            {/* Variant matrix — merch size × color */}
            {supportsVariants ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
                  Variants (size × color)
                </span>
                {addon.variants.map((row, ri) => (
                  <div key={`variant-${ri}`} className="flex items-center gap-2">
                    <input
                      className={`w-16 ${miniInputCls}`}
                      placeholder="Size"
                      value={row.size}
                      onChange={(e) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, size: e.target.value } : r,
                          ),
                        })
                      }
                    />
                    <input
                      className={`w-20 ${miniInputCls}`}
                      placeholder="Color"
                      value={row.color}
                      onChange={(e) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, color: e.target.value } : r,
                          ),
                        })
                      }
                    />
                    <input
                      className={`w-16 font-mono ${miniInputCls}`}
                      inputMode="decimal"
                      placeholder="$ base"
                      value={row.priceDollars}
                      onChange={(e) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, priceDollars: e.target.value } : r,
                          ),
                        })
                      }
                    />
                    <input
                      className={`w-14 ${miniInputCls}`}
                      inputMode="numeric"
                      placeholder="Qty"
                      value={row.quantity}
                      onChange={(e) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, quantity: e.target.value } : r,
                          ),
                        })
                      }
                    />
                    <span className="flex-1 truncate text-[11px] text-white/35 font-mono">
                      {variantDisplayName(row.size, row.color) || "—"}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove variant"
                      onClick={() =>
                        update(idx, {
                          variants: addon.variants.filter((_, i) => i !== ri),
                        })
                      }
                      className="text-white/40 hover:text-white/80"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    update(idx, {
                      variants: [...addon.variants, newVariantRow()],
                    })
                  }
                  className="self-start text-[11px] font-semibold text-white/60 hover:text-white"
                >
                  + Add size / color
                </button>
              </div>
            ) : null}

            {/* Status */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-white/55">Status</span>
              <div className="flex gap-1.5">
                {ADDON_STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => update(idx, { status: o.value })}
                    className={`flex-1 ${chipCls(addon.status === o.value)}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="self-start inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.04] px-3 h-9 text-xs font-semibold text-white/85 hover:bg-white/10"
      >
        <Plus size={14} /> Add add-on
      </button>
    </div>
  );
}

export default AddonsEditor;
