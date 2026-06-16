/**
 * Ambient paint-light field (web tier).
 *
 * A purple/magenta radial glow that drifts toward the cursor — the universal,
 * always-safe tier. We intentionally don't gamble the first web render on
 * Skia-on-web (CanvasKit + the shimmed expo-modules-core are unproven here);
 * native gets the Skia RuntimeEffect instead (AmbientField.native.tsx).
 * Reduce-motion freezes the drift.
 */
import { StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useLandingScroll } from "../hooks/useScrollProgress";
import { usePointerField } from "../hooks/usePointerField";
import { LANDING_GRADIENTS } from "../theme";

export function AmbientField() {
  const { reduceMotion } = useLandingScroll();
  const pointer = usePointerField();

  const driftStyle = useAnimatedStyle(() => {
    if (reduceMotion.value) return { transform: [] };
    return {
      transform: [
        { translateX: interpolate(pointer.x.value, [0, 1], [-70, 70]) },
        { translateY: interpolate(pointer.y.value, [0, 1], [-50, 50]) },
      ],
    };
  }, [reduceMotion, pointer.x, pointer.y]);

  return (
    <View style={styles.fill} pointerEvents="none">
      <Animated.View style={[styles.layer, styles.primary, driftStyle]} />
      <View style={[styles.layer, styles.secondary]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    // `fixed` (web) pins the glow to the viewport. As `absolute` it stretched
    // to the full page scroll-height, so scrolling forced the browser to
    // re-rasterize fresh regions of a huge radial gradient — which is what made
    // the background appear to "load in late" while scrolling.
    position: "fixed" as "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  primary: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({ backgroundImage: LANDING_GRADIENTS.ambientCss } as any) as object),
  },
  secondary: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({
      backgroundImage:
        "radial-gradient(40% 40% at 80% 80%, rgba(63,220,255,0.12) 0%, rgba(2,3,10,0) 70%)",
    } as any) as object),
  },
});
