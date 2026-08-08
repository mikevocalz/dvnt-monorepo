import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { toast } from "sonner-native";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CreditCard,
  Minus,
  Plus,
  Shirt,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
} from "lucide-react-native";
import { LegendList, type LegendListRenderItemProps } from "@dvnt/app/components/list";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import type { CartLineItem, LineItemCategory } from "@dvnt/app/lib/contracts/dto";
import { calculateCartSubtotalCents } from "@dvnt/app/lib/contracts/invariants";
import { useMixedCartCheckout } from "@dvnt/app/lib/hooks/use-mixed-cart-checkout";
import { computeFees, formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import { addonsApi, type AddonRecord } from "@dvnt/app/lib/api/addons";
import {
  effectiveAddonUnitPriceCents,
  filterEligibleAddons,
} from "@dvnt/app/lib/tickets/pricing";

type ReviewListItem =
  | { type: "header"; key: string; category: LineItemCategory; title: string }
  | { type: "line"; key: string; lineItem: CartLineItem };

const CATEGORY_LABELS: Record<LineItemCategory, string> = {
  admission: "Admission",
  coat_check: "Coat Check",
  product: "Merch",
  service: "Service",
  addon: "Add-on",
};

function metadataText(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function categoryIcon(category: LineItemCategory, color: string) {
  if (category === "coat_check") return <Shirt size={18} color={color} />;
  if (category === "addon" || category === "product" || category === "service")
    return <Sparkles size={18} color={color} />;
  return <Ticket size={18} color={color} />;
}

function buildReviewItems(lineItems: CartLineItem[]): ReviewListItem[] {
  // Add-on lines (WS-3) render in their own group after tickets; legacy
  // product/service coarse add-ons keep rendering too.
  const categories: LineItemCategory[] = [
    "admission",
    "coat_check",
    "product",
    "service",
    "addon",
  ];

  return categories.flatMap((category) => {
    const lines = lineItems.filter(
      (lineItem) => lineItem.category === category,
    );
    if (lines.length === 0) return [];

    return [
      {
        type: "header" as const,
        key: `header-${category}`,
        category,
        title: CATEGORY_LABELS[category],
      },
      ...lines.map((lineItem) => ({
        type: "line" as const,
        key: lineItem.lineItemId,
        lineItem,
      })),
    ];
  });
}

function CategoryHeader({
  item,
}: {
  item: Extract<ReviewListItem, { type: "header" }>;
}) {
  return (
    <View style={styles.categoryHeader}>
      {categoryIcon(item.category, "#A78BFA")}
      <Text style={styles.categoryTitle}>{item.title}</Text>
    </View>
  );
}

function LineItemRow({
  lineItem,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  lineItem: CartLineItem;
  onIncrement: (lineItem: CartLineItem) => void;
  onDecrement: (lineItem: CartLineItem) => void;
  onRemove: (lineItem: CartLineItem) => void;
}) {
  const title = metadataText(
    lineItem.metadata,
    ["tierName", "name", "title"],
    CATEGORY_LABELS[lineItem.category],
  );
  const eventTitle = metadataText(lineItem.metadata, ["eventTitle"], "");
  const lineTotalCents = lineItem.unitPriceCents * lineItem.quantity;

  return (
    <View style={styles.lineItem}>
      <View style={styles.lineIcon}>
        {categoryIcon(lineItem.category, "#F8FAFC")}
      </View>

      <View style={styles.lineBody}>
        <Text style={styles.lineTitle} numberOfLines={1}>
          {title}
        </Text>
        {eventTitle ? (
          <Text style={styles.lineSubtitle} numberOfLines={1}>
            {eventTitle}
          </Text>
        ) : null}
        <Text style={styles.lineMeta}>
          {formatCents(lineItem.unitPriceCents)} each
        </Text>
      </View>

      <View style={styles.lineActions}>
        <View style={styles.quantityControl}>
          <Pressable
            onPress={() => onDecrement(lineItem)}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${title} quantity`}
            style={[
              styles.quantityButton,
              lineItem.quantity <= 1 && styles.quantityButtonDisabled,
            ]}
          >
            <Minus
              size={15}
              color={lineItem.quantity <= 1 ? "#64748B" : "#F8FAFC"}
            />
          </Pressable>
          <Text style={styles.quantityText}>{lineItem.quantity}</Text>
          <Pressable
            onPress={() => onIncrement(lineItem)}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${title} quantity`}
            style={styles.quantityButton}
          >
            <Plus size={15} color="#F8FAFC" />
          </Pressable>
        </View>

        <View style={styles.lineAmountRow}>
          <Text style={styles.lineAmount}>{formatCents(lineTotalCents)}</Text>
          <Pressable
            onPress={() => onRemove(lineItem)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${title}`}
            hitSlop={10}
            style={styles.removeButton}
          >
            <Trash2 size={16} color="#F87171" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Review-screen add-on upsell (WS-3): eligible add-ons not yet in the cart get
 * a one-tap "Add" that writes a cart line item directly (quantity edits happen
 * on the normal line rows). Eligibility mirrors cart_create_hold — on-sale,
 * in-stock, requires_tier satisfied by a tier already in this cart. Prices are
 * preview; the hold RPC reprices server-side.
 */
function AddonUpsellSection({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const cart = useCartStore((state) => state.cart);
  const addLineItem = useCartStore((state) => state.addLineItem);
  const { data: addons = [] } = useQuery<AddonRecord[]>({
    queryKey: ["event-addons", eventId],
    enabled: !!eventId,
    staleTime: 60 * 1000,
    queryFn: () => addonsApi.getByEvent(eventId),
  });

  const lineItems = cart?.lineItems ?? [];
  const selectedTierIds = new Set(
    lineItems
      .filter((li) => li.category !== "addon")
      .map((li) => String(li.tierId)),
  );
  const inCart = new Set(
    lineItems
      .filter((li) => li.category === "addon")
      .map((li) =>
        li.variantId ? `${li.addonId}:${li.variantId}` : String(li.addonId),
      ),
  );

  const rows: Array<{
    key: string;
    addon: AddonRecord;
    variantId: string | null;
    label: string;
    sub: string | null;
    priceCents: number;
  }> = [];
  for (const addon of filterEligibleAddons(addons, selectedTierIds)) {
    if (addon.has_variants) {
      for (const variant of addon.ticket_addon_variants ?? []) {
        if (inCart.has(`${addon.id}:${variant.id}`)) continue;
        rows.push({
          key: `${addon.id}:${variant.id}`,
          addon,
          variantId: variant.id,
          label: `${addon.name} · ${variant.name}`,
          sub: null,
          priceCents: effectiveAddonUnitPriceCents(
            addon.price_cents,
            variant.price_cents,
          ),
        });
      }
    } else if (!inCart.has(addon.id)) {
      rows.push({
        key: addon.id,
        addon,
        variantId: null,
        label: addon.name,
        sub: addon.description,
        priceCents: addon.price_cents,
      });
    }
  }
  if (rows.length === 0) return null;

  const add = (addon: AddonRecord, variantId: string | null) => {
    const variant = variantId
      ? addon.ticket_addon_variants?.find((v) => v.id === variantId)
      : null;
    addLineItem(eventId, {
      category: "addon",
      // DTO back-compat: addon id rides tierId on addon lines.
      tierId: addon.id,
      addonId: addon.id,
      variantId: variantId ?? undefined,
      quantity: 1,
      unitPriceCents: effectiveAddonUnitPriceCents(
        addon.price_cents,
        variant?.price_cents,
      ),
      metadata: {
        name: variant ? `${addon.name} — ${variant.name}` : addon.name,
        eventTitle,
      },
    });
  };

  return (
    <View style={upsellStyles.wrap}>
      <View style={upsellStyles.header}>
        <Sparkles size={13} color="#FF5BFC" />
        <Text style={upsellStyles.eyebrow}>Before you pay</Text>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={upsellStyles.row}>
          <View style={upsellStyles.rowBody}>
            <Text style={upsellStyles.rowTitle} numberOfLines={1}>
              {row.label}
            </Text>
            {row.sub ? (
              <Text style={upsellStyles.rowSub} numberOfLines={1}>
                {row.sub}
              </Text>
            ) : null}
          </View>
          <Text style={upsellStyles.rowPrice}>
            {formatCents(row.priceCents)}
          </Text>
          <Pressable
            onPress={() => add(row.addon, row.variantId)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${row.label}`}
            style={({ pressed }) => [
              upsellStyles.addButton,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={upsellStyles.addButtonText}>Add</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export default function CartReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cart = useCartStore((state) => state.cart);
  const updateLineItemQuantity = useCartStore(
    (state) => state.updateLineItemQuantity,
  );
  const removeLineItem = useCartStore((state) => state.removeLineItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const { checkout, isLoading } = useMixedCartCheckout();

  const lineItems = cart?.lineItems ?? [];
  const reviewItems = useMemo(() => buildReviewItems(lineItems), [lineItems]);
  const subtotalCents = useMemo(
    () => calculateCartSubtotalCents(lineItems),
    [lineItems],
  );
  const quantity = useMemo(
    () => lineItems.reduce((sum, lineItem) => sum + lineItem.quantity, 0),
    [lineItems],
  );
  const fees = useMemo(
    () =>
      quantity > 0
        ? computeFees(subtotalCents, quantity)
        : {
            buyer_fee: 0,
            customer_charge_amount: 0,
          },
    [quantity, subtotalCents],
  );

  const handleIncrement = useCallback(
    (lineItem: CartLineItem) => {
      updateLineItemQuantity(lineItem.lineItemId, lineItem.quantity + 1);
    },
    [updateLineItemQuantity],
  );

  const handleDecrement = useCallback(
    (lineItem: CartLineItem) => {
      if (lineItem.quantity <= 1) {
        toast.info("Use remove to delete this item");
        return;
      }
      updateLineItemQuantity(lineItem.lineItemId, lineItem.quantity - 1);
    },
    [updateLineItemQuantity],
  );

  const handleRemove = useCallback(
    (lineItem: CartLineItem) => {
      removeLineItem(lineItem.lineItemId);
      toast.success("Removed from cart");
    },
    [removeLineItem],
  );

  const handleClearCart = useCallback(() => {
    clearCart();
    toast.success("Cart cleared");
  }, [clearCart]);

  const handleContinue = useCallback(() => {
    if (!cart || lineItems.length === 0) {
      toast.error("Your cart is empty");
      return;
    }

    AppTrace.trace("CART", "cart_review_continue_pressed", {
      cartId: cart.cartId,
      lineItems: lineItems.length,
      totalCents: fees.customer_charge_amount,
    });
    checkout();
  }, [cart, checkout, fees.customer_charge_amount, lineItems.length]);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ReviewListItem>) => {
      if (item.type === "header") return <CategoryHeader item={item} />;

      return (
        <LineItemRow
          lineItem={item.lineItem}
          onIncrement={handleIncrement}
          onDecrement={handleDecrement}
          onRemove={handleRemove}
        />
      );
    },
    [handleDecrement, handleIncrement, handleRemove],
  );

  const holdLabel =
    cart?.holdExpiresAt && cart.holdExpiresAt > Date.now()
      ? `Reserved until ${new Date(cart.holdExpiresAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}`
      : "No active hold";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.headerButton}
        >
          <ArrowLeft size={22} color="#F8FAFC" />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Review Cart</Text>
          <Text style={styles.headerSubtitle}>{holdLabel}</Text>
        </View>
        <Pressable
          onPress={handleClearCart}
          accessibilityRole="button"
          accessibilityLabel="Clear cart"
          disabled={lineItems.length === 0}
          style={[
            styles.headerButton,
            lineItems.length === 0 && styles.headerButtonDisabled,
          ]}
        >
          <Trash2
            size={19}
            color={lineItems.length === 0 ? "#475569" : "#F87171"}
          />
        </Pressable>
      </View>

      {lineItems.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={34} color="#A78BFA" />
          </View>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>
            Add admission tickets or coat-check passes from an event.
          </Text>
        </View>
      ) : (
        <LegendList
          data={reviewItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          estimatedItemSize={96}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            cart?.eventId ? (
              <AddonUpsellSection
                eventId={cart.eventId}
                eventTitle={metadataText(
                  lineItems[0]?.metadata,
                  ["eventTitle"],
                  "",
                )}
              />
            ) : null
          }
        />
      )}

      <View
        style={[styles.summary, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatCents(subtotalCents)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>DVNT Service Fee</Text>
          <Text style={styles.summaryValue}>{formatCents(fees.buyer_fee)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Tax</Text>
          <Text style={styles.summaryValue}>{formatCents(0)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatCents(fees.customer_charge_amount)}
          </Text>
        </View>

        <Pressable
          onPress={handleContinue}
          accessibilityRole="button"
          disabled={lineItems.length === 0 || isLoading}
          style={[
            styles.continueButton,
            (lineItems.length === 0 || isLoading) &&
              styles.continueButtonDisabled,
          ]}
        >
          <CreditCard size={18} color="#FFFFFF" />
          <Text style={styles.continueText}>
            {isLoading ? "Opening Payment..." : "Continue to Payment"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const upsellStyles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  eyebrow: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderCurve: "continuous",
    backgroundColor: "#111113",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "800",
  },
  rowSub: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  rowPrice: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  addButton: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(63,220,255,0.4)",
    backgroundColor: "rgba(63,220,255,0.1)",
  },
  addButtonText: {
    color: "#3FDCFF",
    fontSize: 12,
    fontWeight: "800",
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050505",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  headerButtonDisabled: {
    opacity: 0.45,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 220,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 12,
    paddingBottom: 8,
  },
  categoryTitle: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  lineItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: "#111113",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  lineIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(167,139,250,0.16)",
  },
  lineBody: {
    flex: 1,
    minWidth: 0,
  },
  lineTitle: {
    color: "#F8FAFC",
    fontSize: 15,
    fontWeight: "800",
  },
  lineSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  lineMeta: {
    color: "#64748B",
    fontSize: 12,
    marginTop: 4,
  },
  lineActions: {
    alignItems: "flex-end",
    gap: 10,
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  quantityButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  quantityButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  quantityText: {
    color: "#F8FAFC",
    minWidth: 20,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
  },
  lineAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  lineAmount: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "800",
  },
  removeButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(167,139,250,0.14)",
    marginBottom: 18,
  },
  emptyTitle: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "800",
  },
  emptyText: {
    color: "#94A3B8",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  summary: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: "#0A0A0B",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  summaryLabel: {
    color: "#94A3B8",
    fontSize: 13,
  },
  summaryValue: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginVertical: 8,
  },
  totalLabel: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "900",
  },
  totalValue: {
    color: "#F8FAFC",
    fontSize: 20,
    fontWeight: "900",
  },
  continueButton: {
    height: 52,
    borderRadius: 8,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#8A40CF",
  },
  continueButtonDisabled: {
    opacity: 0.45,
  },
  continueText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
});
