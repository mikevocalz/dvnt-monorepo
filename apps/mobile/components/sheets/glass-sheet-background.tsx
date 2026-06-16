/**
 * GlassSheetBackground
 *
 * Drop-in backgroundComponent for @gorhom/bottom-sheet.
 * iOS 26+: native liquid glass via @callstack/liquid-glass
 * iOS <26:  BlurView fallback
 * Android:  solid dark surface
 */
import { Platform, View } from "react-native";
import { BlurView } from "expo-blur";
import { memo } from "react";
import type { BottomSheetBackgroundProps } from "@gorhom/bottom-sheet";
import {
  SafeLiquidGlassView as LiquidGlassView,
  safeIsLiquidGlassSupported as isLiquidGlassSupported,
} from "@/lib/safe-native-modules";
import Animated from "react-native-reanimated";
import {
  GLASS_SURFACE,
  createGlassOuterStyle,
  createGlassScrimStyle,
} from "@/lib/ui/glass";

const BORDER_RADIUS = 24;

function GlassSheetBackgroundComponent({
  style,
  animatedIndex,
  animatedPosition,
}: BottomSheetBackgroundProps) {
  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassView
        effect="regular"
        style={[
          style,
          createGlassOuterStyle(BORDER_RADIUS),
          {
            borderTopLeftRadius: BORDER_RADIUS,
            borderTopRightRadius: BORDER_RADIUS,
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            {
              flex: 1,
              borderTopLeftRadius: BORDER_RADIUS,
              borderTopRightRadius: BORDER_RADIUS,
            },
            createGlassScrimStyle("sheet"),
          ]}
        />
      </LiquidGlassView>
    );
  }

  if (Platform.OS === "ios") {
    return (
      <BlurView
        intensity={40}
        tint="dark"
        style={[
          style,
          createGlassOuterStyle(BORDER_RADIUS),
          {
            borderTopLeftRadius: BORDER_RADIUS,
            borderTopRightRadius: BORDER_RADIUS,
          },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            {
              flex: 1,
              borderTopLeftRadius: BORDER_RADIUS,
              borderTopRightRadius: BORDER_RADIUS,
            },
            createGlassScrimStyle("sheet", true),
          ]}
        />
      </BlurView>
    );
  }

  // Android fallback
  return (
    <Animated.View
      style={[
        style,
        {
          borderTopLeftRadius: BORDER_RADIUS,
          borderTopRightRadius: BORDER_RADIUS,
          backgroundColor: GLASS_SURFACE.androidSurface,
          borderWidth: 1,
          borderColor: GLASS_SURFACE.borderStrong,
        },
      ]}
    />
  );
}

export const GlassSheetBackground = memo(GlassSheetBackgroundComponent);
