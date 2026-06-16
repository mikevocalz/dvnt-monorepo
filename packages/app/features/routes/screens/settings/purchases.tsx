/**
 * Purchases / Order History Screen
 *
 * Lists all purchases with status chips, payment info, and receipt links.
 * States: loading, empty, error.
 * No waterfall: single payload for first render.
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  ShoppingBag,
  ChevronRight,
  Receipt,
  AlertCircle,
  Calendar,
  CreditCard,
} from "lucide-react-native";
import { LegendList } from "@dvnt/app/components/list";
import { PaymentsListSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import { PAYMENT_STATUS_CONFIG, type Order } from "@dvnt/app/lib/types/payments";

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

export default function PurchasesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Purchases",
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
    purchases,
    purchasesLoading,
    purchasesError,
    setPurchases,
    setPurchasesLoading,
    setPurchasesError,
  } = usePaymentsStore();

  const loadPurchases = useCallback(async () => {
    setPurchasesLoading(true);
    setPurchasesError(null);
    try {
      const result = await purchasesApi.list();
      setPurchases(result.data);
    } catch (err: any) {
      setPurchasesError(err.message || "Failed to load purchases");
    } finally {
      setPurchasesLoading(false);
    }
  }, [setPurchases, setPurchasesLoading, setPurchasesError]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  return (
    <View className="flex-1 bg-background">
      {/* Loading */}
      {purchasesLoading && purchases.length === 0 && (
        <PaymentsListSkeleton rows={5} />
      )}

      {/* Error */}
      {purchasesError && !purchasesLoading && (
        <Animated.View
          entering={FadeIn.duration(300)}
          className="flex-1 items-center justify-center px-8"
        >
          <AlertCircle size={48} color="rgba(239,68,68,0.4)" />
          <Text className="text-foreground font-sans-semibold mt-3">
            Failed to load purchases
          </Text>
          <Pressable
            onPress={loadPurchases}
            className="mt-4 bg-primary/10 rounded-xl px-5 py-2.5"
          >
            <Text className="text-primary font-sans-semibold">Retry</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Empty */}
      {!purchasesLoading && !purchasesError && purchases.length === 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <ShoppingBag size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No purchases yet
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Your ticket purchases and other orders will appear here
          </Text>
          <Pressable
            onPress={() => router.push("/(protected)/(tabs)/events" as any)}
            className="mt-6 bg-primary rounded-2xl px-6 py-3"
          >
            <Text className="text-primary-foreground font-sans-semibold">
              Browse Events
            </Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Purchases List */}
      {purchases.length > 0 && (
        <LegendList
          data={purchases}
          keyExtractor={(item: Order) => item.id}
          renderItem={({ item, index }: { item: Order; index: number }) => (
            <PurchaseCard order={item} index={index} />
          )}
          estimatedItemSize={100}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: insets.bottom + 20,
          }}
          onRefresh={loadPurchases}
          refreshing={purchasesLoading}
        />
      )}
    </View>
  );
}

function PurchaseCard({ order, index }: { order: Order; index: number }) {
  const router = useRouter();
  const statusConfig =
    PAYMENT_STATUS_CONFIG[order.status] || PAYMENT_STATUS_CONFIG.pending;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50)
        .duration(300)
        .springify()
        .damping(18)}
    >
      <Pressable
        onPress={() => router.push(`/settings/order/${order.id}` as any)}
        className="mx-4 mb-3 bg-card rounded-2xl border border-border overflow-hidden active:bg-secondary/50"
      >
        <View className="p-4">
          {/* Top row: title + status */}
          <View className="flex-row items-start justify-between mb-2">
            <View className="flex-1 mr-3">
              <Text
                className="text-[15px] font-sans-semibold text-foreground"
                numberOfLines={1}
              >
                {order.event?.title || order.type.replace(/_/g, " ")}
              </Text>
              <View className="flex-row items-center gap-2 mt-1">
                <Calendar size={12} color="#666" />
                <Text className="text-xs text-muted-foreground">
                  {formatDate(order.createdAt)}
                </Text>
              </View>
            </View>

            {/* Status chip */}
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

          {/* Bottom row: amount + payment + receipt */}
          <View className="flex-row items-center justify-between mt-1">
            <View className="flex-row items-center gap-3">
              <Text className="text-base font-sans-bold text-foreground">
                {formatCents(order.fees.totalCents)}
              </Text>
              {order.paymentMethodBrand && (
                <View className="flex-row items-center gap-1">
                  <CreditCard size={12} color="#666" />
                  <Text className="text-xs text-muted-foreground">
                    ••{order.paymentMethodLast4}
                  </Text>
                </View>
              )}
            </View>

            <View className="flex-row items-center gap-1">
              {order.receiptAvailable && <Receipt size={14} color="#22C55E" />}
              <ChevronRight size={16} color="#666" />
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
