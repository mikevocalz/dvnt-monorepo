/**
 * Membership / paywall screen — NATIVE fork (iOS / Android).
 *
 * Unlike the web fork (which starts Stripe checkout on /pricing), this screen
 * SELLS via IAP: RevenueCat packages from the `default` offering, one per paid
 * dvnt_membership tier. The billing seam is injected by the apps/mobile route
 * file (see ./billing.ts) — without it the screen degrades to read-only tier
 * cards.
 *
 * I3: entitlement display state comes from Supabase via useEntitlements only.
 * A successful store purchase does NOT flip the UI directly — we invalidate
 * the entitlements query and show an "activating…" state until the RC webhook
 * lands the membership_subscriptions row and the resolver reports the plan.
 *
 * Cross-rail states (WS-3, from the DB row's `rail` column):
 *  - web_stripe active     → current plan + "manage on the web" (no IAP buys;
 *                            neutral copy, no pricing/link-out on iOS —
 *                            Android may link to web billing).
 *  - other store's rail    → informational "Subscribed via App Store / Google
 *                            Play" (no buys — no duplicate-purchase footgun).
 *  - own store's rail      → current tier + tier change via purchase (RC
 *                            handles upgrade/downgrade; Play gets the old
 *                            product id for proration) + manage-subscription
 *                            link into the store.
 */
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useCallback, useEffect, useMemo } from "react";
import Animated from "react-native-reanimated";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Crown, Globe, Store } from "lucide-react-native";
import {
  useEntitlements,
  ENTITLEMENTS_QUERY_KEY,
  type MembershipRail,
} from "@dvnt/app/lib/subscription/use-entitlements";
import {
  PLANS,
  MEMBERSHIP_PLAN_KEYS,
  PLAN_RANK,
  isSubscriptionActive,
  planKeyFromRCProductId,
  type PlanKey,
} from "@dvnt/app/lib/subscription";
import type {
  MembershipBilling,
  RCPackageLike,
  OfferingsResultLike,
} from "./billing";
import { offeringsUnavailableCopy } from "./billing";
import { useMembershipPurchaseStore } from "./membership-purchase-store";

const C = {
  bg: "#02030A",
  card: "rgba(18,20,30,0.92)",
  border: "rgba(255,255,255,0.12)",
  text: "#FAFAF9",
  muted: "rgba(231,229,228,0.66)",
  cyan: "#3FDCFF",
  magenta: "#FF5BFC",
  purple: "#8A40CF",
};

const WEB_BASE =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any)?.process?.env?.EXPO_PUBLIC_WEB_URL as string) ||
  "https://dvntapp.live";

const ANDROID_PACKAGE = "com.dvnt.app";

function fallbackPrice(cents: number) {
  if (cents === 0) return "$0";
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}

/** The store this build can sell through. */
const OWN_RAIL: MembershipRail = Platform.OS === "ios" ? "ios_iap" : "play_iap";
const OWN_STORE_NAME = Platform.OS === "ios" ? "the App Store" : "Google Play";

/** Documented store subscription-management URLs. */
function openStoreSubscriptions(sku?: string | null) {
  if (Platform.OS === "ios") {
    // itms-apps opens the Subscriptions sheet directly; https is the fallback.
    Linking.openURL("itms-apps://apps.apple.com/account/subscriptions").catch(
      () =>
        Linking.openURL("https://apps.apple.com/account/subscriptions").catch(
          () => {},
        ),
    );
    return;
  }
  const url = sku
    ? `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(
        sku,
      )}&package=${ANDROID_PACKAGE}`
    : "https://play.google.com/store/account/subscriptions";
  Linking.openURL(url).catch(() => {});
}

export interface MembershipScreenProps {
  /** Injected by the apps/mobile route file. Absent → read-only tier cards. */
  billing?: MembershipBilling | null;
}

