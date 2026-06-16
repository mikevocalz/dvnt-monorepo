import { View, Text, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useAppStore } from "@/lib/stores/app-store";
import { usePathname } from "expo-router";

const TRACK_WIDTH = 84;
const TRACK_HEIGHT = 42;
const THUMB_SIZE = 36;
const TRACK_PADDING = 3;
const THUMB_ON = TRACK_WIDTH - THUMB_SIZE - TRACK_PADDING * 2 - 2;
const THUMB_OFF = 0;

const SPRING_CONFIG = { damping: 20, stiffness: 300 };

type SpicyToggleFABProps = {
  accessoryPlacement?: "regular" | "inline";
};

export function supportsNativeTabsBottomAccessory(): boolean {
  // Disabled: NativeTabs.BottomAccessory renders an empty gray bar on non-home
  // tabs on iOS 26+ (iPhone Pro Max). Home screen has its own inline toggle.
  return false;
}

export function SpicyToggleFAB({ accessoryPlacement }: SpicyToggleFABProps) {
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isAccessory = accessoryPlacement !== undefined;

  // Reanimated shared value — survives OTA reloads correctly
  const thumbX = useSharedValue(nsfwEnabled ? THUMB_ON : THUMB_OFF);

  // Sync shared value when state changes (including after OTA reload)
  useEffect(() => {
    thumbX.value = withSpring(
      nsfwEnabled ? THUMB_ON : THUMB_OFF,
      SPRING_CONFIG,
    );
  }, [nsfwEnabled]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  useEffect(() => {
    console.log("[SpicyToggle] mount", {
      pathname,
      accessoryPlacement: accessoryPlacement ?? "screen",
    });

    return () => {
      console.log("[SpicyToggle] unmount", {
        pathname,
        accessoryPlacement: accessoryPlacement ?? "screen",
      });
    };
  }, [pathname, accessoryPlacement]);

  const doToggle = useCallback(() => {
    const store = useAppStore.getState();
    const currentEnabled = store.nsfwEnabled;
    const nextEnabled = !currentEnabled;
    const source = isAccessory
      ? `feed_tab_accessory_${accessoryPlacement}`
      : "feed_screen_fab";

    console.log("[SpicyToggle] onPress", {
      pathname,
      source,
      currentEnabled,
      nextEnabled,
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    store.setNsfwEnabled(nextEnabled, source);
  }, [accessoryPlacement, isAccessory, pathname]);

  const pressable = (
    <Pressable
      onPressIn={() => {
        console.log("[SpicyToggle] onPressIn", {
          pathname,
          accessoryPlacement: accessoryPlacement ?? "screen",
          currentEnabled: useAppStore.getState().nsfwEnabled,
        });
      }}
      onPress={doToggle}
      hitSlop={12}
      accessibilityRole="switch"
      accessibilityLabel="Spicy toggle"
      accessibilityState={{ checked: nsfwEnabled }}
      testID="feed-spicy-toggle"
      style={
        isAccessory
          ? {
              alignItems: "center",
              padding: 8,
            }
          : {
              position: "absolute",
              bottom: Platform.select({
                ios: insets.bottom + 64,
                android: insets.bottom + 72,
                default: insets.bottom + 24,
              }),
              right: 8,
              zIndex: 50,
              elevation: 50,
              alignItems: "center",
              padding: 8,
            }
      }
    >
      {/* Track */}
      <View
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: nsfwEnabled ? "#991b1b" : "rgb(20, 20, 20)",
          justifyContent: "center",
          paddingHorizontal: TRACK_PADDING,
          borderWidth: 1,
          borderColor: "rgb(38, 38, 38)",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        {/* Angel emoji (left side, visible when deviant mode ON) */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 10,
            opacity: nsfwEnabled ? 0.8 : 0,
          }}
        >
          <Text style={{ fontSize: 18 }}>😇</Text>
        </View>

        {/* Devil emoji (right side, visible when angel mode / OFF) */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: 10,
            opacity: nsfwEnabled ? 0 : 0.8,
          }}
        >
          <Text style={{ fontSize: 18 }}>😈</Text>
        </View>

        {/* Animated thumb — reanimated survives OTA reloads */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: "#fff",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.2,
              shadowRadius: 2,
              elevation: 3,
            },
            thumbStyle,
          ]}
        >
          <Text style={{ fontSize: 18 }}>{nsfwEnabled ? "😈" : "😇"}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );

  if (isAccessory) {
    return (
      <View
        pointerEvents="box-none"
        style={{
          width: "100%",
          alignItems: "flex-end",
          paddingRight: accessoryPlacement === "inline" ? 8 : 16,
          paddingBottom: accessoryPlacement === "inline" ? 2 : 8,
        }}
      >
        {pressable}
      </View>
    );
  }

  return pressable;
}
