/**
 * Settings → Payments (Attendee)
 *
 * Hub screen for all attendee payment management:
 * - Payment Methods
 * - Purchases / Orders
 * - Receipts & Invoices
 * - Refunds & Disputes
 */

import { useLayoutEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  CreditCard,
  Receipt,
  RotateCcw,
  ShoppingBag,
  ChevronRight,
} from "lucide-react-native";

export default function PaymentsSettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Payments",
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

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Payment Methods */}
        <Animated.View
          entering={FadeInDown.delay(50).duration(300).springify().damping(18)}
        >
          <SectionHeader title="Payment Methods" />
          <SettingsRow
            icon={<CreditCard size={20} color="#8A40CF" />}
            label="Cards & Banks"
            subtitle="Manage your payment methods"
            onPress={() => router.push("/settings/payment-methods" as any)}
          />
        </Animated.View>

        {/* Purchases */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(300).springify().damping(18)}
        >
          <SectionHeader title="Purchases" />
          <SettingsRow
            icon={<ShoppingBag size={20} color="#3B82F6" />}
            label="Order History"
            subtitle="View all your purchases"
            onPress={() => router.push("/settings/purchases" as any)}
          />
          <Divider />
          <SettingsRow
            icon={<Receipt size={20} color="#22C55E" />}
            label="Receipts & Invoices"
            subtitle="View, print, and share receipts"
            onPress={() => router.push("/settings/receipts" as any)}
          />
        </Animated.View>

        {/* Refunds & Disputes */}
        <Animated.View
          entering={FadeInDown.delay(150).duration(300).springify().damping(18)}
        >
          <SectionHeader title="Refunds & Disputes" />
          <SettingsRow
            icon={<RotateCcw size={20} color="#F97316" />}
            label="Refunds"
            subtitle="Track refund requests and status"
            onPress={() => router.push("/settings/refunds" as any)}
          />
        </Animated.View>
      </ScrollView>
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

function SettingsRow({
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
