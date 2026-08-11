/**
 * Sneaky Lynk Subscription Modal
 *
 * Shown when a host tries to create a room that exceeds their current plan.
 *
 * Two rails, one modal:
 *  - NATIVE (iOS + Android): sells the standalone Sneaky tiers
 *    (sneaky_tier_1 / sneaky_tier_2 from plans.ts) via RevenueCat IAP —
 *    offering lookup_key `sneaky`, fetched by key, NOT the current offering.
 *    Mirrors MembershipScreen.native's pattern: purchase → invalidate the
 *    entitlements query → "activating…" until the RC webhook lands the
 *    membership_subscriptions row (I3 — entitlement state is read from
 *    Supabase via useEntitlements only, never from the RC SDK). Purchase-flow
 *    state lives in useSneakyPurchaseStore (Zustand — no useState for
 *    business state). The billing seam (SneakyBilling) is injected by the
 *    apps/mobile route files; without it the tier cards render read-only.
 *  - WEB: unchanged legacy Stripe Billing checkout (`sneaky-billing-checkout`,
 *    host_25/host_50 vocabulary) — see StripeSubscriptionModal below.
 *
 * Replaces the one-time $2.99 SneakyPaywallModal for the HOST upgrade flow.
 */

import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  Linking,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import {
  Zap,
  X,
  Shield,
  Check,
  Users,
  Crown,
  ChevronRight,
  Circle,
  CircleDot,
  Globe,
  Store,
} from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import {
  useEntitlements,
  ENTITLEMENTS_QUERY_KEY,
  type MembershipRail,
} from "@dvnt/app/lib/subscription/use-entitlements";
import {
  PLANS,
  SNEAKY_PLAN_KEYS,
  PLAN_RANK,
  isSubscriptionActive,
  planKeyFromRCProductId,
  type PlanKey,
} from "@dvnt/app/lib/subscription";
import type {
  SneakyBilling,
  RCPackageLike,
  OfferingsResultLike,
} from "@dvnt/app/features/screens/membership/billing";
import { offeringsUnavailableCopy } from "@dvnt/app/features/screens/membership/billing";
import { useSneakyPurchaseStore } from "../stores/sneaky-purchase-store";
import { useSneakyLynkCaptureProtection } from "../hooks/useSneakyLynkCaptureProtection";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Plan {
  id: string;
  name: string;
  price: string;
  priceNote: string;
  maxParticipants: number;
  durationLabel: string;
  highlight: boolean;
  features: string[];
}

const STRIPE_PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    priceNote: "forever",
    maxParticipants: 5,
    durationLabel: "5 min / session",
    highlight: false,
    features: ["Up to 5 people per session", "5 minute session limit"],
  },
  {
    id: "host_25",
    name: "Host 15",
    price: "$15",
    priceNote: "/ month",
    maxParticipants: 15,
    durationLabel: "Unlimited duration",
    highlight: true,
    features: [
      "Up to 15 screens per session",
      "Unlimited duration",
      "Cancel anytime",
    ],
  },
  {
    id: "host_50",
    name: "Unlimited",
    price: "$25",
    priceNote: "/ month",
    maxParticipants: 999,
    durationLabel: "Unlimited duration",
    highlight: false,
    features: ["Unlimited screens", "Unlimited duration", "Cancel anytime"],
  },
];

interface SneakySubscriptionModalProps {
  visible: boolean;
  onClose: () => void;
  currentPlan?: string;
  reason?: "participant_limit" | "duration_limit" | "upgrade";
  dismissible?: boolean;
  onSubscribed?: (planId: string) => void;
  /** Native RC seam, injected by the apps/mobile route file. Absent →
   *  read-only tier cards (web / expo-go / dev builds without the pod). */
  billing?: SneakyBilling | null;
}

const REASON_TEXT: Record<
  NonNullable<SneakySubscriptionModalProps["reason"]>,
  string
