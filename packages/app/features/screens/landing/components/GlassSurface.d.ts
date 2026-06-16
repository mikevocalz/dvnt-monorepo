import type { ComponentType, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** Outer container style (radius/border live here). */
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /**
   * Animated overlay style layered above the blur — the header animates its
   * backgroundColor alpha to "turn to glass" without a binary swap.
   */
  tintStyle?: StyleProp<ViewStyle>;
  /** Blur strength: px (web) / intensity 0..100 (native). */
  blur?: number;
  pointerEvents?: "auto" | "none" | "box-none";
}

export const GlassSurface: ComponentType<GlassSurfaceProps>;
