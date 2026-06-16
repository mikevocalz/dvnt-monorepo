/**
 * Host / Organizer Payments Hub
 *
 * Dashboard for event organizers:
 * - Payouts overview (balance, pending, next payout)
 * - Payout history
 * - Transactions ledger
 * - Disputes / chargebacks
 * - Bank / verification status
 * - Branding (logo for receipts)
 *
 * Supports all connect account states:
 * - not_started → full onboarding CTA
 * - onboarding_incomplete → continue setup banner
 * - restricted → verification warning
 * - active → full dashboard with balance + nav
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  DollarSign,
  Banknote,
  BarChart3,
  AlertTriangle,
  Settings,
  Palette,
  ChevronRight,
  CheckCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  ShieldAlert,
  CreditCard,
  TrendingUp,
  Shield,
} from "lucide-react-native";
import { HostPaymentsDashboardSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { hostPayoutsApi, connectApi } from "@dvnt/app/lib/api/payments";
import type { PayoutSummary, ConnectAccount } from "@dvnt/app/lib/types/payments";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function HostPaymentsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Organizer Payments",
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
    payoutSummary,
    payoutSummaryLoading,
    connectAccount,
    connectLoading,
    setPayoutSummary,
    setPayoutSummaryLoading,
    setConnectAccount,
    setConnectLoading,
  } = usePaymentsStore();

  const loadData = useCallback(async () => {
    setPayoutSummaryLoading(true);
    setConnectLoading(true);
    try {
      const [summary, account] = await Promise.all([
        hostPayoutsApi.getSummary(),
        connectApi.getStatus(),
      ]);
      setPayoutSummary(summary);
      setConnectAccount(account);
    } catch (err) {
      console.error("[HostPayments] loadData error:", err);
    } finally {
      setPayoutSummaryLoading(false);
      setConnectLoading(false);
    }
  }, [
    setPayoutSummary,
    setPayoutSummaryLoading,
    setConnectAccount,
    setConnectLoading,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isLoading = payoutSummaryLoading || connectLoading;
  const accountStatus = connectAccount?.status ?? "not_started";
  const isActive = accountStatus === "active";
  const isRestricted = accountStatus === "restricted";
  const isIncomplete = accountStatus === "onboarding_incomplete";
  const isNotStarted = accountStatus === "not_started";

  return (
    <View className="flex-1 bg-background">
      {isLoading && !payoutSummary && !connectAccount ? (
        <HostPaymentsDashboardSkeleton />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Not Started: Full onboarding CTA ── */}
          {isNotStarted && (
            <Animated.View
              entering={FadeInDown.delay(50)
                .duration(300)
                .springify()
                .damping(18)}
              className="mx-4 mt-4"
            >
              <View className="bg-card rounded-2xl border border-border overflow-hidden">
                <View className="bg-primary/5 px-5 pt-5 pb-4">
                  <View className="w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center mb-4">
                    <CreditCard size={28} color="#8A40CF" />
                  </View>
                  <Text className="text-xl font-sans-bold text-foreground">
                    Start Receiving Payouts
                  </Text>
                  <Text className="text-sm text-muted-foreground mt-1.5 leading-5">
                    Connect your bank account through Stripe to receive ticket
                    revenue from your events. Setup takes about 5 minutes.
                  </Text>
                </View>
                <View className="px-5 pb-5 pt-4 gap-3">
                  <View className="flex-row items-center gap-2.5">
                    <DollarSign size={14} color="#22C55E" />
                    <Text className="text-xs text-muted-foreground">
                      Revenue minus 5% platform fee + Stripe processing
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2.5">
                    <Shield size={14} color="#3B82F6" />
                    <Text className="text-xs text-muted-foreground">
                      Banking info secured by Stripe — never on our servers
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2.5">
                    <Banknote size={14} color="#8A40CF" />
                    <Text className="text-xs text-muted-foreground">
                      Payouts released 5 business days after events end
                    </Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      router.push("/(protected)/events/organizer-setup" as any)
                    }
                    className="bg-primary rounded-xl py-3.5 flex-row items-center justify-center gap-2 mt-2 active:opacity-80"
                  >
                    <ExternalLink size={16} color="#000" />
                    <Text className="text-[15px] font-sans-bold text-primary-foreground">
                      Connect with Stripe
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          )}

          {/* ── Incomplete Onboarding Banner ── */}
          {isIncomplete && (
            <Animated.View
              entering={FadeInDown.delay(50)
                .duration(300)
                .springify()
                .damping(18)}
              className="mx-4 mt-4"
            >
              <Pressable
                onPress={() =>
                  router.push("/(protected)/events/organizer-setup" as any)
                }
                className="bg-orange-500/8 rounded-2xl border border-orange-500/20 p-4 active:opacity-80"
              >
                <View className="flex-row items-start gap-3">
                  <View className="w-10 h-10 rounded-xl bg-orange-500/10 items-center justify-center">
                    <AlertCircle size={20} color="#F97316" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-sans-bold text-foreground">
                      Complete Your Setup
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
                      Your Stripe account needs more information before you can
                      receive payouts. Tap to continue where you left off.
                    </Text>
                    <View className="flex-row items-center gap-1.5 mt-2.5">
                      <ExternalLink size={13} color="#F97316" />
                      <Text className="text-xs font-sans-semibold text-orange-400">
                        Continue Setup
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          )}

          {/* ── Restricted Account Banner ── */}
          {isRestricted && (
            <Animated.View
              entering={FadeInDown.delay(50)
                .duration(300)
                .springify()
                .damping(18)}
              className="mx-4 mt-4"
            >
              <Pressable
                onPress={() =>
                  router.push("/(protected)/events/organizer-setup" as any)
                }
                className="bg-destructive/8 rounded-2xl border border-destructive/20 p-4 active:opacity-80"
              >
                <View className="flex-row items-start gap-3">
                  <View className="w-10 h-10 rounded-xl bg-destructive/10 items-center justify-center">
                    <ShieldAlert size={20} color="#EF4444" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-sans-bold text-foreground">
                      Verification Required
                    </Text>
                    <Text className="text-xs text-muted-foreground mt-0.5 leading-4">
                      Stripe requires additional verification. Payouts are
                      paused until you provide the required information.
                    </Text>
                    {connectAccount?.pendingVerification &&
                      connectAccount.pendingVerification.length > 0 && (
                        <Text className="text-[10px] text-destructive/70 mt-1.5">
                          {connectAccount.pendingVerification.length} item
                          {connectAccount.pendingVerification.length > 1
                            ? "s"
                            : ""}{" "}
                          need attention
                        </Text>
                      )}
                    <View className="flex-row items-center gap-1.5 mt-2.5">
                      <ExternalLink size={13} color="#EF4444" />
                      <Text className="text-xs font-sans-semibold text-destructive">
                        Update Verification
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          )}

          {/* ── Active: Balance Card ── */}
          {isActive && payoutSummary && (
            <Animated.View
              entering={FadeInDown.delay(50)
                .duration(300)
                .springify()
                .damping(18)}
              className="mx-4 mt-2 bg-card rounded-2xl border border-border p-5"
            >
              <Text className="text-xs font-sans-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Balance Overview
              </Text>

              <View className="flex-row gap-4">
                <BalanceItem
                  label="Available"
                  amount={payoutSummary.availableBalanceCents}
                  color="#22C55E"
                />
                <BalanceItem
                  label="Pending"
                  amount={payoutSummary.pendingBalanceCents}
                  color="#EAB308"
                />
                <BalanceItem
                  label="Total Paid"
                  amount={payoutSummary.totalPayoutsCents}
                  color="#3B82F6"
                />
              </View>

              {payoutSummary.nextPayoutEstimate && (
                <View className="flex-row items-center gap-2 mt-4 pt-3 border-t border-border">
                  <Clock size={14} color="#666" />
                  <Text className="text-xs text-muted-foreground">
                    Next payout: {payoutSummary.nextPayoutEstimate}
                  </Text>
                </View>
              )}

              {payoutSummary.totalEventsPaidOut > 0 && (
                <View className="flex-row items-center gap-2 mt-2">
                  <TrendingUp size={14} color="#666" />
                  <Text className="text-xs text-muted-foreground">
                    {payoutSummary.totalEventsPaidOut} event
                    {payoutSummary.totalEventsPaidOut > 1 ? "s" : ""} paid out
                  </Text>
                </View>
              )}
            </Animated.View>
          )}

          {/* ── Active: Connected badge (compact) ── */}
          {isActive && (
            <Animated.View
              entering={FadeInDown.delay(100)
                .duration(300)
                .springify()
                .damping(18)}
              className="mx-4 mt-3"
            >
              <View className="bg-green-500/5 rounded-xl border border-green-500/15 px-4 py-2.5 flex-row items-center">
                <CheckCircle size={14} color="#22C55E" />
                <Text className="text-xs font-sans-semibold text-green-400 ml-2 flex-1">
                  Stripe Connected
                </Text>
                <Text className="text-[10px] text-muted-foreground">
                  Charges & payouts enabled
                </Text>
              </View>
            </Animated.View>
          )}

          {/* ── Navigation: Financial ── */}
          <Animated.View
            entering={FadeInDown.delay(isNotStarted ? 100 : 150)
              .duration(300)
              .springify()
              .damping(18)}
          >
            <SectionHeader title="Financial" />
            <NavRow
              icon={<Banknote size={20} color="#22C55E" />}
              label="Payout History"
              subtitle="View all payouts to your bank"
              onPress={() => router.push("/settings/host-payouts" as any)}
            />
            <Divider />
            <NavRow
              icon={<BarChart3 size={20} color="#3B82F6" />}
              label="Transactions"
              subtitle="Full ledger: fees, refunds, adjustments"
              onPress={() => router.push("/settings/host-transactions" as any)}
            />
            <Divider />
            <NavRow
              icon={<AlertTriangle size={20} color="#F97316" />}
              label="Disputes & Chargebacks"
              subtitle="Manage disputes and respond"
              onPress={() => router.push("/settings/host-disputes" as any)}
            />
          </Animated.View>

          {/* ── Navigation: Settings ── */}
          <Animated.View
            entering={FadeInDown.delay(isNotStarted ? 150 : 200)
              .duration(300)
              .springify()
              .damping(18)}
          >
            <SectionHeader title="Settings" />
            <NavRow
              icon={<Settings size={20} color="#6B7280" />}
              label="Bank & Verification"
              subtitle="Payout account, identity, and requirements"
              onPress={() =>
                router.push("/settings/host-bank-verification" as any)
              }
            />
            <Divider />
            <NavRow
              icon={<Palette size={20} color="#8A40CF" />}
              label="Receipt Branding"
              subtitle="Logo and branding for receipts & invoices"
              onPress={() => router.push("/settings/host-branding" as any)}
            />
          </Animated.View>
        </ScrollView>
      )}
    </View>
  );
}

function BalanceItem({
  label,
  amount,
  color,
}: {
  label: string;
  amount: number;
  color: string;
}) {
  return (
    <View className="flex-1">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-lg font-sans-bold mt-0.5" style={{ color }}>
        {formatCents(amount)}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View className="px-5 pt-6 pb-2">
      <Text className="text-xs font-sans-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </Text>
    </View>
  );
}

function NavRow({
  icon,
  label,
  subtitle,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-card px-5 py-3.5 active:bg-secondary/50"
    >
      <View className="w-10 h-10 rounded-xl bg-muted/50 items-center justify-center mr-3">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-sans-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5">{subtitle}</Text>
      </View>
      <ChevronRight size={18} color="#666" />
    </Pressable>
  );
}

function Divider() {
  return <View className="ml-[68px] h-px bg-border" />;
}
