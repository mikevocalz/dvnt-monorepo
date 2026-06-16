/**
 * Organizer Setup Screen
 *
 * Premium Stripe Connect onboarding. Premium polish:
 *   - Animated progress bar showing X / 4 steps complete
 *   - Pending verification reason shown plainly ("Verifying your address")
 *   - Realtime subscription on organizer_accounts so the screen auto-flips
 *     to Active the second the webhook fires (no manual refresh needed)
 *   - Success celebration when fully activated (haptic + scale bounce)
 */

import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useState, useCallback, useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import {
  ArrowLeft,
  CreditCard,
  CheckCircle,
  ExternalLink,
  AlertCircle,
  DollarSign,
  Shield,
  Banknote,
  Clock,
  Sparkles,
} from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { organizerApi, type OrganizerStatus } from "@dvnt/app/lib/api/organizer";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";

const REQ_LABELS: Record<string, string> = {
  "individual.address.city": "city",
  "individual.address.line1": "street",
  "individual.address.postal_code": "zip code",
  "individual.address.state": "state",
  "individual.address": "address",
  "individual.id_number": "social security number",
  "individual.verification.document": "ID document",
  "individual.verification.additional_document": "additional ID",
  external_account: "bank account",
  "tos_acceptance.date": "terms acceptance",
  "business_profile.mcc": "industry",
  "business_profile.url": "business website",
};

