/**
 * Web glass surface — CSS backdrop-filter (react-native-web forwards
 * `backdropFilter`). We avoid expo-blur on web because it depends on the
 * shimmed expo-modules-core. The animated `tintStyle` overlay lets the header
 * animate the glass *amount* rather than toggling a class.
 */
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";
import type { GlassSurfaceProps } from "./GlassSurface.types";

export function GlassSurface({
  children,
  style,
  radius = 24,
  tintStyle,
  blur = 18,
  pointerEvents = "box-none",
}: GlassSurfaceProps) {
  // Liquid glass, not frosted: brighter + more saturated backdrop so content
  // refracts through the blur, plus an inset highlight for the lensed glass edge.
  const filter = `saturate(185%) brightness(1.08) blur(${blur}px)`;
  const webBlur = {
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 0 rgba(255,255,255,0.06)",
  } as const;

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        webBlur as any,
        style,
      ]}
    >
      {/* Animated tint — header drives this alpha for the turn-to-glass. */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
          tintStyle,
        ]}
      />
      {/* Specular sheen — soft light across the top half so the glass catches light. */}
      <View
        pointerEvents="none"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "60%",
          backgroundImage:
            "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 45%, rgba(255,255,255,0) 100%)",
        } as any}
      />
      {children}
    </View>
  );
}