export function MembershipScreen({ billing = null }: MembershipScreenProps) {
  const { entitlements, records, isLoading } = useEntitlements();
  const queryClient = useQueryClient();
  const currentKey = entitlements.planKey;

  const purchasingPlanKey = useMembershipPurchaseStore(
    (s) => s.purchasingPlanKey,
  );
  const activatingPlanKey = useMembershipPurchaseStore(
    (s) => s.activatingPlanKey,
  );
  const restoring = useMembershipPurchaseStore((s) => s.restoring);
  const purchaseError = useMembershipPurchaseStore((s) => s.error);

  // ── Cross-rail resolution (WS-3): which rail owns the active membership? ──
  const activeMembership = useMemo(
    () =>
      records
        .filter(
          (r) => r.productFamily === "dvnt_membership" && isSubscriptionActive(r),
        )
        .sort((a, b) => PLAN_RANK[b.planKey] - PLAN_RANK[a.planKey])[0] ?? null,
    [records],
  );
  const activeRail: MembershipRail | null = activeMembership?.rail ?? null;
  const webRailActive = activeRail === "web_stripe";
  const ownStoreActive = activeRail === OWN_RAIL;
  const crossStoreActive = activeRail !== null && !webRailActive && !ownStoreActive;
  // IAP buy buttons render only when nothing blocks them: fresh subscriber, or
  // tier change on the store this build sells through.
  const canSell = !!billing && (activeRail === null || ownStoreActive);

  // ── RC catalog (server state → TanStack). Prices only — never entitlement.
  const packagesQuery = useQuery({
    queryKey: ["rc-membership-packages"],
    enabled: !!billing,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const b = billing as MembershipBilling;
      // Prefer the reason-preserving fetch so an empty paywall can say WHY.
      if (b.getMembershipOfferings) return b.getMembershipOfferings();
      const packages = await b.getMembershipPackages();
      return { status: "ok", packages } as OfferingsResultLike;
    },
  });

  const offerings = packagesQuery.data;
  /** Set only when the store came back with nothing to sell. */
  const unavailableReason =
    offerings && offerings.status === "unavailable" ? offerings.reason : null;
  const packageByPlan = useMemo(() => {
    const map: Partial<Record<PlanKey, RCPackageLike>> = {};
    for (const pkg of offerings?.status === "ok" ? offerings.packages : []) {
      const key = planKeyFromRCProductId(pkg.product.identifier);
      if (key) map[key] = pkg;
    }
    return map;
  }, [offerings]);

  // ── Activation watch: the webhook closes the loop, we just poll the ONE
  // read path until the purchased plan shows up.
  useEffect(() => {
    if (!activatingPlanKey) return;
    if (currentKey === activatingPlanKey) {
      useMembershipPurchaseStore.getState().activationConfirmed();
      return;
    }
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: ENTITLEMENTS_QUERY_KEY,
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [activatingPlanKey, currentKey, queryClient]);

  const onBuy = useCallback(
    async (planKey: PlanKey) => {
      const pkg = packageByPlan[planKey];
      if (!billing || !pkg) return;
      const store = useMembershipPurchaseStore.getState();
      if (store.purchasingPlanKey || store.restoring) return;
      store.startPurchase(planKey);
      // Play tier change: pass the owned base product id so Google prorates a
      // plan switch instead of stacking a second subscription.
      const googleOldProductId =
        Platform.OS === "android" && ownStoreActive
          ? (PLANS[currentKey].revenueCatProductId ?? null)
          : null;
      const res = await billing.purchaseMembershipPackage(pkg, {
        googleOldProductId,
      });
      if (res.ok) {
        store.purchaseSucceeded(planKey);
        void queryClient.invalidateQueries({
          queryKey: ENTITLEMENTS_QUERY_KEY,
        });
      } else if (res.userCancelled) {
        store.purchaseCancelled();
      } else {
        store.purchaseFailed(res.error ?? "Purchase failed. Please try again.");
      }
    },
    [billing, packageByPlan, ownStoreActive, currentKey, queryClient],
  );

  const onRestore = useCallback(async () => {
    if (!billing) return;
    const store = useMembershipPurchaseStore.getState();
    if (store.restoring || store.purchasingPlanKey) return;
    store.setRestoring(true);
    const res = await billing.restoreMembershipPurchases();
    store.setRestoring(false);
    if (!res.ok && res.error) store.purchaseFailed(res.error);
    // Any restored entitlement lands via the RC webhook → DB — refetch it.
    void queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
  }, [billing, queryClient]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Animated.Text style={styles.kicker}>DVNT Membership</Animated.Text>
      <Animated.Text style={styles.title}>
        REAL PEOPLE. REAL CONNECTIONS.
      </Animated.Text>
      <Animated.Text style={styles.sub}>
        Unlock the best of our app and events. Every membership includes Sneaky
        Lynk access.
      </Animated.Text>

      {/* Current plan banner */}
      <View style={styles.currentBanner}>
        <Crown size={18} color={C.magenta} />
        <Animated.Text style={styles.currentText}>
          {isLoading
            ? "Checking your plan…"
            : `You're on ${PLANS[currentKey].name}`}
        </Animated.Text>
      </View>

      {/* Activating: purchase done on the store, webhook row in flight */}
      {activatingPlanKey ? (
        <View style={styles.activatingBanner}>
          <ActivityIndicator size="small" color={C.cyan} />
          <Animated.Text style={styles.activatingText}>
            Activating {PLANS[activatingPlanKey].name}… this usually takes a few
            seconds.
          </Animated.Text>
        </View>
      ) : null}

      {/* Purchase error */}
      {purchaseError ? (
        <Pressable
          onPress={() => useMembershipPurchaseStore.getState().clearError()}
          style={styles.errorBanner}
          accessibilityRole="button"
        >
          <Animated.Text style={styles.errorText}>
            {purchaseError} Tap to dismiss.
          </Animated.Text>
        </Pressable>
      ) : null}

      {/* Cross-rail states (WS-3) */}
      {webRailActive ? (
        <View style={styles.railBanner}>
          <Globe size={18} color={C.cyan} />
          <View style={styles.railBody}>
            <Animated.Text style={styles.railTitle}>
              Your membership is managed on the web
            </Animated.Text>
            <Animated.Text style={styles.railText}>
              Plan changes and billing for this membership are handled from your
              account on the web.
            </Animated.Text>
            {Platform.OS === "android" ? (
              <Pressable
                onPress={() =>
                  Linking.openURL(`${WEB_BASE}/settings/membership`).catch(
                    () => {},
                  )
                }
                style={styles.railLink}
                accessibilityRole="button"
              >
                <Animated.Text style={styles.railLinkText}>
                  Open web billing
                </Animated.Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {crossStoreActive ? (
        <View style={styles.railBanner}>
          <Store size={18} color={C.cyan} />
          <View style={styles.railBody}>
            <Animated.Text style={styles.railTitle}>
              Subscribed via{" "}
              {activeRail === "ios_iap" ? "the App Store" : "Google Play"}
            </Animated.Text>
            <Animated.Text style={styles.railText}>
              This membership is billed through{" "}
              {activeRail === "ios_iap" ? "Apple" : "Google"} on another
              platform. Manage it from the device where you subscribed.
            </Animated.Text>
          </View>
        </View>
      ) : null}

      {ownStoreActive ? (
        <View style={styles.railBanner}>
          <Store size={18} color={C.cyan} />
          <View style={styles.railBody}>
            <Animated.Text style={styles.railTitle}>
              Subscribed via {OWN_STORE_NAME}
            </Animated.Text>
            <Animated.Text style={styles.railText}>
              Pick a different tier below to switch plans, or manage renewal and
              cancellation in {OWN_STORE_NAME}.
            </Animated.Text>
            <Pressable
              onPress={() =>
                openStoreSubscriptions(PLANS[currentKey].revenueCatProductId)
              }
              style={styles.railLink}
              accessibilityRole="button"
            >
              <Animated.Text style={styles.railLinkText}>
                Manage subscription
              </Animated.Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {MEMBERSHIP_PLAN_KEYS.map((key) => {
        const p = PLANS[key];
        const isCurrent = key === currentKey;
        const pkg = packageByPlan[key];
        // Store price when the catalog is loaded; plans.ts fallback otherwise.
        const priceLabel = pkg?.product.priceString ?? fallbackPrice(p.priceCents);
        const isPurchasable = canSell && key !== "free" && !isCurrent && !!pkg;
        // Would we sell this plan if the catalog had loaded? Drives the
        // disabled-CTA fallback below.
        const sellableInPrinciple = canSell && key !== "free" && !isCurrent;
        const ctaUnavailableLabel = unavailableReason
          ? offeringsUnavailableCopy(unavailableReason)
          : "Not available right now";
        const isPurchasing = purchasingPlanKey === key;
        return (
          <View
            key={key}
            style={[
              styles.card,
              p.recommended && styles.cardRec,
              isCurrent && styles.cardCurrent,
            ]}
          >
            <View style={styles.cardHead}>
              <Animated.Text style={styles.planName}>{p.name}</Animated.Text>
              {p.recommended ? (
                <Animated.Text style={styles.badge}>Most Popular</Animated.Text>
              ) : null}
              {isCurrent ? (
                <Animated.Text style={styles.current}>Current</Animated.Text>
              ) : null}
            </View>
            <View style={styles.priceRow}>
              <Animated.Text style={styles.price}>{priceLabel}</Animated.Text>
              <Animated.Text style={styles.per}>/month</Animated.Text>
            </View>
            {p.positioning ? (
              <Animated.Text style={styles.pos}>{p.positioning}</Animated.Text>
            ) : null}

            {/* Same feature hierarchy as the web pricing page: Sneaky Lynk
                (cyan) then Events (magenta). */}
            <BulletGroup label="Sneaky Lynk" items={p.bullets.sneaky} accent={C.cyan} />
            <BulletGroup label="Events" items={p.bullets.events} accent={C.magenta} />

            {isPurchasable ? (
              <Pressable
                onPress={() => onBuy(key)}
                disabled={isPurchasing || !!purchasingPlanKey || restoring}
                style={[
                  styles.cta,
                  p.recommended && styles.ctaRec,
                  (!!purchasingPlanKey || restoring) && styles.ctaDisabled,
                ]}
                accessibilityRole="button"
              >
                {isPurchasing ? (
                  <ActivityIndicator size="small" color="#0A0118" />
                ) : (
                  <Animated.Text style={styles.ctaText}>
                    {ownStoreActive
                      ? `Switch to ${p.name}`
                      : p.recommended
                        ? "Get VIP"
                        : "Become a member"}
                  </Animated.Text>
                )}
              </Pressable>
            ) : sellableInPrinciple ? (
              /* A priced card with NO button reads as half-built. When the
                 catalog is empty we still render the CTA — disabled, with the
                 reason — so the state is legible instead of looking broken. */
              <View
                style={[styles.cta, styles.ctaDisabled]}
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                accessibilityLabel={`${p.name} unavailable: ${ctaUnavailableLabel}`}
              >
                <Animated.Text style={styles.ctaText}>
                  {ctaUnavailableLabel}
                </Animated.Text>
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Restore Purchases — Apple-required affordance. */}
      {billing ? (
        <Pressable
          onPress={onRestore}
          disabled={restoring || !!purchasingPlanKey}
          style={styles.restore}
          accessibilityRole="button"
        >
          {restoring ? (
            <ActivityIndicator size="small" color={C.cyan} />
          ) : (
            <Animated.Text style={styles.restoreText}>
              Restore Purchases
            </Animated.Text>
          )}
        </Pressable>
      ) : null}

      <Animated.Text style={styles.fineprint}>
        Subscriptions renew monthly through{" "}
        {Platform.OS === "ios" ? "your Apple ID" : "your Google account"} and
        can be cancelled anytime in {OWN_STORE_NAME}. Your membership works
        everywhere you use DVNT.
      </Animated.Text>
    </ScrollView>
  );
}

function BulletGroup({
  label,
  items,
  accent,
}: {
  label: string;
  items: string[];
  accent: string;
}) {
  if (!items.length) return null;
  return (
    <View style={styles.bullets}>
      <Animated.Text style={[styles.bulletLabel, { color: accent }]}>
        {label}
      </Animated.Text>
      {items.map((b) => (
        <View key={b} style={styles.bulletRow}>
          <Check size={15} color={accent} />
          <Animated.Text style={styles.bulletText}>{b}</Animated.Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingBottom: 60, gap: 12 },
  kicker: {
    color: C.cyan,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  title: {
    color: C.text,
    fontFamily: "Republica-Minor",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 6,
  },
  sub: { color: C.muted, fontSize: 15, lineHeight: 22, marginTop: 4 },
  currentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,91,252,0.1)",
    borderColor: "rgba(255,91,252,0.3)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  currentText: { color: C.text, fontWeight: "700", fontSize: 15 },
  activatingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(63,220,255,0.08)",
    borderColor: "rgba(63,220,255,0.3)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  activatingText: { color: C.text, fontSize: 14, lineHeight: 20, flex: 1 },
  errorBanner: {
    backgroundColor: "rgba(252,37,58,0.1)",
    borderColor: "rgba(252,37,58,0.35)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  errorText: { color: C.text, fontSize: 14, lineHeight: 20 },
  railBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(63,220,255,0.06)",
    borderColor: "rgba(63,220,255,0.25)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  railBody: { flex: 1, gap: 4 },
  railTitle: { color: C.text, fontWeight: "700", fontSize: 15 },
  railText: { color: C.muted, fontSize: 13, lineHeight: 19 },
  railLink: { marginTop: 8, alignSelf: "flex-start" },
  railLinkText: {
    color: C.cyan,
    fontWeight: "700",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    padding: 18,
    marginTop: 4,
  },
  cardRec: { borderColor: C.magenta },
  cardCurrent: { borderColor: C.cyan },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  planName: {
    color: C.text,
    fontFamily: "Republica-Minor",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  badge: {
    color: "#0A0118",
    backgroundColor: C.magenta,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  current: {
    color: C.cyan,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 8 },
  price: { color: C.text, fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  per: { color: C.muted, fontSize: 13 },
  pos: { color: C.muted, fontSize: 14, marginTop: 6 },
  bullets: { gap: 7, marginTop: 14 },
  bulletLabel: {
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bulletText: { color: "rgba(245,245,244,0.82)", fontSize: 14, lineHeight: 20, flex: 1 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: C.purple,
    minHeight: 44,
  },
  ctaRec: { backgroundColor: C.magenta },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: "#0A0118", fontWeight: "800", fontSize: 14 },
  restore: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    minHeight: 44,
  },
  restoreText: {
    color: C.cyan,
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.5,
  },
  fineprint: { color: "rgba(231,229,228,0.5)", fontSize: 12, lineHeight: 18, marginTop: 2 },
});
