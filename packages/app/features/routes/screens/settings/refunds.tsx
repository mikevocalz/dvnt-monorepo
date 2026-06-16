/**
 * Refunds List Screen
 *
 * Shows all refund requests with status tracking.
 * Links to order detail for full context.
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { RotateCcw, Clock, ChevronRight } from "lucide-react-native";
import { LegendList } from "@dvnt/app/components/list";
import { PaymentsListSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { refundsApi } from "@dvnt/app/lib/api/payments";
import type { Refund } from "@dvnt/app/lib/types/payments";

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

const REFUND_STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  pending: { bg: "rgba(234, 179, 8, 0.15)", text: "#EAB308", label: "Pending" },
  requires_action: {
    bg: "rgba(249, 115, 22, 0.15)",
    text: "#F97316",
    label: "Action Required",
  },
  succeeded: {
    bg: "rgba(34, 197, 94, 0.15)",
    text: "#22C55E",
    label: "Refunded",
  },
  failed: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", label: "Failed" },
  canceled: {
    bg: "rgba(107, 114, 128, 0.15)",
    text: "#6B7280",
    label: "Canceled",
  },
};

export default function RefundsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Refunds",
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

  const { refunds, refundsLoading, setRefunds, setRefundsLoading } =
    usePaymentsStore();

  const loadRefunds = useCallback(async () => {
    setRefundsLoading(true);
    try {
      const result = await refundsApi.list();
      setRefunds(result.data);
    } catch (err) {
      console.error("[Refunds] load error:", err);
    } finally {
      setRefundsLoading(false);
    }
  }, [setRefunds, setRefundsLoading]);

  useEffect(() => {
    loadRefunds();
  }, [loadRefunds]);

  return (
    <View className="flex-1 bg-background">
      {refundsLoading && refunds.length === 0 && (
        <PaymentsListSkeleton rows={4} />
      )}

      {!refundsLoading && refunds.length === 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <RotateCcw size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No refunds
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Refund requests will appear here
          </Text>
        </Animated.View>
      )}

      {refunds.length > 0 && (
        <LegendList
          data={refunds}
          keyExtractor={(item: Refund) => item.id}
          renderItem={({ item, index }: { item: Refund; index: number }) => (
            <RefundCard refund={item} index={index} />
          )}
          estimatedItemSize={96}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: insets.bottom + 20,
          }}
          onRefresh={loadRefunds}
          refreshing={refundsLoading}
        />
      )}
    </View>
  );
}

function RefundCard({ refund, index }: { refund: Refund; index: number }) {
  const router = useRouter();
  const statusConfig =
    REFUND_STATUS_CONFIG[refund.status] || REFUND_STATUS_CONFIG.pending;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50)
        .duration(300)
        .springify()
        .damping(18)}
    >
      <Pressable
        onPress={() => router.push(`/settings/order/${refund.orderId}` as any)}
        className="mx-4 mb-3 bg-card rounded-2xl border border-border p-4 active:bg-secondary/50"
      >
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-1 mr-3">
            <Text className="text-[15px] font-sans-semibold text-foreground">
              {formatCents(refund.amountCents)} refund
              {refund.isPartial && (
                <Text className="text-muted-foreground"> (partial)</Text>
              )}
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5 capitalize">
              {refund.reason.replace(/_/g, " ")}
            </Text>
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

        <View className="flex-row items-center justify-between mt-1 pt-2 border-t border-border">
          <View className="flex-row items-center gap-2">
            <Clock size={12} color="#666" />
            <Text className="text-xs text-muted-foreground">
              Requested {formatDate(refund.createdAt)}
            </Text>
          </View>
          <ChevronRight size={14} color="#666" />
        </View>
      </Pressable>
    </Animated.View>
  );
}
