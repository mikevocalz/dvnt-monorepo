import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import * as Battery from "expo-battery";
import * as Device from "expo-device";

export type MotionTier = "full" | "lite";

const LOW_MEMORY_BYTES = 3_500_000_000;

async function resolveMotionTier(): Promise<MotionTier> {
  try {
    const [reduceMotionEnabled, lowPowerEnabled] = await Promise.all([
      AccessibilityInfo.isReduceMotionEnabled(),
      Battery.isLowPowerModeEnabledAsync(),
    ]);

    const totalMemory = Device.totalMemory ?? Number.POSITIVE_INFINITY;
    const isLowMemoryDevice = totalMemory < LOW_MEMORY_BYTES;

    return reduceMotionEnabled || lowPowerEnabled || isLowMemoryDevice
      ? "lite"
      : "full";
  } catch {
    return "full";
  }
}

export function useMotionTier() {
  const [tier, setTier] = useState<MotionTier>("full");

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      const nextTier = await resolveMotionTier();
      if (isMounted) {
        setTier(nextTier);
      }
    };

    void refresh();

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });

    const accessibilitySubscription =
      AccessibilityInfo.addEventListener?.("reduceMotionChanged", () => {
        void refresh();
      });

    return () => {
      isMounted = false;
      appStateSubscription.remove();
      accessibilitySubscription?.remove?.();
    };
  }, []);

  return tier;
}
