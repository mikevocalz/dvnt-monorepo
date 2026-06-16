"use client";

/**
 * Sneaky Lynk Billing — WEB (port of native
 * `app/(protected)/sneaky-lynk/billing.tsx`).
 *
 * Law 1 (data is sacred): wires the EXACT native data flow —
 *   - Subscription read: `supabase.from("sneaky_subscriptions").select(...)`
 *     filtered by `host_id`, plus the same Realtime `postgres_changes`
 *     channel that auto-refreshes when the Stripe webhook updates the row.
 *   - Manage billing: the SAME `sneaky-billing-portal` edge function
 *     (auth via `requireBetterAuthToken`), opening the returned hosted
 *     URL with `window.location.assign` (no @stripe/stripe-react-native).
 *   - Upgrade / change plan: the SAME `sneaky-billing-checkout` edge
 *     function the native `SneakySubscriptionModal` calls — rendered here
 *     in the kit `Dialog` (the native modal is RN/expo-only, so its
 *     checkout logic is replicated against the identical edge fn).
 *
 * Law 3 (web): raw semantic HTML + Tailwind only (NativeWind interop off) —
 * no <View>/<Text>. Sticky header like legal-page.web.tsx. State = Zustand
 * (no useState) — `useSneakyBillingStore`. bg #06070d, accent cyan #3FDCFF.
 * Avatars n/a here. No list of N rows, so no TanStack Virtual needed.
 */

import { useEffect, useCallback } from "react";
import { useRouter } from "solito/navigation";
import {
  ChevronLeft,
  Crown,
  Check,
  ExternalLink,
  RefreshCw,
  Shield,
  Zap,
  AlertCircle,
} from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { useSneakyBillingStore } from "./billing-store";

const ACCENT = "#3FDCFF";

interface PlanRow {
  id: string;
  name: string;
  price: string;
  priceNote: string;
  maxLabel: string;
  features: string[];
  highlight: boolean;
}

const PLAN_LABELS: Record<
  string,
  { name: string; price: string; maxPax: number | null }
> = {
  free: { name: "Free", price: "$0/mo", maxPax: 5 },
  host_25: { name: "Host 15", price: "$15/mo", maxPax: 15 },
  host_50: { name: "Unlimited", price: "$25/mo", maxPax: null },
};

const UPGRADE_PLANS: PlanRow[] = [
  {
    id: "host_25",
    name: "Host 15",
    price: "$15",
    priceNote: "/ month",
    maxLabel: "Up to 15 screens",
    highlight: true,
    features: ["Up to 15 screens per session", "Unlimited duration", "Cancel anytime"],
  },
  {
    id: "host_50",
    name: "Unlimited",
    price: "$25",
    priceNote: "/ month",
    maxLabel: "Unlimited screens",
    highlight: false,
    features: ["Unlimited screens", "Unlimited duration", "Cancel anytime"],
  },
];

