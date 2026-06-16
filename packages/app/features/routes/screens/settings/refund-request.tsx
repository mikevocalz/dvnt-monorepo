/**
 * Refund Request Screen
 *
 * Allows attendees to submit a refund request for a paid order.
 * Params: ?orderId=xxx
 */

import { useCallback, useLayoutEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeInDown } from "react-native-reanimated";
import { RotateCcw, AlertCircle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { create } from "zustand";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import type { RefundRequest } from "@dvnt/app/lib/types/payments";

// ── Screen-local Zustand store ────────────────────────────────

interface RefundFormState {
  reason: RefundRequest["reason"] | null;
  notes: string;
  isSubmitting: boolean;
  submitted: boolean;
  setReason: (reason: RefundRequest["reason"]) => void;
  setNotes: (notes: string) => void;
  setSubmitting: (v: boolean) => void;
  setSubmitted: (v: boolean) => void;
  reset: () => void;
}

const useRefundFormStore = create<RefundFormState>((set) => ({
  reason: null,
  notes: "",
  isSubmitting: false,
  submitted: false,
  setReason: (reason) => set({ reason }),
  setNotes: (notes) => set({ notes }),
  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  setSubmitted: (submitted) => set({ submitted }),
  reset: () =>
    set({ reason: null, notes: "", isSubmitting: false, submitted: false }),
}));

const REASONS: {
  value: RefundRequest["reason"];
  label: string;
  desc: string;
}[] = [
  {
    value: "requested_by_customer",
    label: "Changed my mind",
    desc: "I no longer want to attend",
  },
  {
    value: "duplicate",
    label: "Duplicate purchase",
    desc: "I accidentally purchased twice",
  },
  {
    value: "fraudulent",
    label: "Unauthorized charge",
    desc: "I didn't make this purchase",
  },
  {
    value: "other",
    label: "Other reason",
    desc: "Something else",
  },
];

export default function RefundRequestScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Request Refund",
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
    reason,
    notes,
    isSubmitting,
    submitted,
    setReason,
    setNotes,
    setSubmitting,
    setSubmitted,
    reset,
  } = useRefundFormStore();

  const handleSubmit = useCallback(async () => {
    if (!orderId || !reason) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      const result = await purchasesApi.requestRefund({
        orderId,
        reason,
        notes: notes || undefined,
      });
      if (result.success) {
        setSubmitted(true);
        showToast("success", "Refund Requested", "We'll review your request");
      } else {
        showToast("error", "Error", result.error || "Failed to submit refund");
      }
    } catch (err: any) {
      showToast("error", "Error", err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }, [orderId, reason, notes, setSubmitting, setSubmitted, showToast]);

  // Success state
  if (submitted) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Animated.View
          entering={FadeInDown.duration(400).springify().damping(18)}
          className="items-center"
        >
          <View className="w-16 h-16 rounded-full bg-green-500/10 items-center justify-center mb-4">
            <RotateCcw size={28} color="#22C55E" />
          </View>
          <Text className="text-xl font-sans-bold text-foreground">
            Request Submitted
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-2 leading-5">
            Your refund request has been submitted. You'll receive an email when
            it's been reviewed.
          </Text>
          <Pressable
            onPress={() => {
              reset();
              router.back();
            }}
            className="mt-8 bg-primary rounded-2xl px-8 py-3.5"
          >
            <Text className="text-base font-sans-bold text-primary-foreground">
              Done
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Info banner */}
        <Animated.View
          entering={FadeInDown.delay(50).duration(300).springify().damping(18)}
          className="bg-blue-500/5 rounded-2xl border border-blue-500/15 p-4 mt-2 flex-row gap-3"
        >
          <AlertCircle size={18} color="#3B82F6" />
          <View className="flex-1">
            <Text className="text-sm text-foreground font-sans-semibold">
              Refund Policy
            </Text>
            <Text className="text-xs text-muted-foreground mt-1 leading-4">
              Refunds are reviewed within 3-5 business days. Approved refunds
              are returned to your original payment method.
            </Text>
          </View>
        </Animated.View>

        {/* Reason selection */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(300).springify().damping(18)}
          className="mt-4"
        >
          <Text className="text-xs font-sans-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Reason for Refund
          </Text>
          {REASONS.map((r) => {
            const isSelected = reason === r.value;
            return (
              <Pressable
                key={r.value}
                onPress={() => setReason(r.value)}
                className={`flex-row items-center p-4 rounded-2xl border mb-2 ${
                  isSelected
                    ? "bg-primary/5 border-primary/30"
                    : "bg-card border-border"
                }`}
              >
                <View
                  className={`w-5 h-5 rounded-full border-2 mr-3 items-center justify-center ${
                    isSelected ? "border-primary" : "border-muted-foreground/30"
                  }`}
                >
                  {isSelected && (
                    <View className="w-2.5 h-2.5 rounded-full bg-primary" />
                  )}
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-sans-semibold text-foreground">
                    {r.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-0.5">
                    {r.desc}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Animated.View>

        {/* Notes */}
        <Animated.View
          entering={FadeInDown.delay(150).duration(300).springify().damping(18)}
          className="mt-2"
        >
          <Text className="text-xs font-sans-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
            Additional Details (Optional)
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Tell us more about why you'd like a refund..."
            placeholderTextColor="#666"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="bg-card rounded-2xl border border-border px-4 py-3 text-foreground text-sm min-h-[100px]"
          />
        </Animated.View>

        {/* Submit */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(300).springify().damping(18)}
          className="mt-6"
        >
          <Pressable
            onPress={handleSubmit}
            disabled={!reason || isSubmitting}
            className="bg-primary rounded-2xl py-4 items-center"
            style={{ opacity: !reason || isSubmitting ? 0.5 : 1 }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text className="text-base font-sans-bold text-primary-foreground">
                Submit Refund Request
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
