/**
 * Sneaky Link Paywall Modal
 *
 * Shown when joining a session that has >= 10 active participants.
 * Host never pays. iOS uses external purchase link (US compliant).
 * Android/Web uses Stripe Checkout via expo-web-browser.
 *
 * Does NOT modify the Sneaky Link chat screen or cards.
 */

import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { useState, useCallback } from "react";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import { Lock, ExternalLink, X, Shield } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "@/lib/supabase/client";
import { requireBetterAuthToken } from "@/lib/auth/identity";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface SneakyPaywallModalProps {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
  onAccessGranted: () => void;
}

export function SneakyPaywallModal({
  visible,
  sessionId,
  onClose,
  onAccessGranted,
}: SneakyPaywallModalProps) {
  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [isLoading, setIsLoading] = useState(false);

  const handlePurchase = useCallback(async () => {
    if (!authUser?.id || !sessionId) return;
    setIsLoading(true);

    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke(
        "sneaky-access-checkout",
        {
          body: {
            session_id: sessionId,
          },
          headers: {
            Authorization: `Bearer ${token}`,
            "x-auth-token": token,
          },
        },
      );

      if (error) throw error;

      if (data?.url) {
        // Open Stripe Checkout in browser
        const result = await WebBrowser.openBrowserAsync(data.url, {
          presentationStyle:
            Platform.OS === "ios"
              ? WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET
              : undefined,
        });

        // After browser closes (dismiss, cancel, or deep-link redirect),
        // poll for the sneaky_access record — webhook may arrive after browser closes.
        if (
          result.type === "cancel" ||
          result.type === "dismiss" ||
          result.type === "opened"
        ) {
          const MAX_ATTEMPTS = 6;
          const POLL_INTERVAL_MS = 2000;

          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const { data: access } = await supabase
              .from("sneaky_access")
              .select("session_id")
              .eq("session_id", sessionId)
              .eq("user_id", authUser.id)
              .single();

            if (access) {
              onAccessGranted();
              return;
            }

            if (attempt < MAX_ATTEMPTS - 1) {
              await new Promise((resolve) =>
                setTimeout(resolve, POLL_INTERVAL_MS),
              );
            }
          }

          // Payment may still be processing — inform the user
          showToast(
            "info",
            "Payment Processing",
            "If payment succeeded, access will activate within a moment. Try rejoining.",
          );
        }
      }
    } catch (err: any) {
      console.error("[SneakyPaywall] Error:", err);
      showToast("error", "Error", err.message || "Payment failed");
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.id, sessionId, onAccessGranted, showToast]);

  if (!visible || !isFeatureEnabled("sneaky_paywall_enabled")) return null;
  const sheetMaxHeight = Math.max(380, height - insets.top - 36);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      className="absolute inset-0"
      style={{
        backgroundColor: "rgba(0,0,0,0.7)",
        zIndex: 20000,
        elevation: 20000,
      }}
    >
      <Pressable className="flex-1" onPress={onClose} />

      <Animated.View
        entering={FadeInUp.duration(300).springify().damping(18)}
        className="bg-card rounded-t-3xl px-6 pt-6"
        style={{
          maxHeight: sheetMaxHeight,
          paddingBottom: Math.max(24, insets.bottom + 18),
        }}
      >
        {/* Close */}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          className="absolute top-4 right-4 w-8 h-8 items-center justify-center rounded-full bg-muted"
        >
          <X size={16} color="#999" />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={{ paddingBottom: 4 }}
        >
          {/* Icon */}
          <View className="items-center mb-4">
            <View className="w-16 h-16 rounded-full bg-primary/10 items-center justify-center">
              <Lock size={28} color="#8A40CF" />
            </View>
          </View>

          {/* Title */}
          <Text className="text-xl font-sans-bold text-foreground text-center mb-2">
            Room is Full
          </Text>

          {/* Description */}
          <Text className="text-sm text-muted-foreground text-center mb-6 px-4">
            This room has reached the free limit of 7 participants. Unlock
            access for a one-time fee.
          </Text>

          {/* Price */}
          <View className="bg-muted rounded-2xl p-4 mb-6">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-sans-semibold text-foreground">
                Unlock Access
              </Text>
              <Text className="text-xl font-sans-bold text-primary">$2.99</Text>
            </View>
            <Text className="text-xs text-muted-foreground mt-1">
              One-time payment • Instant access
            </Text>
          </View>

          {/* Purchase button — disabled on iOS (App Store Guideline 3.1.1) */}
          {Platform.OS === "ios" ? (
            <View className="rounded-2xl py-4 px-4 items-center mb-3" style={{ backgroundColor: "rgba(255,255,255,0.06)" }}>
              <Text className="text-sm text-muted-foreground text-center">
                Room access is available on Android and at dvntapp.live on the web.
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={handlePurchase}
              disabled={isLoading}
              className="bg-primary rounded-full py-4 flex-row items-center justify-center gap-2 mb-3"
              style={{ opacity: isLoading ? 0.6 : 1 }}
            >
              {isLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <ExternalLink size={18} color="#000" />
                  <Text className="text-base font-sans-bold text-primary-foreground">
                    Pay $2.99
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {/* Not now */}
          <Pressable onPress={onClose} className="py-3 items-center">
            <Text className="text-sm text-muted-foreground">Not now</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}