> = {
  participant_limit: "Your current plan has reached its participant limit.",
  duration_limit: "Your session has reached its time limit for the free plan.",
  upgrade: "Upgrade to host bigger, longer sessions.",
};

export function SneakySubscriptionModal(props: SneakySubscriptionModalProps) {
  // WEB stays on the Stripe rail exactly as before; NATIVE sells via RC.
  if (Platform.OS === "web") {
    return <StripeSubscriptionModal {...props} />;
  }
  return <NativeSneakySubscriptionModal {...props} />;
}

// ── NATIVE (iOS + Android) — RevenueCat IAP ─────────────────────────────────

/** The store this build can sell through. */
const OWN_RAIL: MembershipRail = Platform.OS === "ios" ? "ios_iap" : "play_iap";
const OWN_STORE_NAME = Platform.OS === "ios" ? "the App Store" : "Google Play";

const WEB_BASE =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((globalThis as any)?.process?.env?.EXPO_PUBLIC_WEB_URL as string) ||
  "https://dvntapp.live";

function fallbackPrice(cents: number) {
  if (cents === 0) return "$0";
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}

function NativeSneakySubscriptionModal({
  visible,
  onClose,
  reason = "upgrade",
  dismissible = true,
  onSubscribed,
  billing = null,
}: SneakySubscriptionModalProps) {
  // Protect subscription tier/pricing information when visible
  useSneakyLynkCaptureProtection();

  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const queryClient = useQueryClient();
  const { entitlements, records, isLoading } = useEntitlements();
  const currentKey = entitlements.planKey;

  const purchasingPlanKey = useSneakyPurchaseStore((s) => s.purchasingPlanKey);
  const activatingPlanKey = useSneakyPurchaseStore((s) => s.activatingPlanKey);
  const restoring = useSneakyPurchaseStore((s) => s.restoring);
  const purchaseError = useSneakyPurchaseStore((s) => s.error);

  // ── Cross-rail resolution (WS-3): which rail owns the active paid row? ──
  // Both families block a duplicate sale — a DVNT membership already includes
  // Sneaky Lynk, and a web-rail sneaky sub must be managed on the web.
  const activePaid = useMemo(
    () =>
      records.filter(
        (r) => r.planKey !== "free" && isSubscriptionActive(r),
      ),
    [records],
  );
  // Legacy sneaky rows are normalized to web_stripe; a null rail is a
  // web-era row too — treat it as web-managed, never sellable-over.
  const webRailActive = activePaid.some(
    (r) => r.rail === "web_stripe" || r.rail === null,
  );
  const ownStoreSneaky = useMemo(
    () =>
      activePaid
        .filter(
          (r) => r.productFamily === "sneaky_lynk" && r.rail === OWN_RAIL,
        )
        .sort((a, b) => PLAN_RANK[b.planKey] - PLAN_RANK[a.planKey])[0] ??
      null,
    [activePaid],
  );
  const crossStoreActive = activePaid.some(
    (r) =>
      (r.rail === "ios_iap" || r.rail === "play_iap") && r !== ownStoreSneaky,
  );
  // Buy buttons render only for a fresh subscriber or an own-store sneaky
  // tier switch — never over a web-rail or other-store subscription.
  const canSell =
    !!billing && !isLoading && !webRailActive && !crossStoreActive;
  const currentSneakyKey: PlanKey | null = ownStoreSneaky?.planKey ?? null;

  // ── RC catalog (server state → TanStack). Prices only — never entitlement.
  const packagesQuery = useQuery({
    queryKey: ["rc-sneaky-packages"],
    enabled: !!billing && visible,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const b = billing as SneakyBilling;
      // Prefer the reason-preserving fetch so an empty paywall can say WHY.
      if (b.getSneakyOfferings) return b.getSneakyOfferings();
      const packages = await b.getSneakyPackages();
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
  // read path until the purchased plan shows up. onSubscribed rides a ref so
  // an inline-arrow prop (new identity every parent render — rooms re-render
  // constantly) can't keep resetting the 4s poll interval.
  const onSubscribedRef = useRef(onSubscribed);
  onSubscribedRef.current = onSubscribed;
  useEffect(() => {
    if (!activatingPlanKey) return;
    if (currentKey === activatingPlanKey) {
      useSneakyPurchaseStore.getState().activationConfirmed();
      onSubscribedRef.current?.(activatingPlanKey);
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
      const store = useSneakyPurchaseStore.getState();
      if (store.purchasingPlanKey || store.restoring) return;
      store.startPurchase(planKey);
      // Play tier change: pass the owned base product id so Google prorates a
      // plan switch instead of stacking a second subscription.
      const googleOldProductId =
        Platform.OS === "android" && currentSneakyKey
          ? (PLANS[currentSneakyKey].revenueCatProductId ?? null)
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
    [billing, packageByPlan, currentSneakyKey, queryClient],
  );

  const onRestore = useCallback(async () => {
    if (!billing) return;
    const store = useSneakyPurchaseStore.getState();
    if (store.restoring || store.purchasingPlanKey) return;
    store.setRestoring(true);
    const res = await billing.restoreMembershipPurchases();
    store.setRestoring(false);
    if (!res.ok && res.error) store.purchaseFailed(res.error);
    // Any restored entitlement lands via the RC webhook → DB — refetch it.
    void queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
  }, [billing, queryClient]);

  if (!visible) return null;

  const sheetMaxHeight = Math.max(420, height - insets.top - 36);
  const planListMaxHeight = Math.max(260, sheetMaxHeight - 168);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      className="absolute inset-0"
      style={{
        backgroundColor: "rgba(0,0,0,0.75)",
        zIndex: 20000,
        elevation: 20000,
      }}
    >
      <Pressable className="flex-1" onPress={dismissible ? onClose : undefined} />

      <Animated.View
        entering={FadeInUp.duration(300).springify().damping(18)}
        className="bg-card rounded-t-3xl px-5 pt-6"
        style={{
          maxHeight: sheetMaxHeight,
          paddingBottom: Math.max(24, insets.bottom + 18),
        }}
      >
        {dismissible ? (
          <Pressable
            onPress={onClose}
            hitSlop={12}
            className="absolute top-4 right-4 w-8 h-8 items-center justify-center rounded-full bg-muted"
          >
            <X size={16} color="#999" />
          </Pressable>
        ) : null}

        {/* Icon */}
        <View className="items-center mb-3">
          <View
            className="w-14 h-14 rounded-full items-center justify-center"
            style={{ backgroundColor: "#8A40CF20" }}
          >
            <Crown size={26} color="#8A40CF" />
          </View>
        </View>

        {/* Title + sub */}
        <Text className="text-xl font-sans-bold text-foreground text-center mb-1">
          Upgrade Your Plan
        </Text>
        <Text className="text-sm text-muted-foreground text-center mb-5 px-4">
          {REASON_TEXT[reason]}
        </Text>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: planListMaxHeight }}
          bounces={false}
          contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
        >
          {/* Activating: purchase done on the store, webhook row in flight */}
          {activatingPlanKey ? (
            <View
              className="flex-row items-center gap-3 rounded-2xl p-4"
              style={{
                backgroundColor: "rgba(63,220,255,0.08)",
                borderWidth: 1,
                borderColor: "rgba(63,220,255,0.3)",
              }}
            >
              <ActivityIndicator size="small" color="#3FDCFF" />
              <Text className="text-sm text-foreground flex-1">
                Activating {PLANS[activatingPlanKey].name}… this usually takes
                a few seconds.
              </Text>
            </View>
          ) : null}

          {/* Purchase error */}
          {purchaseError ? (
            <Pressable
              onPress={() => useSneakyPurchaseStore.getState().clearError()}
              className="rounded-2xl p-4"
              style={{
                backgroundColor: "rgba(252,37,58,0.1)",
                borderWidth: 1,
                borderColor: "rgba(252,37,58,0.35)",
              }}
            >
              <Text className="text-sm text-foreground">
                {purchaseError} Tap to dismiss.
              </Text>
            </Pressable>
          ) : null}

          {/* Cross-rail states (WS-3) */}
          {webRailActive ? (
            <View
              className="flex-row items-start gap-3 rounded-2xl p-4"
              style={{
                backgroundColor: "rgba(63,220,255,0.06)",
                borderWidth: 1,
                borderColor: "rgba(63,220,255,0.25)",
              }}
            >
              <Globe size={18} color="#3FDCFF" />
              <View className="flex-1 gap-1">
                <Text className="text-sm font-sans-bold text-foreground">
                  Your subscription is managed on the web
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Plan changes and billing are handled from your account on the
                  web.
                </Text>
                {Platform.OS === "android" ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        `${WEB_BASE}/feed/sneaky-lynk/billing`,
                      ).catch(() => {})
                    }
                    className="mt-1 self-start"
                    accessibilityRole="button"
                  >
                    <Text
                      className="text-xs font-sans-bold"
                      style={{ color: "#3FDCFF" }}
                    >
                      OPEN WEB BILLING
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {crossStoreActive ? (
            <View
              className="flex-row items-start gap-3 rounded-2xl p-4"
              style={{
                backgroundColor: "rgba(63,220,255,0.06)",
                borderWidth: 1,
                borderColor: "rgba(63,220,255,0.25)",
              }}
            >
              <Store size={18} color="#3FDCFF" />
              <View className="flex-1 gap-1">
                <Text className="text-sm font-sans-bold text-foreground">
                  Already subscribed
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Your subscription is billed through{" "}
                  {Platform.OS === "ios" ? "Google Play or the App Store" : "the App Store or Google Play"}{" "}
                  on another platform, or is part of a DVNT membership. Manage
                  it where you subscribed.
                </Text>
              </View>
            </View>
          ) : null}

          {currentSneakyKey ? (
            <View
              className="flex-row items-start gap-3 rounded-2xl p-4"
              style={{
                backgroundColor: "rgba(63,220,255,0.06)",
                borderWidth: 1,
                borderColor: "rgba(63,220,255,0.25)",
              }}
            >
              <Store size={18} color="#3FDCFF" />
              <View className="flex-1 gap-1">
                <Text className="text-sm font-sans-bold text-foreground">
                  Subscribed via {OWN_STORE_NAME}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Pick a different tier below to switch plans, or manage
                  renewal and cancellation in {OWN_STORE_NAME}.
                </Text>
              </View>
            </View>
          ) : null}

          {/* Tier cards — canonical Sneaky tiers from plans.ts */}
          {SNEAKY_PLAN_KEYS.map((key) => {
            const p = PLANS[key];
            const isFree = key === "free";
            const isCurrentPlan = currentSneakyKey
              ? key === currentSneakyKey
              : key === currentKey;
            const pkg = packageByPlan[key];
            // Store price when the catalog is loaded; plans.ts fallback.
            const priceLabel =
              pkg?.product.priceString ?? fallbackPrice(p.priceCents);
            const isPurchasable = canSell && !isFree && !isCurrentPlan && !!pkg;
            const sellableInPrinciple = canSell && !isFree && !isCurrentPlan;
            const ctaUnavailableLabel = unavailableReason
              ? offeringsUnavailableCopy(unavailableReason)
              : "Not available right now";
            const isPurchasing = purchasingPlanKey === key;

            return (
              <View
                key={key}
                className="rounded-2xl p-4"
                style={{
                  backgroundColor:
                    !isFree && isPurchasable
                      ? "#8A40CF18"
                      : "rgba(255,255,255,0.04)",
                  borderWidth: 1.5,
                  borderColor:
                    !isFree && isPurchasable
                      ? "#8A40CF"
                      : isCurrentPlan
                        ? "#22c55e40"
                        : "rgba(255,255,255,0.08)",
                }}
              >
                <View className="flex-row items-start justify-between mb-2">
                  <View className="flex-row items-center gap-2">
                    <Users size={16} color={!isFree ? "#8A40CF" : "#888"} />
                    <Text className="text-base font-sans-bold text-foreground">
                      {p.name}
                    </Text>
                    {isCurrentPlan && (
                      <View className="px-2 py-0.5 rounded-full bg-green-500/20">
                        <Text className="text-[10px] font-sans-bold text-green-500">
                          CURRENT
                        </Text>
                      </View>
                    )}
                  </View>
                  <View className="items-end">
                    <Text className="text-lg font-sans-bold text-foreground">
                      {priceLabel}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {isFree ? "forever" : "/ month"}
                    </Text>
                  </View>
                </View>

                <View className="gap-1">
                  {p.bullets.sneaky.map((f) => (
                    <View key={f} className="flex-row items-center gap-2">
                      <Check size={12} color="#22c55e" />
                      <Text className="text-xs text-muted-foreground">{f}</Text>
                    </View>
                  ))}
                </View>

                {!isPurchasable && sellableInPrinciple ? (
                  /* Disabled, but visible and reasoned — a priced tier with no
                     button at all reads as half-built. */
                  <View
                    className="mt-3 rounded-xl py-3 flex-row items-center justify-center gap-2"
                    style={{ backgroundColor: "#8A40CF", opacity: 0.45 }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: true }}
                    accessibilityLabel={`Unavailable: ${ctaUnavailableLabel}`}
                  >
                    <Text className="text-white text-sm font-semibold">
                      {ctaUnavailableLabel}
                    </Text>
                  </View>
                ) : null}
                {isPurchasable ? (
                  <Pressable
                    onPress={() => onBuy(key)}
                    disabled={!!purchasingPlanKey || restoring}
                    className="mt-3 rounded-xl py-3 flex-row items-center justify-center gap-2"
                    style={{
                      backgroundColor: "#8A40CF",
                      opacity: !!purchasingPlanKey || restoring ? 0.6 : 1,
                    }}
                    accessibilityRole="button"
                  >
                    {isPurchasing ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Zap size={15} color="#fff" />
                        <Text className="text-sm font-sans-bold text-white">
                          {currentSneakyKey
                            ? `Switch to ${p.name}`
                            : `Subscribe · ${priceLabel}/mo`}
                        </Text>
                        <ChevronRight size={14} color="#fff" />
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {/* Restore Purchases — Apple-required affordance. */}
          {billing ? (
            <Pressable
              onPress={onRestore}
              disabled={restoring || !!purchasingPlanKey}
              className="items-center justify-center py-3"
              accessibilityRole="button"
            >
              {restoring ? (
                <ActivityIndicator size="small" color="#3FDCFF" />
              ) : (
                <Text
                  className="text-sm font-sans-bold"
                  style={{ color: "#3FDCFF" }}
                >
                  Restore Purchases
                </Text>
              )}
            </Pressable>
          ) : null}

          <View className="items-center justify-center gap-1 mt-1">
            <View className="flex-row items-center gap-1">
              <Shield size={10} color="#666" />
              <Text className="text-[10px] text-muted-foreground text-center">
                Subscriptions renew monthly through{" "}
                {Platform.OS === "ios" ? "your Apple ID" : "your Google account"}{" "}
                and can be cancelled anytime in {OWN_STORE_NAME}.
              </Text>
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

// ── WEB — legacy Stripe Billing checkout (untouched behavior) ───────────────

function StripeSubscriptionModal({
  visible,
  onClose,
  currentPlan = "free",
  reason = "upgrade",
  dismissible = true,
  onSubscribed,
}: SneakySubscriptionModalProps) {
  // Protect subscription tier/pricing information when visible
  useSneakyLynkCaptureProtection();

  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>("host_25");
  const isChangingPaidPlan =
    currentPlan === "host_25" || currentPlan === "host_50";

  useEffect(() => {
    if (currentPlan === "host_50") {
      setSelectedPlan("host_25");
      return;
    }
    if (currentPlan === "host_25") {
      setSelectedPlan("host_50");
      return;
    }
    setSelectedPlan("host_25");
  }, [currentPlan]);

  const handleSubscribe = useCallback(
    async (planId: string) => {
      if (!authUser?.id || planId === "free") return;
      setLoadingPlanId(planId);

      try {
        const token = await requireBetterAuthToken();
        const { data, error } = await supabase.functions.invoke(
          "sneaky-billing-checkout",
          {
            body: { plan_id: planId },
            headers: {
              Authorization: `Bearer ${token}`,
              "x-auth-token": token,
            },
          },
        );

        if (error) throw error;

        if (data?.updated) {
          showToast(
            "success",
            data?.billing_effect === "upgrade_prorated_now"
              ? "Plan upgraded"
              : "Plan downgraded",
            data?.billing_effect === "upgrade_prorated_now"
              ? "Stripe updated your plan and billed the prorated difference."
              : "Stripe updated your plan and applied any prorated credit to your next invoice.",
          );
          onSubscribed?.(data.plan_id || planId);
          onClose();
          return;
        }

        // Server says user should change plans via billing portal
        if (data?.redirect === "billing_portal") {
          showToast(
            "info",
            "Change Plan",
            "Use the billing portal to change your plan.",
          );
          onClose();
          return;
        }

        if (data?.error) {
          throw new Error(data.error);
        }

        if (data?.url) {
          const result = await WebBrowser.openBrowserAsync(data.url, {
            presentationStyle:
              Platform.OS === "ios"
                ? WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET
                : undefined,
          });

          if (result.type === "cancel" || result.type === "dismiss") {
            const { data: sub } = await supabase
              .from("sneaky_subscriptions")
              .select("status, plan_id")
              .eq("host_id", authUser.id)
              .single();

            if (sub?.status === "active" || sub?.status === "trialing") {
              showToast(
                "success",
                "Subscribed!",
                `You are now on the ${STRIPE_PLANS.find((p) => p.id === sub.plan_id)?.name} plan.`,
              );
              onSubscribed?.(sub.plan_id);
              onClose();
            }
          }
        }
      } catch (err: any) {
        console.error("[SneakySubscriptionModal] Error:", err);
        if (
          err?.message?.includes("Already subscribed") ||
          err?.message?.includes("billing portal")
        ) {
          showToast(
            "info",
            "Already Subscribed",
            "Manage your plan in billing settings.",
          );
        } else {
          showToast("error", "Error", err.message || "Subscription failed");
        }
      } finally {
        setLoadingPlanId(null);
      }
    },
    [authUser?.id, onClose, onSubscribed, showToast],
  );

  if (!visible) return null;

  const reasonText = REASON_TEXT[reason];
  const sheetMaxHeight = Math.max(420, height - insets.top - 36);
  const planListMaxHeight = Math.max(260, sheetMaxHeight - 168);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      className="absolute inset-0"
      style={{
        backgroundColor: "rgba(0,0,0,0.75)",
        zIndex: 20000,
        elevation: 20000,
      }}
    >
      <Pressable
        className="flex-1"
        onPress={dismissible ? onClose : undefined}
      />

      <Animated.View
        entering={FadeInUp.duration(300).springify().damping(18)}
        className="bg-card rounded-t-3xl px-5 pt-6"
        style={{
          maxHeight: sheetMaxHeight,
          paddingBottom: Math.max(24, insets.bottom + 18),
        }}
      >
        {dismissible ? (
          <Pressable
            onPress={onClose}
            hitSlop={12}
            className="absolute top-4 right-4 w-8 h-8 items-center justify-center rounded-full bg-muted"
          >
            <X size={16} color="#999" />
          </Pressable>
        ) : null}

        {/* Icon */}
        <View className="items-center mb-3">
          <View
            className="w-14 h-14 rounded-full items-center justify-center"
            style={{ backgroundColor: "#8A40CF20" }}
          >
            <Crown size={26} color="#8A40CF" />
          </View>
        </View>

        {/* Title + sub */}
        <Text className="text-xl font-sans-bold text-foreground text-center mb-1">
          Upgrade Your Plan
        </Text>
        <Text className="text-sm text-muted-foreground text-center mb-5 px-4">
          {reasonText}
        </Text>

        {/* Plan cards */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: planListMaxHeight }}
          bounces={false}
          contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
        >
          {STRIPE_PLANS.map((plan) => {
            const isCurrentPlan = plan.id === currentPlan;
            const isSelected = plan.id === selectedPlan;
            const isLoading = loadingPlanId === plan.id;
            const isFree = plan.id === "free";

            return (
              <Pressable
                key={plan.id}
                onPress={() => !isCurrentPlan && setSelectedPlan(plan.id)}
                className="rounded-2xl p-4"
                style={{
                  backgroundColor:
                    isSelected && !isFree
                      ? "#8A40CF18"
                      : "rgba(255,255,255,0.04)",
                  borderWidth: 1.5,
                  borderColor:
                    isSelected && !isFree
                      ? "#8A40CF"
                      : isCurrentPlan
                        ? "#22c55e40"
                        : "rgba(255,255,255,0.08)",
                }}
              >
                <View className="flex-row items-start justify-between mb-2">
                  <View className="flex-row items-center gap-2">
                    <Users
                      size={16}
                      color={plan.highlight ? "#8A40CF" : "#888"}
                    />
                    <Text className="text-base font-sans-bold text-foreground">
                      {plan.name}
                    </Text>
                    {plan.highlight && (
                      <View
                        className="px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: "#8A40CF" }}
                      >
                        <Text className="text-[10px] font-sans-bold text-white">
                          POPULAR
                        </Text>
                      </View>
                    )}
                    {isCurrentPlan && (
                      <View className="px-2 py-0.5 rounded-full bg-green-500/20">
                        <Text className="text-[10px] font-sans-bold text-green-500">
                          CURRENT
                        </Text>
                      </View>
                    )}
                  </View>
                  <View className="items-end gap-2">
                    <View className="flex-row items-center gap-2">
                      {isSelected && !isCurrentPlan && !isFree ? (
                        <CircleDot size={20} color="#8A40CF" />
                      ) : (
                        <Circle
                          size={20}
                          color={isCurrentPlan ? "#22c55e" : "#777"}
                        />
                      )}
                      <View className="items-end">
                        <Text className="text-lg font-sans-bold text-foreground">
                          {plan.price}
                        </Text>
                        <Text className="text-xs text-muted-foreground">
                          {plan.priceNote}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View className="gap-1">
                  {plan.features.map((f) => (
                    <View key={f} className="flex-row items-center gap-2">
                      <Check size={12} color="#22c55e" />
                      <Text className="text-xs text-muted-foreground">{f}</Text>
                    </View>
                  ))}
                </View>

                {!isFree && !isCurrentPlan && isSelected && (
                  <Pressable
                    onPress={() => handleSubscribe(plan.id)}
                    disabled={!!loadingPlanId}
                    className="mt-3 rounded-xl py-3 flex-row items-center justify-center gap-2"
                    style={{
                      backgroundColor: "#8A40CF",
                      opacity: loadingPlanId ? 0.6 : 1,
                    }}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Zap size={15} color="#fff" />
                        <Text className="text-sm font-sans-bold text-white">
                          {isChangingPaidPlan
                            ? plan.id === "host_50"
                              ? "Upgrade Plan"
                              : "Downgrade Plan"
                            : `Subscribe · ${plan.price}/mo`}
                        </Text>
                        <ChevronRight size={14} color="#fff" />
                      </>
                    )}
                  </Pressable>
                )}
              </Pressable>
            );
          })}

          <View className="items-center justify-center gap-1 mt-1">
            <View className="flex-row items-center gap-1">
              <Shield size={10} color="#666" />
              <Text className="text-[10px] text-muted-foreground text-center">
                Stripe updates the recurring plan price when you change tiers.
              </Text>
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}