function humanizeRequirements(fields: string[]): string {
  const labels = fields.map((f) => REQ_LABELS[f] || f.replace(/_/g, " "));
  const unique = [...new Set(labels)];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function OrganizerSetupContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const userAuthId = useAuthStore((s) => s.user?.authId);

  const [status, setStatus] = useState<OrganizerStatus>({ connected: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const celebratedRef = useRef(false);

  const checkStatus = useCallback(async () => {
    const result = await organizerApi.getStatus();
    setStatus(result);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Realtime: when the webhook updates organizer_accounts for this host,
  // re-fetch immediately so charges/payouts checkmarks flip without poll.
  useEffect(() => {
    if (!userAuthId) return;
    const channel = supabase
      .channel(`organizer-rt:${userAuthId}:${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "organizer_accounts",
          filter: `host_id=eq.${userAuthId}`,
        },
        () => {
          checkStatus();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userAuthId, checkStatus]);

  // Soft polling when in verification limbo — webhook is the source of
  // truth, but Stripe can take a moment to fire it. Poll every 5s while
  // the user is on the screen and not fully active.
  useEffect(() => {
    if (status.charges_enabled && status.payouts_enabled) return;
    const timer = setInterval(() => {
      checkStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [status.charges_enabled, status.payouts_enabled, checkStatus]);

  const stepsDone =
    (status.connected ? 1 : 0) +
    (status.details_submitted ? 1 : 0) +
    (status.charges_enabled ? 1 : 0) +
    (status.payouts_enabled ? 1 : 0);
  const isFullyConnected = stepsDone === 4;

  const isRestricted =
    status.connected &&
    status.details_submitted &&
    (!status.charges_enabled || !status.payouts_enabled);

  const isStripeReviewing =
    isRestricted &&
    (status.disabled_reason === "requirements.pending_verification" ||
      (status.pending_verification?.length ?? 0) > 0) &&
    (status.currently_due?.length ?? 0) === 0;

  const blockingFields = status.currently_due ?? [];
  const reviewingFields = status.pending_verification ?? [];

  // Animated progress
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(stepsDone / 4, {
      damping: 18,
      stiffness: 150,
    });
  }, [stepsDone, progress]);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  // Celebration when fully active
  const successScale = useSharedValue(1);
  useEffect(() => {
    if (isFullyConnected && !celebratedRef.current) {
      celebratedRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      successScale.value = withTiming(
        1,
        { duration: 0 },
        () => {
          "worklet";
        },
      );
      successScale.value = withSpring(
        1.08,
        { damping: 12, stiffness: 220 },
        () => {
          "worklet";
          successScale.value = withSpring(1, {
            damping: 18,
            stiffness: 220,
          });
        },
      );
    }
  }, [isFullyConnected, successScale]);
  const successPulse = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
  }));

  const openStripeUrl = useCallback(
    async (url: string) => {
      await WebBrowser.openAuthSessionAsync(url, "dvnt://stripe/connect");
      await checkStatus();
    },
    [checkStatus],
  );

  const handleStartOnboarding = useCallback(async () => {
    setIsOnboarding(true);
    try {
      const result = isRestricted
        ? await organizerApi.resumeVerification()
        : await organizerApi.startOnboarding();
      if (result.error) {
        showToast("error", "Error", result.error);
        return;
      }
      if (!result.url) {
        showToast("error", "Error", "No URL returned. Please try again.");
        return;
      }
      await openStripeUrl(result.url);
    } catch (err: any) {
      showToast("error", "Error", err.message || "Failed to open Stripe");
    } finally {
      setIsOnboarding(false);
    }
  }, [showToast, isRestricted, openStripeUrl]);

  // Pick the right CTA copy
  let ctaLabel = "Connect with Stripe";
  if (isFullyConnected) ctaLabel = "";
  else if (isStripeReviewing) ctaLabel = "Check again";
  else if (isRestricted) ctaLabel = "Update Verification";
  else if (status.connected) ctaLabel = "Continue Setup";

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center px-4 py-3 gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text className="text-lg font-sans-bold text-foreground flex-1">
          Organizer Setup
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#8A40CF" size="large" />
        </View>
      ) : (
        <Animated.ScrollView
          entering={FadeIn.duration(300)}
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        >
          {/* Status card */}
          <Animated.View
            entering={FadeInDown.delay(80)
              .duration(300)
              .springify()
              .damping(18)}
            style={successPulse}
            className="bg-card rounded-3xl border border-border p-5 mt-4"
          >
            <View className="flex-row items-center gap-3 mb-4">
              <View
                className={`w-12 h-12 rounded-full items-center justify-center ${
                  isFullyConnected
                    ? "bg-green-500/15"
                    : isStripeReviewing
                      ? "bg-amber-400/15"
                      : "bg-primary/10"
                }`}
              >
                {isFullyConnected ? (
                  <CheckCircle size={24} color="#22C55E" />
                ) : isStripeReviewing ? (
                  <Clock size={22} color="#F59E0B" />
                ) : (
                  <CreditCard size={24} color="#8A40CF" />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-base font-sans-bold text-foreground">
                  {isFullyConnected
                    ? "You're set"
                    : isStripeReviewing
                      ? "Stripe is reviewing"
                      : status.connected
                        ? "Setup incomplete"
                        : "Connect your bank"}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  {isFullyConnected
                    ? "Ticket revenue will land in your bank"
                    : isStripeReviewing
                      ? `Verifying ${humanizeRequirements(reviewingFields)} (typically 5–30 min)`
                      : blockingFields.length > 0
                        ? `Stripe still needs: ${humanizeRequirements(blockingFields)}`
                        : "Required to sell paid tickets"}
                </Text>
              </View>
              {isFullyConnected && (
                <Sparkles size={20} color="#22C55E" />
              )}
            </View>

            {/* Progress bar */}
            <View className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-4">
              <Animated.View
                style={[progressStyle]}
                className={`h-full rounded-full ${
                  isFullyConnected ? "bg-green-500" : "bg-primary"
                }`}
              />
            </View>
            <Text className="text-[11px] text-muted-foreground mb-4 -mt-2">
              {stepsDone} of 4 steps complete
            </Text>

            {/* Status checklist */}
            <View className="gap-2.5 mb-5">
              <StatusRow label="Account created" done={!!status.connected} />
              <StatusRow
                label="Details submitted"
                done={!!status.details_submitted}
              />
              <StatusRow
                label="Charges enabled"
                done={!!status.charges_enabled}
                pending={
                  !status.charges_enabled &&
                  isStripeReviewing &&
                  reviewingFields.length > 0
                }
              />
              <StatusRow
                label="Payouts enabled"
                done={!!status.payouts_enabled}
                pending={
                  !status.payouts_enabled &&
                  isStripeReviewing &&
                  reviewingFields.length > 0
                }
              />
            </View>

            {!isFullyConnected && ctaLabel !== "" && (
              <Pressable
                onPress={
                  isStripeReviewing ? checkStatus : handleStartOnboarding
                }
                disabled={isOnboarding}
                className="bg-primary rounded-full py-3.5 flex-row items-center justify-center gap-2"
                style={{ opacity: isOnboarding ? 0.6 : 1 }}
              >
                {isOnboarding ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    {!isStripeReviewing && (
                      <ExternalLink size={18} color="#000" />
                    )}
                    <Text className="text-base font-sans-bold text-primary-foreground">
                      {ctaLabel}
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            {isFullyConnected && (
              <Pressable
                onPress={() => router.push("/(protected)/events/create")}
                className="bg-green-500/15 border border-green-500/40 rounded-full py-3.5 flex-row items-center justify-center gap-2"
              >
                <Sparkles size={18} color="#22C55E" />
                <Text className="text-base font-sans-bold text-green-400">
                  Create your first event
                </Text>
              </Pressable>
            )}
          </Animated.View>

          {/* Info cards */}
          <Animated.View
            entering={FadeInDown.delay(200)
              .duration(300)
              .springify()
              .damping(18)}
            className="mt-5 gap-3"
          >
            <InfoCard
              icon={<DollarSign size={18} color="#22C55E" />}
              title="Revenue"
              description="Receive ticket sales minus a 5% + $1/ticket platform fee and Stripe's standard processing rate."
            />
            <InfoCard
              icon={<Banknote size={18} color="#3B82F6" />}
              title="Payouts"
              description="Funds release 5 business days after the event ends, transferred to your linked bank."
            />
            <InfoCard
              icon={<Shield size={18} color="#8A40CF" />}
              title="Security"
              description="Powered by Stripe Connect. Your banking and ID info never touches our servers."
            />
          </Animated.View>
        </Animated.ScrollView>
      )}
    </View>
  );
}

function StatusRow({
  label,
  done,
  pending,
}: {
  label: string;
  done: boolean;
  pending?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2.5">
      {done ? (
        <CheckCircle size={16} color="#22C55E" />
      ) : pending ? (
        <Clock size={16} color="#F59E0B" />
      ) : (
        <AlertCircle size={16} color="#6B7280" />
      )}
      <Text
        className={`text-sm ${
          done
            ? "text-foreground"
            : pending
              ? "text-amber-400"
              : "text-muted-foreground"
        }`}
      >
        {label}
        {pending && !done && "  • verifying"}
      </Text>
    </View>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <View className="bg-card/50 rounded-xl border border-border/50 p-4 flex-row gap-3">
      <View className="mt-0.5">{icon}</View>
      <View className="flex-1">
        <Text className="text-sm font-sans-semibold text-foreground">
          {title}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
          {description}
        </Text>
      </View>
    </View>
  );
}

export default function OrganizerSetupScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="OrganizerSetup" onGoBack={() => router.back()}>
      <OrganizerSetupContent />
    </ErrorBoundary>
  );
}
