/**
 * Sneaky Lynk Billing Screen
 * Route: /sneaky-lynk/billing
 *
 * Shows current subscription, plan features, and Stripe Customer Portal link.
 */

import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useState, useCallback, useEffect } from "react";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeft,
  Crown,
  Check,
  ExternalLink,
  RefreshCw,
  Shield,
  Zap,
  AlertCircle,
} from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { SneakySubscriptionModal } from "@dvnt/app/src/sneaky-lynk/components/SneakySubscriptionModal";
import { useSneakyLynkCaptureProtection } from "@dvnt/app/src/sneaky-lynk/hooks/useSneakyLynkCaptureProtection";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";

interface Subscription {
  plan_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  grace_period_ends_at: string | null;
}

const PLAN_LABELS: Record<
  string,
  { name: string; price: string; maxPax: number | null }
> = {
  free: { name: "Free", price: "$0/mo", maxPax: 5 },
  host_25: { name: "Host 15", price: "$15/mo", maxPax: 15 },
  host_50: { name: "Unlimited", price: "$25/mo", maxPax: null },
};

function BillingScreenContent() {
  // Protect billing/subscription information from capture
  useSneakyLynkCaptureProtection();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

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

      setSubscription(
        data ?? {
          plan_id: "free",
          status: "inactive",
          current_period_end: null,
          cancel_at_period_end: false,
          stripe_subscription_id: null,
          grace_period_ends_at: null,
        },
      );
    } catch {
      setSubscription({
        plan_id: "free",
        status: "inactive",
        current_period_end: null,
        cancel_at_period_end: false,
        stripe_subscription_id: null,
        grace_period_ends_at: null,
      });
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.id]);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription]);

  // Realtime: auto-refresh when webhook updates subscription
  useEffect(() => {
    if (!authUser?.id) return;

    const channel = supabase
      .channel("sneaky-sub-changes")
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
          headers: {
            Authorization: `Bearer ${token}`,
            "x-auth-token": token,
          },
        },
      );

      if (error || data?.error) {
        const msg = data?.error || error?.message;
        if (msg?.includes("No billing account")) {
          showToast(
            "info",
            "No billing account",
            "Subscribe to a paid plan first.",
          );
        } else {
          throw error ?? new Error(msg);
        }
        return;
      }

      if (data?.url) {
        await WebBrowser.openBrowserAsync(data.url, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
        await loadSubscription();
      }
    } catch (err: any) {
      showToast(
        "error",
        "Error",
        err.message || "Could not open billing portal",
      );
    } finally {
      setIsPortalLoading(false);
    }
  }, [authUser?.id, loadSubscription, showToast]);

  const planInfo = PLAN_LABELS[subscription?.plan_id ?? "free"];
  const isActive =
    subscription?.status === "active" || subscription?.status === "trialing";
  const isPastDue = subscription?.status === "past_due";
  const isFree =
    !subscription?.stripe_subscription_id || subscription?.plan_id === "free";

  const periodEndLabel = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          className="w-9 h-9 items-center justify-center rounded-full bg-muted"
        >
          <ChevronLeft size={20} color={colors.foreground} />
        </Pressable>
        <Text className="text-lg font-sans-bold text-foreground flex-1">
          {getLynkDisplayName()} Billing
        </Text>
        <Pressable onPress={loadSubscription} hitSlop={12}>
          <RefreshCw size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Current plan card */}
          <View
            className="rounded-2xl p-5 border"
            style={{
              backgroundColor: isActive
                ? "#8A40CF10"
                : "rgba(255,255,255,0.04)",
              borderColor: isActive ? "#8A40CF40" : "rgba(255,255,255,0.08)",
            }}
          >
            <View className="flex-row items-center gap-3 mb-3">
              <View
                className="w-10 h-10 rounded-xl items-center justify-center"
                style={{ backgroundColor: "#8A40CF20" }}
              >
                <Crown size={20} color="#8A40CF" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-sans-bold text-foreground">
                  {planInfo.name}
                </Text>
                <Text className="text-sm text-muted-foreground">
                  {planInfo.price}
                </Text>
              </View>
              <View
                className="px-3 py-1 rounded-full"
                style={{
                  backgroundColor: isActive
                    ? "#22c55e20"
                    : isPastDue
                      ? "#ef444420"
                      : "#88888820",
                }}
              >
                <Text
                  className="text-xs font-sans-semibold"
                  style={{
                    color: isActive
                      ? "#22c55e"
                      : isPastDue
                        ? "#ef4444"
                        : "#888",
                  }}
                >
                  {isActive
                    ? "ACTIVE"
                    : isPastDue
                      ? "PAST DUE"
                      : (subscription?.status?.toUpperCase() ?? "FREE")}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="flex-row items-center gap-1">
                <Check size={13} color="#22c55e" />
                <Text className="text-xs text-muted-foreground">
                  {planInfo.maxPax === null
                    ? "Unlimited screens"
                    : `Up to ${planInfo.maxPax} screens`}
                </Text>
              </View>
              {(planInfo.maxPax === null || planInfo.maxPax > 5) && (
                <View className="flex-row items-center gap-1">
                  <Check size={13} color="#22c55e" />
                  <Text className="text-xs text-muted-foreground">
                    Unlimited duration
                  </Text>
                </View>
              )}
            </View>

            {/* Renewal / cancel notice */}
            {periodEndLabel && (
              <Text className="text-xs text-muted-foreground mt-3">
                {subscription?.cancel_at_period_end
                  ? `Cancels on ${periodEndLabel}`
                  : `Renews on the 1st of each month · Next: ${periodEndLabel}`}
              </Text>
            )}
          </View>

          {/* Past due warning */}
          {isPastDue && (
            <View
              className="flex-row gap-3 p-4 rounded-2xl"
              style={{ backgroundColor: "#ef444415" }}
            >
              <AlertCircle size={18} color="#ef4444" />
              <View className="flex-1">
                <Text className="text-sm text-foreground">
                  Your last payment failed. Update your payment method to keep
                  access.
                </Text>
                {subscription?.grace_period_ends_at && (
                  <Text className="text-xs mt-1" style={{ color: "#ef4444" }}>
                    Access will be downgraded on{" "}
                    {new Date(
                      subscription.grace_period_ends_at,
                    ).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Manage billing button (only if has stripe sub) */}
          {!isFree && (
            <Pressable
              onPress={handleManageBilling}
              disabled={isPortalLoading}
              className="flex-row items-center justify-between bg-card rounded-2xl p-4"
              style={{ opacity: isPortalLoading ? 0.6 : 1 }}
            >
              <View className="flex-row items-center gap-3">
                <ExternalLink size={18} color={colors.foreground} />
                <View>
                  <Text className="text-sm font-sans-semibold text-foreground">
                    Manage Subscription
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Update card, cancel, or change plan
                  </Text>
                </View>
              </View>
              {isPortalLoading ? (
                <ActivityIndicator
                  size="small"
                  color={colors.mutedForeground}
                />
              ) : (
                <ChevronLeft
                  size={16}
                  color={colors.mutedForeground}
                  style={{ transform: [{ rotate: "180deg" }] }}
                />
              )}
            </Pressable>
          )}

          {/* Upgrade CTA — hidden on iOS for free users (App Store Guideline 3.1.1) */}
          {Platform.OS === "ios" && isFree ? (
            <View
              className="rounded-2xl p-4 items-center gap-1"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}
            >
              <Text className="text-sm font-sans-semibold text-foreground text-center">
                Manage Your Plan
              </Text>
              <Text className="text-xs text-muted-foreground text-center">
                Visit dvntapp.live on the web to subscribe or change your plan.
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowUpgradeModal(true)}
              className="flex-row items-center justify-center gap-2 rounded-2xl py-4"
              style={{ backgroundColor: "#8A40CF" }}
            >
              <Zap size={16} color="#fff" />
              <Text className="text-sm font-sans-bold text-white">
                {isFree ? "Upgrade Plan" : "Change Plan"}
              </Text>
            </Pressable>
          )}

          {/* iOS compliance */}
          {!isFree && (
            <View className="items-center justify-center gap-1 mt-2">
              <View className="flex-row items-center gap-1">
                <Shield size={11} color="#666" />
                <Text className="text-[11px] text-muted-foreground text-center">
                  Cancel anytime. Membership automatically renews the 1st of
                  each month.
                </Text>
              </View>
              <Text className="text-[10px] text-muted-foreground/60 text-center mt-1">
                Starting mid-month results in a startup charge, then monthly on
                the 1st.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Upgrade modal */}
      {showUpgradeModal && (
        <SneakySubscriptionModal
          visible={showUpgradeModal}
          onClose={() => {
            setShowUpgradeModal(false);
            loadSubscription();
          }}
          currentPlan={subscription?.plan_id ?? "free"}
          reason="upgrade"
        />
      )}
    </View>
  );
}

export default function BillingScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="Billing" onGoBack={() => router.back()}>
      <BillingScreenContent />
    </ErrorBoundary>
  );
}
