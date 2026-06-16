import { useMemo, useRef, useState } from "react";
import { Platform, Pressable, View, ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { SafeAnimatedGlow } from "@/lib/safe-native-modules";

// Safe imports for types and presets
let glowPresets: any = { oceanSunset: { states: [{ preset: {} }] } };
try {
  const glow = require("react-native-animated-glow");
  glowPresets = glow.glowPresets;
} catch {
  // Types not available, use fallbacks
}

type GlowState = "default" | "hover" | "press";

type CenterButtonProps = {
  Icon: LucideIcon;
  onPress?: () => void;
  /** When used inside NativeTabs.BottomAccessory, pass the placement value from usePlacement() */
  accessoryPlacement?: "regular" | "inline";
};

export function CenterButton({
  Icon,
  onPress,
  accessoryPlacement,
}: CenterButtonProps) {
  const [glowState, setGlowState] = useState<GlowState>("default");
  const isHovered = useRef(false);
  // inline = rendered inside the liquid glass tab bar on iOS 26+
  const isInline = accessoryPlacement === "inline";

  const radiusByState = useMemo<Record<GlowState, number>>(
    () => ({
      default: 12,
      hover: 14,
      press: 10,
    }),
    [],
  );

  const glowPreset = useMemo(() => {
    const base = glowPresets.oceanSunset;
    const smallGlow = 10;
    const largeGlow = 14;

    return {
      ...base,
      states: [
        {
          ...base.states[0],
          transition: 0,
          preset: {
            ...base.states[0].preset,
            cornerRadius: radiusByState.default,
            outlineWidth: 7,
            borderColor: [
              "rgba(63, 220, 255, 1)",
              "rgba(255, 91, 252, 1)",
              "rgba(138, 64, 207, 1)",
            ],
            backgroundColor: "#8A40CF",
            glowLayers: [
              {
                glowPlacement: "inside",
                colors: ["#3FDCFF", "#FF5BFC", "#8A40CF"],
                glowSize: smallGlow,
                opacity: 0.16,
                speedMultiplier: 0.9,
                coverage: 0.3,
              },
              {
                glowPlacement: "inside",
                colors: [
                  "rgba(63, 220, 255, 1)",
                  "rgba(255, 91, 252, 1)",
                  "rgba(138, 64, 207, 1)",
                ],
                glowSize: largeGlow,
                opacity: 0.26,
                speedMultiplier: 0.7,
                coverage: 0.4,
              },
            ],
          },
        },
        {
          name: "hover",
          transition: 180,
          preset: {
            cornerRadius: radiusByState.hover,
            outlineWidth: 10,
            glowLayers: [
              { glowSize: smallGlow + 2, opacity: 0.18 },
              { glowSize: largeGlow + 3, opacity: 0.26 },
            ],
          },
        },
        {
          name: "press",
          transition: 90,
          preset: {
            cornerRadius: radiusByState.press,
            outlineWidth: 9,
            glowLayers: [
              { glowSize: smallGlow - 1, opacity: 0.36, speedMultiplier: 1.05 },
              { glowSize: largeGlow - 1, opacity: 0.34 },
            ],
          },
        },
      ],
    };
  }, [radiusByState]);

  const containerStyle: ViewStyle = isInline
    ? {
        width: 60,
        height: 60,
        alignSelf: "center",
      }
    : {
        position: "absolute",
        bottom: Platform.OS === "android" ? -30 : -34,
        left: "50%",
        transform: [{ translateX: -30 }],
        width: 60,
        height: 60,
        zIndex: 1000,
      };

  return (
    <View style={containerStyle}>
      <SafeAnimatedGlow
        preset={glowPreset}
        activeState={glowState}
        style={{
          width: 60,
          height: 60,
          borderRadius: radiusByState[glowState],
          shadowColor: "#000",
          shadowOpacity: 0.5,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 16,
        }}
      >
        <Pressable
          onPress={onPress}
          onPressIn={() => setGlowState("press")}
          onPressOut={() =>
            setGlowState(isHovered.current ? "hover" : "default")
          }
          onHoverIn={() => {
            isHovered.current = true;
            if (glowState !== "press") setGlowState("hover");
          }}
          onHoverOut={() => {
            isHovered.current = false;
            if (glowState !== "press") setGlowState("default");
          }}
          className="h-full w-full items-center justify-center bg-zinc-50"
          style={{
            borderRadius: radiusByState[glowState],
            elevation: 12,
            shadowColor: "#000",
            shadowOpacity: 0.3,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Icon size={28} color="#000" strokeWidth={3} />
        </Pressable>
      </SafeAnimatedGlow>
    </View>
  );
}
