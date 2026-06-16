/**
 * DVNTLiquidGlass
 *
 * Reusable liquid glass container primitive.
 *
 * iOS 26+: native UIKit glass via @callstack/liquid-glass (LiquidGlassView).
 * iOS <26: BlurView fallback — same visual contract, no crash.
 */
import { View, type ViewStyle, type StyleProp } from "react-native";
import { BlurView } from "expo-blur";
import { memo } from "react";
import {
  SafeLiquidGlassView as LiquidGlassView,
  safeIsLiquidGlassSupported as isLiquidGlassSupported,
} from "@dvnt/app/lib/safe-native-modules";
import { createGlassOuterStyle, createGlassScrimStyle } from "@dvnt/app/lib/ui/glass";

interface DVNTLiquidGlassProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Border radius, default 24 (pill) */
  radius?: number;
  /** Inner padding horizontal, default 12 */
  paddingH?: number;
  /** Inner padding vertical, default 8 */
  paddingV?: number;
  /** Whether the native glass surface should participate in touch handling */
  interactive?: boolean;
}

function DVNTLiquidGlassComponent({
  children,
  style,
  radius = 24,
  paddingH = 12,
  paddingV = 8,
  interactive = false,
}: DVNTLiquidGlassProps) {
  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: paddingH,
        paddingVertical: paddingV,
        gap: 12,
      }}
    >
      {children}
    </View>
  );

  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassView
        effect="regular"
        interactive={interactive}
        pointerEvents={interactive ? "auto" : "box-none"}
        style={[createGlassOuterStyle(radius), style]}
      >
        <View style={createGlassScrimStyle("pill")}>{inner}</View>
      </LiquidGlassView>
    );
  }

  return (
    <BlurView
      intensity={18}
      tint="dark"
      pointerEvents={interactive ? "auto" : "box-none"}
      style={[createGlassOuterStyle(radius), style]}
    >
      <View style={createGlassScrimStyle("pill", true)}>{inner}</View>
    </BlurView>
  );
}

export const DVNTLiquidGlass = memo(DVNTLiquidGlassComponent);

// ─── Icon button variant ─────────────────────────────────────────────────────

interface DVNTLiquidGlassIconButtonProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  size?: number;
  interactive?: boolean;
}

function DVNTLiquidGlassIconButtonComponent({
  children,
  style,
  size = 36,
  interactive = false,
}: DVNTLiquidGlassIconButtonProps) {
  const radius = size / 4;

  if (isLiquidGlassSupported) {
    return (
      <LiquidGlassView
        effect="regular"
        interactive={interactive}
        pointerEvents={interactive ? "auto" : "none"}
        style={[
          createGlassOuterStyle(radius),
          {
            width: size,
            height: size,
          },
          style,
        ]}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            ...createGlassScrimStyle("pill"),
          }}
        >
          {children}
        </View>
      </LiquidGlassView>
    );
  }

  return (
    <BlurView
      intensity={18}
      tint="dark"
      pointerEvents={interactive ? "auto" : "none"}
      style={[
        createGlassOuterStyle(radius),
        {
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          ...createGlassScrimStyle("pill", true),
        }}
      >
        {children}
      </View>
    </BlurView>
  );
}

export const DVNTLiquidGlassIconButton = memo(
  DVNTLiquidGlassIconButtonComponent,
);
