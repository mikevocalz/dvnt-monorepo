/**
 * Capability ladder — probed once at mount.
 *
 *   webgpu  → Phase 2 hero-grade 3D / fluid passes (three.js + TypeGPU)
 *   skia    → native Skia RuntimeEffect ambient field
 *   gradient→ universal animated-gradient ambient field (web default tier)
 *
 * Plus reduce-motion, which collapses parallax to fades and freezes ambient
 * motion. The chosen tier is logged so QA can confirm which path ran.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

export type GraphicsTier = "webgpu" | "skia" | "gradient";

export interface CapabilityTier {
  tier: GraphicsTier;
  reduceMotion: boolean;
  /** True once the async probes have resolved. */
  ready: boolean;
}

function detectWebGPU(): boolean {
  if (Platform.OS !== "web") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof navigator !== "undefined" && !!(navigator as any).gpu;
}

export function useCapabilityTier(): CapabilityTier {
  const [state, setState] = useState<CapabilityTier>(() => ({
    // Native gets Skia by default; web starts on the always-safe gradient tier.
    tier: Platform.OS === "web" ? "gradient" : "skia",
    reduceMotion: false,
    ready: false,
  }));

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      let reduceMotion = false;
      try {
        reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        // matchMedia fallback on web
        if (
          Platform.OS === "web" &&
          typeof window !== "undefined" &&
          window.matchMedia
        ) {
          reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
        }
      }

      const tier: GraphicsTier =
        Platform.OS === "web"
          ? // Phase 1 keeps web on the gradient tier even when WebGPU exists;
            // webgpu lights up in Phase 2 (3D phone). Detection wired now.
            "gradient"
          : "skia";

      if (!cancelled) {
        setState({ tier, reduceMotion, ready: true });
        if (__DEV__) {
          console.log(
            `[Landing] graphics tier="${tier}" reduceMotion=${reduceMotion} webgpu=${detectWebGPU()}`,
          );
        }
      }
    };

    resolve();

    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (reduceMotion) => {
        if (!cancelled) setState((s) => ({ ...s, reduceMotion }));
      },
    );

    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  return state;
}
