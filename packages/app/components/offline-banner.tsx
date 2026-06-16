/**
 * OfflineBanner
 *
 * Premium offline status surface — sits above the content, not over it.
 * Slides down from under the status bar when the connectivity store says
 * we're offline. Dismisses itself the moment we reconnect.
 *
 * Design / palette:
 *   - Offline state: dark `secondary` surface (DVNT's card/muted
 *     background rgb(26,26,26)) with a destructive-red dot + white
 *     label. Reads as "something's wrong" without screaming.
 *   - Back-online flash: DVNT primary cyan rgb(62,164,229) with white
 *     label. Matches the brand's live/active accent.
 *   - Thin DVNT border (rgb(38,38,38)) + soft shadow so the pill lifts
 *     off the content cleanly.
 *
 * Implementation notes:
 *   - Single selector on `phase` — nothing else in the app re-renders
 *     on connectivity changes.
 *   - Reanimated shared values = UI-thread state, not React state, so
 *     no useState anywhere per the project policy.
 *   - Scroll-position safe (absolute positioning, no layout push).
 *   - Flap-debounced upstream — banner never appears for brief dips.
 */

import { useEffect, useRef } from "react";
import { Text, View, StyleSheet, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { WifiOff, Wifi } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnectivityStore } from "@dvnt/app/lib/stores/connectivity-store";
import { useColorScheme } from "@dvnt/app/lib/hooks";

type Surface = "offline" | "reconnected" | "hidden";

// How long the "Back online" confirmation stays on screen before fading.
const RECONNECT_FLASH_MS = 1800;

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const phase = useConnectivityStore((s) => s.phase);

  // Drive surface state from the store phase + a short "reconnected"
  // flash. Using a ref + shared values instead of component state so we
  // honor the project state policy (no useState). Reanimated shared
  // values are UI-thread state, not React state.
  const surfaceRef = useRef<Surface>("hidden");
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);
  // 0 = offline palette, 1 = reconnected palette. Interpolated into
  // background + icon color via useAnimatedStyle below.
  const colorAnim = useSharedValue(0);

  useEffect(() => {
    let flashTimer: ReturnType<typeof setTimeout> | null = null;

    const show = (next: Surface) => {
      surfaceRef.current = next;
      colorAnim.value = withTiming(next === "reconnected" ? 1 : 0, {
        duration: 240,
      });
      translateY.value = withSpring(0, { damping: 18, stiffness: 260 });
      opacity.value = withTiming(1, { duration: 180 });
    };

    const hide = (onFinish?: () => void) => {
      opacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(
        -100,
        { duration: 220, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished && onFinish) runOnJS(onFinish)();
        },
      );
    };

    if (phase === "offline") {
      show("offline");
    } else if (phase === "online") {
      // Only fire the "Back online" flash if we were previously showing
      // the offline state. Avoids an unnecessary flash on cold start
      // when phase goes from the initial "online" placeholder to
      // "online" proper.
      if (surfaceRef.current === "offline") {
        show("reconnected");
        flashTimer = setTimeout(() => {
          hide(() => {
            surfaceRef.current = "hidden";
          });
        }, RECONNECT_FLASH_MS);
      } else if (surfaceRef.current !== "hidden") {
        hide(() => {
          surfaceRef.current = "hidden";
        });
      }
    }
    // "reconnecting" is deliberately ignored — the flap-debounce in the
    // store handles that; we never surface a half-state to users.

    return () => {
      if (flashTimer != null) clearTimeout(flashTimer);
    };
  }, [phase, colorAnim, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // Background + icon lerp between DVNT's offline surface and primary
  // accent. Worklet-safe — no JS calls.
  const bgStyle = useAnimatedStyle(() => {
    const t = colorAnim.value;
    // DVNT theme tokens (dark theme). Kept verbatim so the banner
    // doesn't need to subscribe to a second store just for colors.
    // Offline: secondary = rgb(26,26,26)
    // Online (reconnect flash): primary = rgb(62,164,229)
    const r = 26 + (62 - 26) * t;
    const g = 26 + (164 - 26) * t;
    const b = 26 + (229 - 26) * t;
    return {
      backgroundColor: `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.96)`,
    };
  });

  const isOnline = phase === "online";

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrapper,
        { paddingTop: insets.top + 4 },
        animatedStyle,
      ]}
    >
      <Animated.View
        style={[
          styles.pill,
          {
            borderColor: colors.border,
          },
          bgStyle,
        ]}
      >
        {/* Status dot — destructive red when offline, white when
            reconnected. Matches DVNT's hierarchy: red = problem,
            white-on-primary = confirmation. */}
        <View
          style={[
            styles.dot,
            {
              backgroundColor: isOnline
                ? colors.foreground
                : colors.destructive,
            },
          ]}
        />
        {isOnline ? (
          <Wifi size={13} color={colors.foreground} />
        ) : (
          <WifiOff size={13} color={colors.foreground} />
        )}
        <Text style={[styles.label, { color: colors.foreground }]}>
          {isOnline ? "Back online" : "You’re offline"}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 5000,
    elevation: Platform.OS === "android" ? 20 : 0,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
