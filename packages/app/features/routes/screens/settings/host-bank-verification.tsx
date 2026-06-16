/**
 * Host Bank & Verification Screen
 *
 * Displays Stripe Connect account status, verification requirements,
 * and bank/payout account details. Links to Stripe-hosted onboarding
 * for any required updates.
 */

import { useEffect, useCallback, useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  CheckCircle,
  AlertCircle,
  ShieldAlert,
  ExternalLink,
  Building2,
  ShieldCheck,
  CreditCard,
  Clock,
  AlertTriangle,
} from "lucide-react-native";
import { ScreenSkeleton } from "@dvnt/app/components/ui/screen-skeleton";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { connectApi } from "@dvnt/app/lib/api/payments";
import type {
  ConnectAccount,
  ConnectAccountStatus,
} from "@dvnt/app/lib/types/payments";

const STATUS_CONFIG: Record<
  ConnectAccountStatus,
  {
    icon: typeof CheckCircle;
    color: string;
    bg: string;
    label: string;
    description: string;
  }
> = {
  active: {
    icon: CheckCircle,
    color: "#22C55E",
    bg: "bg-green-500/10",
    label: "Fully Connected",
    description: "Your account is verified and payouts are enabled.",
  },
  restricted: {
    icon: ShieldAlert,
    color: "#EF4444",
    bg: "bg-destructive/10",
    label: "Restricted",
    description:
      "Stripe requires additional verification before payouts can continue.",
  },
  onboarding_incomplete: {
    icon: AlertCircle,
    color: "#F97316",
    bg: "bg-orange-500/10",
    label: "Setup Incomplete",
    description:
      "Your Stripe account needs more information to enable payouts.",
  },
  not_started: {
    icon: CreditCard,
    color: "#8A40CF",
    bg: "bg-primary/10",
    label: "Not Connected",
    description:
      "Connect your bank account through Stripe to start receiving payouts.",
  },
};

