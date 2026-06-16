/**
 * Native glass surface — expo-blur BlurView (degrades cleanly; @callstack
 * liquid-glass is reserved for the pill primitives elsewhere). The animated
 * `tintStyle` overlay drives the turn-to-glass amount.
 */
import { View } from "react-native";
import { BlurView } from "expo-blur";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";
import type { GlassSurfaceProps } from "./GlassSurface";

export function GlassSurface({
  children,
  style,
  radius = 24,
  tintStyle,
  blur = 24,
  pointerEvents = "box-none",
}: GlassSurfaceProps) {
  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        {
          borderRadius: radius,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: LANDING_COLORS.glassBorder,
        },
        style,
      ]}
    >
      <BlurView
        intensity={blur}
        tint="dark"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
          tintStyle,
        ]}
      />
      {children}
    </View>
  );
}
