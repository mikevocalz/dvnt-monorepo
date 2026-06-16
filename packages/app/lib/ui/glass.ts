import type { ViewStyle } from "react-native";

export const GLASS_TEXT_COLORS = {
  primary: "#FAFAF9",
  secondary: "rgba(245, 245, 244, 0.82)",
  muted: "rgba(231, 229, 228, 0.66)",
} as const;

export const GLASS_SURFACE = {
  border: "rgba(255,255,255,0.14)",
  borderStrong: "rgba(255,255,255,0.2)",
  highlight: "rgba(255,255,255,0.08)",
  shadow: "rgba(0,0,0,0.32)",
  sheetScrim: "rgba(6,10,18,0.54)",
  sheetScrimFallback: "rgba(6,10,18,0.62)",
  pillScrim: "rgba(6,10,18,0.38)",
  pillScrimFallback: "rgba(6,10,18,0.5)",
  androidSurface: "rgba(12,16,24,0.94)",
} as const;

export function createGlassOuterStyle(radius: number): ViewStyle {
  return {
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GLASS_SURFACE.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
  };
}

export function createGlassScrimStyle(
  variant: "sheet" | "pill",
  fallback = false,
): ViewStyle {
  return {
    backgroundColor:
      variant === "sheet"
        ? fallback
          ? GLASS_SURFACE.sheetScrimFallback
          : GLASS_SURFACE.sheetScrim
        : fallback
          ? GLASS_SURFACE.pillScrimFallback
          : GLASS_SURFACE.pillScrim,
  };
}
