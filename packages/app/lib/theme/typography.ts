/**
 * Strict 6-step type scale, semantic names. Every text element in the app
 * should reference one of these — anything else is a polish bug.
 *
 * Sizes & weights track Apple HIG iOS 17+ Dynamic Type defaults so the
 * scale doesn't shatter at Dynamic Type XL. Pair with the Inter +
 * SpaceGrotesk families declared in tailwind.config.js.
 *
 * Usage (NativeWind class):
 *   <Text className="text-heading">…</Text>
 *
 * Usage (inline style):
 *   import { text } from "@dvnt/app/lib/theme";
 *   <Text style={text.heading}>…</Text>
 */
import type { TextStyle } from "react-native";

type TypeStyle = Pick<
  TextStyle,
  "fontSize" | "lineHeight" | "fontWeight" | "letterSpacing" | "textTransform"
>;

export const text = {
  display: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  heading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "400",
  },
  caption: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "500",
  },
  micro: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TypeStyle>;

export type TypeName = keyof typeof text;