export default function HostBankVerificationScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Bank & Verification",
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerTintColor: "#fff",
      headerStyle: { backgroundColor: "#000" },
      headerTitleStyle: {
        color: "#fff",
        fontFamily: "Inter-SemiBold",
        fontSize: 17,
      },
      headerShadowVisible: false,
      headerRight: () => <SettingsCloseButton />,
    });
  }, [navigation]);

  const {
    connectAccount,
    connectLoading,
    onboardingLoading,
    setConnectAccount,
    setConnectLoading,
    setOnboardingLoading,
  } = usePaymentsStore();

  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    setConnectLoading(true);
    try {
      const account = await connectApi.getStatus();
      setConnectAccount(account);
    } catch (err) {
      console.error("[BankVerification] loadStatus error:", err);
    } finally {
      setConnectLoading(false);
    }
  }, [setConnectAccount, setConnectLoading]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleOpenStripe = useCallback(async () => {
    router.push("/(protected)/events/organizer-setup" as any);
  }, [router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  }, [loadStatus]);

  const status = connectAccount?.status ?? "not_started";
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;
  const isActive = status === "active";

  return (
    <View className="flex-1 bg-background">
      {connectLoading && !connectAccount ? (
        <ScreenSkeleton variant="detail" rows={4} showHeader={false} />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Status Card */}
          <Animated.View
            entering={FadeInDown.delay(50)
              .duration(300)
              .springify()
              .damping(18)}
            className="mx-4 mt-4 bg-card rounded-2xl border border-border overflow-hidden"
          >
            <View className="p-5">
              <View className="flex-row items-center gap-3 mb-4">
                <View
                  className={`w-12 h-12 rounded-2xl items-center justify-center ${config.bg}`}
                >
                  <StatusIcon size={24} color={config.color} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-sans-bold text-foreground">
                    {config.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
                    {config.description}
                  </Text>
                </View>
              </View>

              {/* Checklist */}
              <View className="gap-2.5 mb-4">
                <StatusRow
                  label="Account created"
                  done={status !== "not_started"}
                />
                <StatusRow
                  label="Details submitted"
                  done={connectAccount?.detailsSubmitted ?? false}
                />
                <StatusRow
                  label="Charges enabled"
                  done={connectAccount?.chargesEnabled ?? false}
                />
                <StatusRow
                  label="Payouts enabled"
                  done={connectAccount?.payoutsEnabled ?? false}
                />
              </View>

              {/* CTA */}
              {!isActive && (
                <Pressable
                  onPress={handleOpenStripe}
                  disabled={onboardingLoading}
                  className="bg-primary rounded-xl py-3 flex-row items-center justify-center gap-2 active:opacity-80"
                  style={{ opacity: onboardingLoading ? 0.6 : 1 }}
                >
                  {onboardingLoading ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <>
                      <ExternalLink size={16} color="#000" />
                      <Text className="text-sm font-sans-bold text-primary-foreground">
                        {status === "not_started"
                          ? "Connect with Stripe"
                          : status === "onboarding_incomplete"
                            ? "Continue Setup"
                            : "Update Verification"}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          </Animated.View>

          {/* Pending Verification Items */}
          {connectAccount?.pendingVerification &&
            connectAccount.pendingVerification.length > 0 && (
              <Animated.View
                entering={FadeInDown.delay(100)
                  .duration(300)
                  .springify()
                  .damping(18)}
                className="mx-4 mt-3"
              >
                <View className="bg-destructive/5 rounded-2xl border border-destructive/15 p-4">
                  <View className="flex-row items-center gap-2 mb-3">
                    <AlertTriangle size={14} color="#EF4444" />
                    <Text className="text-sm font-sans-semibold text-foreground">
                      Pending Requirements
                    </Text>
                  </View>
                  {connectAccount.pendingVerification.map((item, i) => (
                    <View
                      key={item}
                      className={`flex-row items-center gap-2.5 py-2 ${
                        i > 0 ? "border-t border-border/30" : ""
                      }`}
                    >
                      <AlertCircle size={13} color="#EF4444" />
                      <Text className="text-xs text-muted-foreground flex-1">
                        {formatVerificationItem(item)}
                      </Text>
                    </View>
                  ))}
                </View>
              </Animated.View>
            )}

          {/* Account Details (when active) */}
          {isActive && (
            <Animated.View
              entering={FadeInDown.delay(100)
                .duration(300)
                .springify()
                .damping(18)}
            >
              <View className="px-5 pt-6 pb-2">
                <Text className="text-xs font-sans-semibold text-muted-foreground uppercase tracking-wider">
                  Account Details
                </Text>
              </View>

              <View className="bg-card mx-4 rounded-2xl border border-border">
                <DetailRow
                  icon={<Building2 size={16} color="#6B7280" />}
                  label="Stripe Account"
                  value={
                    connectAccount?.stripeAccountId
                      ? `••${connectAccount.stripeAccountId.slice(-6)}`
                      : "Connected"
                  }
                />
                <View className="ml-14 h-px bg-border" />
                <DetailRow
                  icon={<ShieldCheck size={16} color="#22C55E" />}
                  label="Identity Verification"
                  value="Verified"
                  valueColor="#22C55E"
                />
                <View className="ml-14 h-px bg-border" />
                <DetailRow
                  icon={<CreditCard size={16} color="#3B82F6" />}
                  label="Charges"
                  value="Enabled"
                  valueColor="#22C55E"
                />
                <View className="ml-14 h-px bg-border" />
                <DetailRow
                  icon={<Clock size={16} color="#8A40CF" />}
                  label="Payouts"
                  value="Enabled"
                  valueColor="#22C55E"
                />
              </View>
            </Animated.View>
          )}

          {/* Manage on Stripe */}
          <Animated.View
            entering={FadeInDown.delay(isActive ? 150 : 100)
              .duration(300)
              .springify()
              .damping(18)}
            className="mx-4 mt-6"
          >
            <Pressable
              onPress={handleOpenStripe}
              className="bg-card rounded-2xl border border-border p-4 flex-row items-center active:bg-secondary/50"
            >
              <View className="w-10 h-10 rounded-xl bg-muted/50 items-center justify-center mr-3">
                <ExternalLink size={18} color="#6B7280" />
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-sans-semibold text-foreground">
                  {isActive ? "Manage Stripe Account" : "Open Stripe Setup"}
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  Update bank details, tax info, and identity verification
                </Text>
              </View>
            </Pressable>
          </Animated.View>

          {/* Refresh Status */}
          <Animated.View
            entering={FadeInDown.delay(isActive ? 200 : 150)
              .duration(300)
              .springify()
              .damping(18)}
            className="items-center mt-6"
          >
            <Pressable
              onPress={handleRefresh}
              disabled={refreshing}
              className="active:opacity-60"
            >
              <Text className="text-xs font-sans-semibold text-primary">
                {refreshing ? "Checking..." : "Refresh Status"}
              </Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      )}
    </View>
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <View className="flex-row items-center gap-2.5">
      {done ? (
        <CheckCircle size={15} color="#22C55E" />
      ) : (
        <AlertCircle size={15} color="#6B7280" />
      )}
      <Text
        className={`text-sm ${done ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View className="flex-row items-center px-4 py-3.5 gap-3">
      <View className="w-8 items-center">{icon}</View>
      <Text className="text-sm text-foreground flex-1">{label}</Text>
      <Text
        className="text-sm font-sans-semibold"
        style={{ color: valueColor || "#999" }}
      >
        {value}
      </Text>
    </View>
  );
}

function formatVerificationItem(item: string): string {
  const MAP: Record<string, string> = {
    individual_id_number: "Government-issued ID number",
    individual_address: "Personal address verification",
    individual_dob: "Date of birth",
    individual_ssn_last_4: "Last 4 digits of SSN",
    business_url: "Business website URL",
    business_profile: "Business profile information",
    external_account: "Bank account or debit card",
    tos_acceptance: "Terms of service acceptance",
  };
  return (MAP[item] || item.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
}
