/**
 * Host Payout History Screen
 *
 * Lists all payouts to the organizer's bank with status chips,
 * amounts, event names, and arrival dates.
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  Banknote,
  AlertCircle,
  Calendar,
  Zap,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from "lucide-react-native";
import { LegendList } from "@dvnt/app/components/list";
import { PaymentsListSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { hostPayoutsApi } from "@dvnt/app/lib/api/payments";
import {
  PAYOUT_STATUS_CONFIG,
  type PayoutRecord,
  type FailedPayout,
} from "@dvnt/app/lib/types/payments";

const ORGANIZER_SETUP_ROUTE = "/(protected)/events/organizer-setup";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function HostPayoutsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Payout History",
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
    payouts,
    payoutsLoading,
    failedPayouts,
    setPayouts,
    setPayoutsLoading,
    setPayoutSummary,
    setFailedPayouts,
  } = usePaymentsStore();

  const loadPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    try {
      const [result, summary, failed] = await Promise.all([
        hostPayoutsApi.listPayouts(),
        hostPayoutsApi.getSummary(),
        hostPayoutsApi.listFailedPayouts(),
      ]);
      setPayouts(result.data);
      setPayoutSummary(summary);
      setFailedPayouts(failed);
    } catch (err) {
      console.error("[HostPayouts] load error:", err);
    } finally {
      setPayoutsLoading(false);
    }
  }, [
    setPayouts,
    setPayoutsLoading,
    setPayoutSummary,
    setFailedPayouts,
  ]);

  useEffect(() => {
    loadPayouts();
  }, [loadPayouts]);

  const summary = usePaymentsStore((s) => s.payoutSummary);
  const showActionsHeader =
    !payoutsLoading &&
    (failedPayouts.length > 0 ||
      (!!summary?.instantPayoutEligible &&
        (summary?.instantAvailableCents ?? 0) > 0));

  return (
    <View className="flex-1 bg-background">
      {payoutsLoading && payouts.length === 0 && (
        <PaymentsListSkeleton rows={5} />
      )}

      {showActionsHeader && (
        <View className="px-4 pt-3">
          {failedPayouts.map((f) => (
            <FailedPayoutBanner
              key={f.id}
              failure={f}
              onRetried={loadPayouts}
            />
          ))}
          <InstantPayoutCard onDone={loadPayouts} />
        </View>
      )}

      {!payoutsLoading && payouts.length === 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <Banknote size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No payouts yet
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Payouts are released after your events end
          </Text>
        </Animated.View>
      )}

      {payouts.length > 0 && (
        <LegendList
          data={payouts}
          keyExtractor={(item: PayoutRecord) => item.id}
          renderItem={({
            item,
            index,
          }: {
            item: PayoutRecord;
            index: number;
          }) => <PayoutCard payout={item} index={index} />}
          estimatedItemSize={100}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: insets.bottom + 20,
          }}
          onRefresh={loadPayouts}
          refreshing={payoutsLoading}
        />
      )}
    </View>
  );
}

function PayoutCard({
  payout,
  index,
}: {
  payout: PayoutRecord;
  index: number;
}) {
  const statusConfig =
    PAYOUT_STATUS_CONFIG[payout.status] || PAYOUT_STATUS_CONFIG.pending;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50)
        .duration(300)
        .springify()
        .damping(18)}
    >
      <View className="mx-4 mb-3 bg-card rounded-2xl border border-border p-4">
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-1 mr-3">
            <Text
              className="text-[15px] font-sans-semibold text-foreground"
              numberOfLines={1}
            >
              {payout.eventTitle}
            </Text>
            <View className="flex-row items-center gap-2 mt-1">
              <Calendar size={12} color="#666" />
              <Text className="text-xs text-muted-foreground">
                Released {formatDate(payout.releaseAt)}
              </Text>
            </View>
          </View>
          <View
            className="rounded-full px-2.5 py-1"
            style={{ backgroundColor: statusConfig.bg }}
          >
            <Text
              className="text-[10px] font-sans-bold"
              style={{ color: statusConfig.text }}
            >
              {statusConfig.label}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-border">
          <View>
            <Text className="text-xs text-muted-foreground">Net Payout</Text>
            <Text className="text-lg font-sans-bold text-green-400">
              {formatCents(payout.netCents)}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-xs text-muted-foreground">Gross</Text>
            <Text className="text-sm text-foreground">
              {formatCents(payout.grossCents)}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-xs text-muted-foreground">Fees</Text>
            <Text className="text-sm text-destructive">
              -{formatCents(payout.feeCents)}
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

/** Instant-payout affordance — rendered only when the account is eligible;
 *  otherwise the standard schedule applies (no button, no false promise). */
