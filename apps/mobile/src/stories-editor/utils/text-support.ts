import { Platform } from "react-native";

const RICH_GLYPH_REGEX = /[\u200D\uFE0F]|[^\u0000-\u024F\u1E00-\u1EFF]/u;

export function shouldUseSystemFontFallback(text?: string | null) {
  if (!text) return false;
  return RICH_GLYPH_REGEX.test(text);
}

export function getSystemFontWeight(
  fontFamily?: string | null,
): "300" | "400" | "600" | "700" | "800" {
  const normalized = fontFamily?.toLowerCase() || "";

  if (normalized.includes("light")) return "300";
  if (normalized.includes("semibold")) return "600";
  if (normalized.includes("bold")) return "700";
  if (normalized.includes("brave")) return "800";
  return "400";
}

export function getSystemFontFamily() {
  return Platform.select({
    ios: "System",
    android: "sans-serif",
    default: "System",
  });
}
