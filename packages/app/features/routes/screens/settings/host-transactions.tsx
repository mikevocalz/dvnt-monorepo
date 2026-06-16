/**
 * Host Transactions Ledger Screen
 *
 * Full financial ledger: charges, refunds, fees, adjustments, payouts.
 * Filterable by transaction type.
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  BarChart3,
  ArrowUpRight,
  ArrowDownLeft,
  Minus,
  Filter,
} from "lucide-react-native";
import { LegendList } from "@dvnt/app/components/list";
import { PaymentsListSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { hostTransactionsApi } from "@dvnt/app/lib/api/payments";
import type { BalanceTransaction, TransactionType } from "@dvnt/app/lib/types/payments";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCents(cents: number): string {
  const sign = cents >= 0 ? "+" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

const TYPE_ICON_MAP: Record<
  TransactionType,
  { icon: typeof ArrowUpRight; color: string }
> = {
  charge: { icon: ArrowDownLeft, color: "#22C55E" },
  refund: { icon: ArrowUpRight, color: "#F97316" },
  payout: { icon: ArrowUpRight, color: "#3B82F6" },
  fee: { icon: Minus, color: "#EF4444" },
  adjustment: { icon: Minus, color: "#6B7280" },
  transfer: { icon: ArrowUpRight, color: "#8A40CF" },
};

const FILTER_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Charges", value: "charge" },
  { label: "Refunds", value: "refund" },
  { label: "Payouts", value: "payout" },
  { label: "Fees", value: "fee" },
];

export default function HostTransactionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Transactions",
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
    transactions,
    transactionsLoading,
    transactionsFilter,
    setTransactions,
    setTransactionsLoading,
    setTransactionsFilter,
  } = usePaymentsStore();

  const loadTransactions = useCallback(async () => {
    setTransactionsLoading(true);
    try {
      const result = await hostTransactionsApi.list(
        undefined,
        transactionsFilter,
      );
      setTransactions(result.data);
    } catch (err) {
      console.error("[HostTransactions] load error:", err);
    } finally {
      setTransactionsLoading(false);
    }
  }, [setTransactions, setTransactionsLoading, transactionsFilter]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  return (
    <View className="flex-1 bg-background">
      {/* Filter chips */}
      <View className="flex-row px-4 pb-3 gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = transactionsFilter === opt.value;
          return (
            <Pressable
              key={opt.label}
              onPress={() => setTransactionsFilter(opt.value)}
              className={`px-3 py-1.5 rounded-full border ${
                isActive
                  ? "bg-primary/10 border-primary/30"
                  : "bg-card border-border"
              }`}
            >
              <Text
                className={`text-xs font-sans-semibold ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {transactionsLoading && transactions.length === 0 && (
        <PaymentsListSkeleton rows={6} />
      )}

      {!transactionsLoading && transactions.length === 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <BarChart3 size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No transactions
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Financial activity will appear here
          </Text>
        </Animated.View>
      )}

      {transactions.length > 0 && (
        <LegendList
          data={transactions}
          keyExtractor={(item: BalanceTransaction) => item.id}
          renderItem={({
            item,
            index,
          }: {
            item: BalanceTransaction;
            index: number;
          }) => <TransactionRow txn={item} index={index} />}
          estimatedItemSize={72}
          contentContainerStyle={{
            paddingTop: 4,
            paddingBottom: insets.bottom + 20,
          }}
          onRefresh={loadTransactions}
          refreshing={transactionsLoading}
        />
      )}
    </View>
  );
}

function TransactionRow({
  txn,
  index,
}: {
  txn: BalanceTransaction;
  index: number;
}) {
  const typeConfig = TYPE_ICON_MAP[txn.type] || TYPE_ICON_MAP.adjustment;
  const Icon = typeConfig.icon;
  const isPositive = txn.amountCents >= 0;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 30)
        .duration(250)
        .springify()
        .damping(20)}
    >
      <View className="flex-row items-center px-4 py-3 border-b border-border/50">
        <View
          className="w-9 h-9 rounded-xl items-center justify-center mr-3"
          style={{ backgroundColor: `${typeConfig.color}15` }}
        >
          <Icon size={16} color={typeConfig.color} />
        </View>
        <View className="flex-1">
          <Text
            className="text-sm font-sans-semibold text-foreground"
            numberOfLines={1}
          >
            {txn.description}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {formatDate(txn.createdAt)}
            {txn.eventTitle ? ` • ${txn.eventTitle}` : ""}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className={`text-sm font-sans-bold ${
              isPositive ? "text-green-400" : "text-destructive"
            }`}
          >
            {formatCents(txn.amountCents)}
          </Text>
          {txn.feeCents > 0 && (
            <Text className="text-[10px] text-muted-foreground">
              Fee: ${(txn.feeCents / 100).toFixed(2)}
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}