function InstantPayoutCard({ onDone }: { onDone: () => void }) {
  const summary = usePaymentsStore((s) => s.payoutSummary);
  const loading = usePaymentsStore((s) => s.payoutActionLoading);
  const setLoading = usePaymentsStore((s) => s.setPayoutActionLoading);
  const showToast = useUIStore((s) => s.showToast);

  const eligible = !!summary?.instantPayoutEligible;
  const instantCents = summary?.instantAvailableCents ?? 0;
  if (!eligible || instantCents <= 0) return null;

  const handleInstant = async () => {
    setLoading(true);
    try {
      const res = await hostPayoutsApi.requestInstantPayout();
      if (res.ok) {
        showToast(
          "success",
          "Instant payout sent",
          `${formatCents(res.amountCents ?? instantCents)} is on its way.`,
        );
        onDone();
      } else {
        showToast(
          "error",
          "Couldn't send",
          res.message || "Instant payout failed.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="mb-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Zap size={14} color="#3FDCFF" />
            <Text className="text-sm font-sans-semibold text-foreground">
              Instant payout available
            </Text>
          </View>
          <Text className="text-lg font-mono text-cyan-300 mt-0.5">
            {formatCents(instantCents)}
          </Text>
        </View>
        <Pressable
          onPress={handleInstant}
          disabled={loading}
          className="rounded-lg bg-cyan-400 px-4 py-2.5"
          style={{ opacity: loading ? 0.6 : 1 }}
        >
          <Text className="text-sm font-sans-bold text-[#06070d]">
            {loading ? "Sending…" : "Pay out now"}
          </Text>
        </Pressable>
      </View>
      <Text className="text-xs text-muted-foreground mt-2">
        Arrives in minutes to your debit card. A standard fee applies.
      </Text>
    </View>
  );
}

/** Recovery flow for a failed bank payout — actionable reason, an "Update
 *  bank details" deep link, and a retry where eligible. Never a bare chip. */
function FailedPayoutBanner({
  failure,
  onRetried,
}: {
  failure: FailedPayout;
  onRetried: () => void;
}) {
  const router = useRouter();
  const loading = usePaymentsStore((s) => s.payoutActionLoading);
  const setLoading = usePaymentsStore((s) => s.setPayoutActionLoading);
  const showToast = useUIStore((s) => s.showToast);

  const handleRetry = async () => {
    setLoading(true);
    try {
      const res = await hostPayoutsApi.retryPayout();
      if (res.ok) {
        showToast(
          "success",
          "Payout retried",
          `${formatCents(res.amountCents ?? failure.amountCents)} is on its way.`,
        );
        onRetried();
      } else {
        showToast("error", "Retry failed", res.message || "Try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/8 p-4">
      <View className="flex-row items-start gap-2.5">
        <AlertTriangle size={16} color="#EF4444" style={{ marginTop: 2 }} />
        <View className="flex-1">
          <Text className="text-sm font-sans-semibold text-foreground">
            Payout of {formatCents(failure.amountCents)} failed
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {failure.failureMessage ||
              "Your bank rejected the transfer. Update your bank details to try again."}
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-3">
            <Pressable
              onPress={() => router.push(ORGANIZER_SETUP_ROUTE as any)}
              className="flex-row items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2"
            >
              <ExternalLink size={13} color="#fff" />
              <Text className="text-xs font-sans-semibold text-foreground">
                Update bank details
              </Text>
            </Pressable>
            {failure.reconcilable ? (
              <Pressable
                onPress={handleRetry}
                disabled={loading}
                className="flex-row items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2"
                style={{ opacity: loading ? 0.6 : 1 }}
              >
                <RefreshCw size={13} color="#fff" />
                <Text className="text-xs font-sans-semibold text-foreground">
                  {loading ? "Retrying…" : "Retry payout"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