export function SneakyLynkBillingScreen() {
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const subscription = useSneakyBillingStore((s) => s.subscription);
  const isLoading = useSneakyBillingStore((s) => s.isLoading);
  const isPortalLoading = useSneakyBillingStore((s) => s.isPortalLoading);
  const showUpgradeModal = useSneakyBillingStore((s) => s.showUpgradeModal);
  const checkoutPlanId = useSneakyBillingStore((s) => s.checkoutPlanId);
  const setSubscription = useSneakyBillingStore((s) => s.setSubscription);
  const setIsLoading = useSneakyBillingStore((s) => s.setIsLoading);
  const setIsPortalLoading = useSneakyBillingStore((s) => s.setIsPortalLoading);
  const setShowUpgradeModal = useSneakyBillingStore((s) => s.setShowUpgradeModal);
  const setCheckoutPlanId = useSneakyBillingStore((s) => s.setCheckoutPlanId);

  const FREE_SUB = {
    plan_id: "free",
    status: "inactive",
    current_period_end: null,
    cancel_at_period_end: false,
    stripe_subscription_id: null,
    grace_period_ends_at: null,
  };

  const loadSubscription = useCallback(async () => {
    if (!authUser?.id) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from("sneaky_subscriptions")
        .select(
          "plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription_id, grace_period_ends_at",
        )
        .eq("host_id", authUser.id)
        .single();
      setSubscription(data ?? FREE_SUB);
    } catch {
      setSubscription(FREE_SUB);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, setSubscription, setIsLoading]);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  // Realtime: auto-refresh when the Stripe webhook updates the subscription row.
  useEffect(() => {
    if (!authUser?.id) return;
    const channel = supabase
      .channel("sneaky-sub-changes-web")
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "sneaky_subscriptions",
          filter: `host_id=eq.${authUser.id}`,
        },
        () => {
          loadSubscription();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUser?.id, loadSubscription]);

  const handleManageBilling = useCallback(async () => {
    if (!authUser?.id) return;
    setIsPortalLoading(true);
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "sneaky-billing-portal",
        {
          body: {},
          headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
        },
      );
      if (error || data?.error) {
        const msg = data?.error || error?.message;
        if (msg?.includes("No billing account")) {
          showToast("info", "No billing account", "Subscribe to a paid plan first.");
        } else {
          throw error ?? new Error(msg);
        }
        return;
      }
      if (data?.url && typeof window !== "undefined") {
        window.location.assign(data.url);
      }
    } catch (err: any) {
      showToast("error", "Error", err.message || "Could not open billing portal");
    } finally {
      setIsPortalLoading(false);
    }
  }, [authUser?.id, showToast, setIsPortalLoading]);

  // Upgrade / change plan — SAME `sneaky-billing-checkout` edge fn as native.
  const handleSubscribe = useCallback(
    async (planId: string) => {
      if (!authUser?.id || planId === "free") return;
      setCheckoutPlanId(planId);
      try {
        const token = await requireBetterAuthToken();
        const { data, error } = await supabase.functions.invoke(
          "sneaky-billing-checkout",
          {
            body: { plan_id: planId },
            headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
          },
        );
        if (error) throw error;

        if (data?.updated) {
          showToast(
            "success",
            data?.billing_effect === "upgrade_prorated_now" ? "Plan upgraded" : "Plan downgraded",
            "Stripe updated your plan.",
          );
          setShowUpgradeModal(false);
          loadSubscription();
          return;
        }
        if (data?.redirect === "billing_portal") {
          showToast("info", "Change Plan", "Use the billing portal to change your plan.");
          setShowUpgradeModal(false);
          return;
        }
        if (data?.error) throw new Error(data.error);
        if (data?.url && typeof window !== "undefined") {
          window.location.assign(data.url);
          return;
        }
      } catch (err: any) {
        showToast("error", "Checkout failed", err.message || "Could not start checkout");
      } finally {
        setCheckoutPlanId(null);
      }
    },
    [authUser?.id, showToast, setCheckoutPlanId, setShowUpgradeModal, loadSubscription],
  );

  const planInfo = PLAN_LABELS[subscription?.plan_id ?? "free"] ?? PLAN_LABELS.free;
  const isActive = subscription?.status === "active" || subscription?.status === "trialing";
  const isPastDue = subscription?.status === "past_due";
  const isFree = !subscription?.stripe_subscription_id || subscription?.plan_id === "free";

  const periodEndLabel = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ChevronLeft size={20} color="#fff" />
        </button>
        <h1 className="flex-1 text-[17px] font-semibold">{getLynkDisplayName()} Billing</h1>
        <button
          type="button"
          onClick={loadSubscription}
          aria-label="Refresh"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
        >
          <RefreshCw size={18} className="text-white/60" />
        </button>
      </div>

      {isLoading && !subscription ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
        </div>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-4 py-4 flex flex-col gap-3">
          {/* Current plan card */}
          <section
            className="rounded-2xl p-5 border"
            style={{
              backgroundColor: isActive ? "#8A40CF10" : "rgba(255,255,255,0.04)",
              borderColor: isActive ? "#8A40CF40" : "rgba(255,255,255,0.08)",
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: "#8A40CF20" }}
              >
                <Crown size={20} color="#8A40CF" />
              </span>
              <span className="flex-1">
                <span className="block text-base font-bold">{planInfo.name}</span>
                <span className="block text-sm text-white/60">{planInfo.price}</span>
              </span>
              <span
                className="px-3 py-1 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: isActive ? "#22c55e20" : isPastDue ? "#ef444420" : "#88888820",
                  color: isActive ? "#22c55e" : isPastDue ? "#ef4444" : "#888",
                }}
              >
                {isActive
                  ? "ACTIVE"
                  : isPastDue
                    ? "PAST DUE"
                    : (subscription?.status?.toUpperCase() ?? "FREE")}
              </span>
            </div>

            <div className="flex gap-3 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-white/60">
                <Check size={13} color="#22c55e" />
                {planInfo.maxPax === null ? "Unlimited screens" : `Up to ${planInfo.maxPax} screens`}
              </span>
              {(planInfo.maxPax === null || planInfo.maxPax > 5) && (
                <span className="flex items-center gap-1 text-xs text-white/60">
                  <Check size={13} color="#22c55e" />
                  Unlimited duration
                </span>
              )}
            </div>

            {periodEndLabel ? (
              <p className="text-xs text-white/60 mt-3">
                {subscription?.cancel_at_period_end
                  ? `Cancels on ${periodEndLabel}`
                  : `Renews on the 1st of each month · Next: ${periodEndLabel}`}
              </p>
            ) : null}
          </section>

          {/* Past due warning */}
          {isPastDue ? (
            <div
              className="flex gap-3 p-4 rounded-2xl"
              style={{ backgroundColor: "#ef444415" }}
            >
              <AlertCircle size={18} color="#ef4444" className="shrink-0" />
              <div className="flex-1">
                <p className="text-sm">
                  Your last payment failed. Update your payment method to keep access.
                </p>
                {subscription?.grace_period_ends_at ? (
                  <p className="text-xs mt-1" style={{ color: "#ef4444" }}>
                    Access will be downgraded on{" "}
                    {new Date(subscription.grace_period_ends_at).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Manage billing (only with a stripe sub) */}
          {!isFree ? (
            <button
              type="button"
              onClick={handleManageBilling}
              disabled={isPortalLoading}
              className="flex items-center justify-between rounded-2xl p-4 bg-white/[0.04] border border-white/8 text-left active:scale-[0.99] disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <ExternalLink size={18} color="#fff" />
                <span>
                  <span className="block text-sm font-semibold">Manage Subscription</span>
                  <span className="block text-xs text-white/60">
                    Update card, cancel, or change plan
                  </span>
                </span>
              </span>
              {isPortalLoading ? (
                <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
              ) : (
                <ChevronLeft size={16} className="text-white/40 rotate-180" />
              )}
            </button>
          ) : null}

          {/* Upgrade / change plan CTA (web always allowed — no App Store gate) */}
          <button
            type="button"
            onClick={() => setShowUpgradeModal(true)}
            className="flex items-center justify-center gap-2 rounded-2xl py-4"
            style={{ backgroundColor: "#8A40CF" }}
          >
            <Zap size={16} color="#fff" />
            <span className="text-sm font-bold text-white">
              {isFree ? "Upgrade Plan" : "Change Plan"}
            </span>
          </button>

          {!isFree ? (
            <div className="flex flex-col items-center gap-1 mt-2">
              <span className="flex items-center gap-1">
                <Shield size={11} className="text-white/40" />
                <span className="text-[11px] text-white/60 text-center">
                  Cancel anytime. Membership automatically renews the 1st of each month.
                </span>
              </span>
              <span className="text-[10px] text-white/40 text-center mt-1">
                Starting mid-month results in a startup charge, then monthly on the 1st.
              </span>
            </div>
          ) : null}
        </main>
      )}

      {/* Upgrade dialog — kit Dialog, same checkout edge fn as native */}
      <Dialog
        open={showUpgradeModal}
        onClose={() => {
          setShowUpgradeModal(false);
          loadSubscription();
        }}
        title="Choose a plan"
      >
        <div className="flex flex-col gap-3">
          {UPGRADE_PLANS.map((plan) => {
            const current = subscription?.plan_id === plan.id;
            const loading = checkoutPlanId === plan.id;
            return (
              <div
                key={plan.id}
                className="rounded-2xl border p-4"
                style={{
                  borderColor: plan.highlight ? `${ACCENT}55` : "rgba(255,255,255,0.1)",
                  backgroundColor: plan.highlight ? `${ACCENT}10` : "rgba(255,255,255,0.03)",
                }}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-base font-bold">{plan.name}</span>
                  <span className="text-sm text-white/70">
                    <span className="font-bold text-white">{plan.price}</span> {plan.priceNote}
                  </span>
                </div>
                <ul className="mb-3 flex flex-col gap-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-white/70">
                      <Check size={13} color="#22c55e" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={current || loading}
                  onClick={() => handleSubscribe(plan.id)}
                  className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
                  style={{ backgroundColor: current ? "rgba(255,255,255,0.08)" : "#8A40CF", color: "#fff" }}
                >
                  {current ? "Current Plan" : loading ? "Starting…" : `Choose ${plan.name}`}
                </button>
              </div>
            );
          })}
          <p className="text-[11px] text-white/40 text-center">
            Secure checkout via Stripe. Cancel anytime.
          </p>
        </div>
      </Dialog>
    </div>
  );
}

export default SneakyLynkBillingScreen;
