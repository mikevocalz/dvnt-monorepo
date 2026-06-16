/**
 * Payment Methods Screen
 *
 * List, add, set default, and remove payment methods.
 * States: loading, empty, error, offline.
 */

import { useEffect, useCallback, useState, useLayoutEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  CreditCard,
  Plus,
  Star,
  Trash2,
  AlertCircle,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { PaymentsListSkeleton } from "@dvnt/app/components/skeletons";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { paymentMethodsApi } from "@dvnt/app/lib/api/payments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useStripeSafe as useStripe } from "@dvnt/app/lib/safe-native-modules";
import type { PaymentMethod } from "@dvnt/app/lib/types/payments";

const BRAND_COLORS: Record<string, string> = {
  visa: "#1A1F71",
  mastercard: "#EB001B",
  amex: "#006FCF",
  discover: "#FF6000",
};

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

export default function PaymentMethodsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const navigation = useNavigation();
  const [isAdding, setIsAdding] = useState(false);

  const {
    methods,
    isLoading,
    error,
    setMethods,
    setLoading,
    setError,
    removeMethod,
    setDefault,
  } = usePaymentsStore();

  const loadMethods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await paymentMethodsApi.list();
      setMethods(result);
    } catch (err: any) {
      setError(err.message || "Failed to load payment methods");
    } finally {
      setLoading(false);
    }
  }, [setMethods, setLoading, setError]);

  useEffect(() => {
    loadMethods();
  }, [loadMethods]);

  const handleAddPaymentMethod = useCallback(async () => {
    setIsAdding(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // 1. Create SetupIntent + get ephemeral key from server
      const setup = await paymentMethodsApi.createSetupIntent();
      if (setup.error || !setup.clientSecret) {
        showToast("error", "Error", setup.error || "Failed to start setup");
        return;
      }

      // 2. Initialize PaymentSheet in setup mode
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "DVNT",
        customerId: setup.customerId,
        customerEphemeralKeySecret: setup.ephemeralKey,
        setupIntentClientSecret: setup.clientSecret,
        allowsDelayedPaymentMethods: false,
        appearance: {
          colors: {
            primary: "#8A40CF",
            background: "#1a1a1a",
            componentBackground: "#262626",
            componentText: "#ffffff",
            secondaryText: "#a1a1aa",
            placeholderText: "#71717a",
            icon: "#8A40CF",
          },
          shapes: { borderRadius: 12, borderWidth: 1 },
        },
        returnURL: "dvnt://settings/payment-methods",
      });

      if (initError) {
        console.error("[PaymentMethods] initPaymentSheet error:", initError);
        showToast(
          "error",
          "Error",
          initError.message || "Failed to initialize",
        );
        return;
      }

      // 3. Present the sheet
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code === "Canceled") return; // user cancelled
        showToast("error", "Error", presentError.message || "Setup failed");
        return;
      }

      // 4. Success — refresh the list
      showToast("success", "Added", "Payment method saved");
      loadMethods();
    } catch (err: any) {
      console.error("[PaymentMethods] Add error:", err);
      showToast("error", "Error", err.message || "Something went wrong");
    } finally {
      setIsAdding(false);
    }
  }, [initPaymentSheet, presentPaymentSheet, showToast, loadMethods]);

  const handleSetDefault = useCallback(
    async (method: PaymentMethod) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDefault(method.id);
      const result = await paymentMethodsApi.setDefault(method.id);
      if (!result.success) {
        showToast("error", "Error", result.error || "Failed to set default");
        loadMethods();
      }
    },
    [setDefault, showToast, loadMethods],
  );

  const handleRemove = useCallback(
    (method: PaymentMethod) => {
      Alert.alert(
        "Remove Payment Method",
        `Remove ${BRAND_LABELS[method.card?.brand || ""] || "this card"} ending in ${method.card?.last4 || "****"}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              removeMethod(method.id);
              const result = await paymentMethodsApi.remove(method.id);
              if (!result.success) {
                showToast("error", "Error", result.error || "Failed to remove");
                loadMethods();
              } else {
                showToast("success", "Removed", "Payment method removed");
              }
            },
          },
        ],
      );
    },
    [removeMethod, showToast, loadMethods],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerLeft: () => null,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={handleAddPaymentMethod}
            disabled={isAdding}
            hitSlop={8}
          >
            {isAdding ? (
              <ActivityIndicator size="small" color="#8A40CF" />
            ) : (
              <Plus size={22} color="#8A40CF" />
            )}
          </Pressable>
          <SettingsCloseButton />
        </View>
      ),
    });
  }, [navigation, isAdding, handleAddPaymentMethod]);

  return (
    <View className="flex-1 bg-background">
      {/* Loading */}
      {isLoading && methods.length === 0 && <PaymentsListSkeleton rows={4} />}

      {/* Error */}
      {error && !isLoading && (
        <Animated.View
          entering={FadeIn.duration(300)}
          className="flex-1 items-center justify-center px-8"
        >
          <AlertCircle size={48} color="rgba(239,68,68,0.4)" />
          <Text className="text-foreground font-sans-semibold mt-3">
            Failed to load
          </Text>
          <Text className="text-muted-foreground text-sm text-center mt-1">
            {error}
          </Text>
          <Pressable
            onPress={loadMethods}
            className="mt-4 bg-primary/10 rounded-xl px-5 py-2.5"
          >
            <Text className="text-primary font-sans-semibold">Retry</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Empty */}
      {!isLoading && !error && methods.length === 0 && (
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-1 items-center justify-center px-8"
        >
          <CreditCard size={56} color="rgba(255,255,255,0.1)" />
          <Text className="text-lg font-sans-semibold text-foreground mt-4">
            No payment methods
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Payment methods are added when you purchase tickets
          </Text>
        </Animated.View>
      )}

      {/* Methods List */}
      {methods.length > 0 && (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{
            paddingBottom: insets.bottom + 40,
            paddingTop: 8,
          }}
          showsVerticalScrollIndicator={false}
        >
          {methods.map((method, index) => (
            <Animated.View
              key={method.id}
              entering={FadeInDown.delay(index * 60)
                .duration(300)
                .springify()
                .damping(18)}
            >
              <PaymentMethodCard
                method={method}
                onSetDefault={() => handleSetDefault(method)}
                onRemove={() => handleRemove(method)}
              />
            </Animated.View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function PaymentMethodCard({
  method,
  onSetDefault,
  onRemove,
}: {
  method: PaymentMethod;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  const brand = method.card?.brand || "card";
  const brandColor = BRAND_COLORS[brand] || "#666";
  const brandLabel = BRAND_LABELS[brand] || "Card";

  return (
    <View className="bg-card rounded-2xl border border-border mb-3 overflow-hidden">
      <View className="flex-row items-center p-4">
        {/* Card icon */}
        <View
          className="w-12 h-8 rounded-lg items-center justify-center mr-3"
          style={{ backgroundColor: `${brandColor}20` }}
        >
          <CreditCard size={18} color={brandColor} />
        </View>

        {/* Card info */}
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-[15px] font-sans-semibold text-foreground">
              {brandLabel} ••{method.card?.last4}
            </Text>
            {method.isDefault && (
              <View className="bg-primary/10 rounded-full px-2 py-0.5">
                <Text className="text-[10px] font-sans-bold text-primary">
                  DEFAULT
                </Text>
              </View>
            )}
          </View>
          <Text className="text-xs text-muted-foreground mt-0.5">
            Expires {method.card?.expMonth}/{method.card?.expYear}
            {method.card?.funding === "debit" ? " • Debit" : ""}
          </Text>
        </View>

        {/* Actions */}
        <View className="flex-row gap-2">
          {!method.isDefault && (
            <Pressable
              onPress={onSetDefault}
              className="w-9 h-9 rounded-xl bg-muted/50 items-center justify-center"
              hitSlop={8}
            >
              <Star size={16} color="#EAB308" />
            </Pressable>
          )}
          <Pressable
            onPress={onRemove}
            className="w-9 h-9 rounded-xl bg-destructive/10 items-center justify-center"
            hitSlop={8}
          >
            <Trash2 size={16} color="#EF4444" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
