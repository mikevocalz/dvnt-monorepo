/**
 * Receipts & Invoices List Screen
 *
 * Shows all orders that have receipts available.
 * Tap to open in the receipt viewer with print/share.
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  Receipt,
  FileText,
  Calendar,
  Printer,
  Share2,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { LegendList } from "@dvnt/app/components/list";
import { PaymentsListSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import { printHtml, shareHtmlAsPdf } from "@dvnt/app/lib/print/print-utils";
import { receiptPdfHtml } from "@dvnt/app/lib/print/thermal-templates";
import type { Order } from "@dvnt/app/lib/types/payments";

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

export default function ReceiptsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Receipts & Invoices",
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

  const { purchases, purchasesLoading, setPurchases, setPurchasesLoading } =
    usePaymentsStore();

  const loadPurchases = useCallback(async () => {
    setPurchasesLoading(true);
    try {
      const result = await purchasesApi.list();
      setPurchases(result.data);
    } catch (err) {
      console.error("[Receipts] load error:", err);
    } finally {
      setPurchasesLoading(false);
    }
  }, [setPurchases, setPurchasesLoading]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  // Filter to only paid orders
  const paidOrders = purchases.filter(
    (o) =>
      o.status === "paid" ||
      o.status === "partially_refunded" ||
      o.status === "refunded",
  );

  return (
    <View className="flex-1 bg-background">
      {purchasesLoading && paidOrders.length === 0 && (
        <PaymentsListSkeleton rows={4} />
      )}

      {!purchasesLoading && paidOrders.length === 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <Receipt size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No receipts yet
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Receipts are generated for paid purchases
          </Text>
        </Animated.View>
      )}

      {paidOrders.length > 0 && (
        <LegendList
          data={paidOrders}
          keyExtractor={(item: Order) => item.id}
          renderItem={({ item, index }: { item: Order; index: number }) => (
            <ReceiptCard order={item} index={index} />
          )}
          estimatedItemSize={88}
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

function ReceiptCard({ order, index }: { order: Order; index: number }) {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);

  const handlePrint = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const html = receiptPdfHtml({ order });
    const result = await printHtml(html);
    if (!result.success) {
      showToast("error", "Print Failed", result.error || "Unable to print");
    }
  }, [order, showToast]);

  const handleShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const html = receiptPdfHtml({ order });
    const result = await shareHtmlAsPdf(html);
    if (!result.success) {
      showToast("error", "Share Failed", result.error || "Unable to share");
    }
  }, [order, showToast]);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50)
        .duration(300)
        .springify()
        .damping(18)}
    >
      <Pressable
        onPress={() =>
          router.push(
            `/settings/receipt-viewer?orderId=${order.id}&type=receipt` as any,
          )
        }
        className="mx-4 mb-3 bg-card rounded-2xl border border-border overflow-hidden active:bg-secondary/50"
      >
        <View className="p-4">
          <View className="flex-row items-start justify-between">
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
            <Text className="text-base font-sans-bold text-foreground">
              {formatCents(order.fees.totalCents)}
            </Text>
          </View>

          {/* Quick actions */}
          <View className="flex-row gap-2 mt-3 pt-3 border-t border-border">
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                handlePrint();
              }}
              className="flex-row items-center gap-1.5 bg-muted/30 rounded-xl px-3 py-2"
              hitSlop={4}
            >
              <Printer size={14} color="#666" />
              <Text className="text-xs text-muted-foreground font-sans-semibold">
                Print
              </Text>
            </Pressable>
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                handleShare();
              }}
              className="flex-row items-center gap-1.5 bg-muted/30 rounded-xl px-3 py-2"
              hitSlop={4}
            >
              <Share2 size={14} color="#666" />
              <Text className="text-xs text-muted-foreground font-sans-semibold">
                Share
              </Text>
            </Pressable>
            <View className="flex-1" />
            <View className="flex-row items-center gap-1">
              <FileText size={14} color="#22C55E" />
              <Text className="text-xs text-green-400 font-sans-semibold">
                Receipt
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}
