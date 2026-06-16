/**
 * Host Receipt Branding Screen
 *
 * Upload and manage organizer logo for receipts/invoices/tickets.
 * - Logo upload (color + monochrome)
 * - Display name
 * - Preview on sample receipt
 * - Monochrome-safe warning for thermal printers
 */

import { useEffect, useCallback, useLayoutEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  Palette,
  Upload,
  Eye,
  AlertCircle,
  Check,
  ImageIcon,
  Type,
  Printer,
} from "lucide-react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { ScreenSkeleton } from "@dvnt/app/components/ui/screen-skeleton";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { brandingApi } from "@dvnt/app/lib/api/payments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

export default function HostBrandingScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);

  const {
    branding,
    brandingLoading,
    brandingSaving,
    setBranding,
    setBrandingLoading,
    setBrandingSaving,
  } = usePaymentsStore();

  const loadBranding = useCallback(async () => {
    setBrandingLoading(true);
    try {
      const result = await brandingApi.get();
      setBranding(
        result || {
          hostId: "",
          displayName: "",
          fallbackText: "",
          updatedAt: new Date().toISOString(),
        },
      );
    } catch (err) {
      console.error("[Branding] load error:", err);
    } finally {
      setBrandingLoading(false);
    }
  }, [setBranding, setBrandingLoading]);

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

  const handlePickLogo = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setBranding({
          ...branding!,
          logoUrl: result.assets[0].uri,
        });
      }
    } catch (err) {
      console.error("[Branding] pickLogo error:", err);
    }
  }, [branding, setBranding]);

  const handlePickMonochromeLogo = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setBranding({
          ...branding!,
          logoMonochromeUrl: result.assets[0].uri,
        });
      }
    } catch (err) {
      console.error("[Branding] pickMonochromeLogo error:", err);
    }
  }, [branding, setBranding]);

  const handleSave = useCallback(async () => {
    if (!branding) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBrandingSaving(true);
    try {
      const result = await brandingApi.update(branding);
      if (result.success) {
        showToast("success", "Saved", "Branding updated successfully");
      } else {
        showToast("error", "Error", result.error || "Failed to save");
      }
    } catch (err: any) {
      showToast("error", "Error", err.message || "Failed to save");
    } finally {
      setBrandingSaving(false);
    }
  }, [branding, setBrandingSaving, showToast]);

  const handleDisplayNameChange = useCallback(
    (text: string) => {
      if (!branding) return;
      setBranding({ ...branding, displayName: text });
    },
    [branding, setBranding],
  );

  const handleFallbackTextChange = useCallback(
    (text: string) => {
      if (!branding) return;
      setBranding({ ...branding, fallbackText: text });
    },
    [branding, setBranding],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerLeft: () => null,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {branding && (
            <Pressable
              onPress={handleSave}
              disabled={brandingSaving}
              style={{
                backgroundColor: "#8A40CF",
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 7,
                opacity: brandingSaving ? 0.6 : 1,
              }}
            >
              {brandingSaving ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text
                  style={{
                    color: "#000",
                    fontFamily: "Inter-Bold",
                    fontSize: 13,
                  }}
                >
                  Save
                </Text>
              )}
            </Pressable>
          )}
          <SettingsCloseButton />
        </View>
      ),
    });
  }, [navigation, branding, brandingSaving, handleSave]);

  return (
    <View className="flex-1 bg-background">
      {brandingLoading ? (
        <ScreenSkeleton variant="form" rows={4} showHeader={false} />
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Color Logo */}
          <Animated.View
            entering={FadeInDown.delay(50)
              .duration(300)
              .springify()
              .damping(18)}
            className="bg-card rounded-2xl border border-border p-4 mt-2"
          >
            <View className="flex-row items-center gap-2 mb-3">
              <ImageIcon size={16} color="#8A40CF" />
              <Text className="text-sm font-sans-semibold text-foreground">
                Color Logo
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground mb-3">
              Displayed on PDF receipts, invoices, and tickets. Recommended: 3:1
              aspect ratio, transparent PNG.
            </Text>

            {branding?.logoUrl ? (
              <Pressable
                onPress={handlePickLogo}
                className="bg-white/5 rounded-xl p-4 items-center"
              >
                <Image
                  source={{ uri: branding.logoUrl }}
                  style={{ width: 180, height: 60 }}
                  contentFit="contain"
                />
                <Text className="text-xs text-muted-foreground mt-2">
                  Tap to replace
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handlePickLogo}
                className="bg-muted/30 rounded-xl p-6 items-center border border-dashed border-border"
              >
                <Upload size={24} color="#666" />
                <Text className="text-sm text-muted-foreground mt-2">
                  Upload Logo
                </Text>
              </Pressable>
            )}
          </Animated.View>

          {/* Monochrome Logo */}
          <Animated.View
            entering={FadeInDown.delay(100)
              .duration(300)
              .springify()
              .damping(18)}
            className="bg-card rounded-2xl border border-border p-4 mt-3"
          >
            <View className="flex-row items-center gap-2 mb-3">
              <Printer size={16} color="#6B7280" />
              <Text className="text-sm font-sans-semibold text-foreground">
                Monochrome Logo
              </Text>
              <View className="bg-muted/50 rounded-full px-2 py-0.5">
                <Text className="text-[10px] text-muted-foreground">
                  Optional
                </Text>
              </View>
            </View>
            <Text className="text-xs text-muted-foreground mb-3">
              Used on thermal receipt printers. Must be black on white, no
              gradients, no color. Falls back to display name if not set.
            </Text>

            {branding?.logoMonochromeUrl ? (
              <Pressable
                onPress={handlePickMonochromeLogo}
                className="bg-white rounded-xl p-4 items-center"
              >
                <Image
                  source={{ uri: branding.logoMonochromeUrl }}
                  style={{ width: 180, height: 60 }}
                  contentFit="contain"
                />
                <Text className="text-xs text-muted-foreground mt-2">
                  Tap to replace
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handlePickMonochromeLogo}
                className="bg-muted/30 rounded-xl p-6 items-center border border-dashed border-border"
              >
                <Upload size={24} color="#666" />
                <Text className="text-sm text-muted-foreground mt-2">
                  Upload Monochrome Logo
                </Text>
              </Pressable>
            )}
          </Animated.View>

          {/* Display Name */}
          <Animated.View
            entering={FadeInDown.delay(150)
              .duration(300)
              .springify()
              .damping(18)}
            className="bg-card rounded-2xl border border-border p-4 mt-3"
          >
            <View className="flex-row items-center gap-2 mb-3">
              <Type size={16} color="#3B82F6" />
              <Text className="text-sm font-sans-semibold text-foreground">
                Display Name
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground mb-3">
              Shown on receipts when no logo is available. Used as fallback text
              on thermal printers.
            </Text>
            <TextInput
              value={branding?.displayName || ""}
              onChangeText={handleDisplayNameChange}
              placeholder="e.g. DVNT Events"
              placeholderTextColor="#666"
              className="bg-muted/30 rounded-xl px-4 py-3 text-foreground text-sm border border-border"
            />
          </Animated.View>

          {/* Fallback Text */}
          <Animated.View
            entering={FadeInDown.delay(200)
              .duration(300)
              .springify()
              .damping(18)}
            className="bg-card rounded-2xl border border-border p-4 mt-3"
          >
            <View className="flex-row items-center gap-2 mb-3">
              <Type size={16} color="#22C55E" />
              <Text className="text-sm font-sans-semibold text-foreground">
                Receipt Footer Text
              </Text>
            </View>
            <TextInput
              value={branding?.fallbackText || ""}
              onChangeText={handleFallbackTextChange}
              placeholder="e.g. Hosted by DVNT"
              placeholderTextColor="#666"
              className="bg-muted/30 rounded-xl px-4 py-3 text-foreground text-sm border border-border"
            />
          </Animated.View>

          {/* Thermal Printer Info */}
          <Animated.View
            entering={FadeInDown.delay(250)
              .duration(300)
              .springify()
              .damping(18)}
            className="bg-orange-500/5 rounded-2xl border border-orange-500/15 p-4 mt-3"
          >
            <View className="flex-row items-center gap-2 mb-2">
              <AlertCircle size={16} color="#F97316" />
              <Text className="text-sm font-sans-semibold text-orange-400">
                Thermal Printer Guidelines
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground leading-5">
              • Monochrome logos must be black on white{"\n"}• No gradients,
              transparency, or fine details{"\n"}• QR codes sized ≥ 1.5cm with
              quiet zone{"\n"}• 58mm width = 384px, 80mm width = 576px{"\n"}•
              Safe margins: 12px all sides
            </Text>
          </Animated.View>
        </ScrollView>
      )}
    </View>
  );
}
