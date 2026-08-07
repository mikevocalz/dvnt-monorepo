/**
 * AddonsEditorNative — native host catalog editor for the add-on upsell bar
 * (WS-3). Same DraftAddon rows + serializers as the web editor
 * (addons-editor.web.tsx / addon-form.ts); NativeWind classNames match the
 * create-wizard idiom (bg-card cards, chip selectors, muted labels). Prices
 * are host dollar-strings; integer-cents serialization happens in
 * addon-form.ts and the checkout server reprices under lock regardless.
 */

import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { Plus, Trash2, X } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
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

export interface AddonTierOptionNative {
  /** Local editor id (create) or ticket_types uuid (edit). */
  id: string;
  name: string;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`h-8 px-2.5 rounded-lg border items-center justify-center ${
        selected ? "bg-foreground border-transparent" : "border-border"
      }`}
    >
      <Text
        className={`text-[11px] font-semibold ${
          selected ? "text-background" : "text-muted-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AddonsEditorNative({
  addons,
  onChange,
  tierOptions,
}: {
  addons: DraftAddon[];
  onChange: (next: DraftAddon[]) => void;
  tierOptions: AddonTierOptionNative[];
}) {
  const { colors } = useColorScheme();
  const update = (idx: number, patch: Partial<DraftAddon>) =>
    onChange(addons.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  const remove = (idx: number) => onChange(addons.filter((_, i) => i !== idx));

  return (
    <View className="gap-3">
      {addons.map((addon, idx) => {
        const supportsVariants = addonTypeSupportsVariants(addon.addonType);
        const activeType = ADDON_TYPE_OPTIONS.find(
          (o) => o.value === addon.addonType,
        );
        return (
          <View key={addon.id} className="bg-card rounded-2xl p-4 gap-2.5">
            {/* Name + remove */}
            <View className="flex-row items-center gap-2">
              <TextInput
                className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-base text-foreground"
                placeholder="Add-on name (e.g. Coat check, Event tee)"
                placeholderTextColor={colors.mutedForeground}
                value={addon.name}
                onChangeText={(v) => update(idx, { name: v })}
              />
              <Pressable
                onPress={() => remove(idx)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Remove add-on"
              >
                <Trash2 size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Type chips */}
            <Text className="text-[11px] text-muted-foreground">Type</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {ADDON_TYPE_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={addon.addonType === o.value}
                  onPress={() =>
                    update(idx, {
                      addonType: o.value,
                      ...(addonTypeSupportsVariants(o.value)
                        ? {}
                        : { variants: [] }),
                    })
                  }
                />
              ))}
            </View>
            {activeType ? (
              <Text className="text-[11px] text-muted-foreground">
                {activeType.hint}
              </Text>
            ) : null}

            {/* Price / floor / inventory */}
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Text className="text-[11px] text-muted-foreground mb-1">
                  {addon.addonType === "donation" ? "Suggested $" : "Price $"}
                </Text>
                <TextInput
                  className="bg-muted rounded-xl px-3 py-2.5 text-sm text-foreground"
                  placeholder="0.00"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="decimal-pad"
                  value={addon.priceDollars}
                  onChangeText={(v) => update(idx, { priceDollars: v })}
                />
              </View>
              {addon.addonType === "donation" ? (
                <View className="flex-1">
                  <Text className="text-[11px] text-muted-foreground mb-1">
                    Minimum $
                  </Text>
                  <TextInput
                    className="bg-muted rounded-xl px-3 py-2.5 text-sm text-foreground"
                    placeholder="No floor"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="decimal-pad"
                    value={addon.minPriceDollars}
                    onChangeText={(v) => update(idx, { minPriceDollars: v })}
                  />
                </View>
              ) : null}
              <View className="flex-1">
                <Text className="text-[11px] text-muted-foreground mb-1">
                  Inventory
                </Text>
                <TextInput
                  className={`bg-muted rounded-xl px-3 py-2.5 text-sm text-foreground ${
                    supportsVariants && addon.variants.length > 0
                      ? "opacity-40"
                      : ""
                  }`}
                  placeholder="Unlimited"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  editable={!(supportsVariants && addon.variants.length > 0)}
                  value={addon.quantity}
                  onChangeText={(v) => update(idx, { quantity: v })}
                />
              </View>
            </View>
            {supportsVariants && addon.variants.length > 0 ? (
              <Text className="text-[11px] text-muted-foreground">
                Inventory is tracked per variant below.
              </Text>
            ) : null}

            <TextInput
              className="bg-muted rounded-xl px-3 py-2.5 text-xs text-foreground"
              placeholder="Description (optional)"
              placeholderTextColor={colors.mutedForeground}
              value={addon.description}
              onChangeText={(v) => update(idx, { description: v })}
            />

            {/* Binding mode */}
            <Text className="text-[11px] text-muted-foreground">Sold</Text>
            <View className="flex-row gap-1.5">
              {ADDON_BINDING_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={addon.bindingMode === o.value}
                  onPress={() => update(idx, { bindingMode: o.value })}
                />
              ))}
            </View>
            <Text className="text-[11px] text-muted-foreground">
              {
                ADDON_BINDING_OPTIONS.find((o) => o.value === addon.bindingMode)
                  ?.hint
              }
            </Text>

            {/* Per-tier eligibility (requires_tier_id) */}
            {tierOptions.length > 0 ? (
              <>
                <Text className="text-[11px] text-muted-foreground">
                  Who can buy it
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  <Chip
                    label="Anyone"
                    selected={addon.requiresTierId == null}
                    onPress={() => update(idx, { requiresTierId: null })}
                  />
                  {tierOptions.map((tier) => (
                    <Chip
                      key={tier.id}
                      label={`${tier.name || "Untitled tier"} only`}
                      selected={addon.requiresTierId === tier.id}
                      onPress={() => update(idx, { requiresTierId: tier.id })}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* Redeemable at door */}
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] text-foreground flex-1 mr-3">
                Scanned at the door (gets its own QR)
              </Text>
              <Switch
                value={addon.isRedeemable}
                onValueChange={(v) => update(idx, { isRedeemable: v })}
              />
            </View>

            {/* Variant matrix — merch size × color */}
            {supportsVariants ? (
              <View className="gap-1.5">
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Variants (size × color)
                </Text>
                {addon.variants.map((row, ri) => (
                  <View
                    key={`variant-${ri}`}
                    className="flex-row items-center gap-2"
                  >
                    <TextInput
                      className="w-16 bg-muted rounded-lg px-2 py-2 text-sm text-foreground"
                      placeholder="Size"
                      placeholderTextColor={colors.mutedForeground}
                      value={row.size}
                      onChangeText={(v) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, size: v } : r,
                          ),
                        })
                      }
                    />
                    <TextInput
                      className="w-20 bg-muted rounded-lg px-2 py-2 text-sm text-foreground"
                      placeholder="Color"
                      placeholderTextColor={colors.mutedForeground}
                      value={row.color}
                      onChangeText={(v) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, color: v } : r,
                          ),
                        })
                      }
                    />
                    <TextInput
                      className="w-16 bg-muted rounded-lg px-2 py-2 text-sm text-foreground"
                      placeholder="$ base"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="decimal-pad"
                      value={row.priceDollars}
                      onChangeText={(v) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, priceDollars: v } : r,
                          ),
                        })
                      }
                    />
                    <TextInput
                      className="w-14 bg-muted rounded-lg px-2 py-2 text-sm text-foreground"
                      placeholder="Qty"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="number-pad"
                      value={row.quantity}
                      onChangeText={(v) =>
                        update(idx, {
                          variants: addon.variants.map((r, i) =>
                            i === ri ? { ...r, quantity: v } : r,
                          ),
                        })
                      }
                    />
                    <Text
                      className="flex-1 text-[11px] text-muted-foreground"
                      numberOfLines={1}
                    >
                      {variantDisplayName(row.size, row.color) || "—"}
                    </Text>
                    <Pressable
                      onPress={() =>
                        update(idx, {
                          variants: addon.variants.filter((_, i) => i !== ri),
                        })
                      }
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Remove variant"
                    >
                      <X size={13} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  onPress={() =>
                    update(idx, {
                      variants: [...addon.variants, newVariantRow()],
                    })
                  }
                  accessibilityRole="button"
                >
                  <Text className="text-[11px] font-semibold text-muted-foreground">
                    + Add size / color
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Status */}
            <Text className="text-[11px] text-muted-foreground">Status</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {ADDON_STATUS_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={addon.status === o.value}
                  onPress={() => update(idx, { status: o.value })}
                />
              ))}
            </View>
          </View>
        );
      })}

      <Pressable
        onPress={() => onChange([...addons, newDraftAddon()])}
        accessibilityRole="button"
        className="flex-row items-center justify-center gap-2 bg-card rounded-2xl p-4 border border-dashed border-border"
      >
        <Plus size={16} color={colors.primary} />
        <Text className="text-sm font-semibold text-primary">
          {addons.length === 0 ? "Add an Add-on" : "Add Another Add-on"}
        </Text>
      </Pressable>
    </View>
  );
}

export default AddonsEditorNative;
