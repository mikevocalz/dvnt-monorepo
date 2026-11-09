import { memo, useState } from "react";
import { View, Platform, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { HashtagText } from "@dvnt/app/components/ui/hashtag-text";
import { TextPostBadgeLogo } from "./TextPostBadgeLogo";
import { resolveTextPostTheme, truncateTextPost } from "@dvnt/app/lib/posts/text-post";
import { fitTextPostFontSize } from "@dvnt/app/lib/posts/text-post-layout";
import type { TextPostThemeKey } from "@dvnt/app/lib/types";

type TextPostSurfaceVariant = "composer" | "feed" | "detail" | "grid";

interface TextPostSurfaceProps {
  text?: string | null;
  theme?: TextPostThemeKey | string | null;
  variant?: TextPostSurfaceVariant;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
}

const SURFACE_METRICS: Record<
  TextPostSurfaceVariant,
  {
    minHeight: number;
    padding: number;
    radius: number;
    fontSize: number;
    lineHeight: number;
  }
> = {
  composer: {
    minHeight: 320,
    padding: 24,
    radius: 28,
    fontSize: 34,
    lineHeight: 42,
  },
  feed: {
    minHeight: 238,
    padding: 22,
    radius: 26,
    fontSize: 30,
    lineHeight: 38,
  },
  detail: {
    minHeight: 360,
    padding: 28,
    radius: 30,
    fontSize: 38,
    lineHeight: 48,
  },
  grid: {
    minHeight: 148,
    padding: 16,
    radius: 18,
    fontSize: 22,
    lineHeight: 28,
  },
};

function TextPostSurfaceComponent({
  text,
  theme,
  variant = "feed",
  numberOfLines,
  style,
}: TextPostSurfaceProps) {
  const metrics = SURFACE_METRICS[variant];
  const [width, setWidth] = useState(0);
  const palette = resolveTextPostTheme(theme);
  const content = (text || "").trim();
  const fallback =
    variant === "composer"
      ? "Start a post worth stopping for."
      : "Untitled text post";
  const displayText =
    variant === "grid"
      ? truncateTextPost(content || fallback, 140)
      : content || fallback;

  const fontSize = fitTextPostFontSize(displayText, width - metrics.padding * 2, metrics.fontSize);
  const lineHeight = Math.ceil(fontSize * 1.28);
  const height = StyleSheet.flatten(style)?.height;
  const gridLines = Math.max(1, Math.floor(((typeof height === "number" ? height : metrics.minHeight) - metrics.padding * 2 - 38) / lineHeight));

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[
        {
          minHeight: metrics.minHeight,
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          borderRadius: metrics.radius,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: palette.gradient[0],
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 18 },
          shadowOpacity: 0.22,
          shadowRadius: 32,
        },
        style,
      ]}
    >
      <LinearGradient
        colors={palette.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -36,
            right: -10,
            width: 150,
            height: 150,
            borderRadius: 999,
            backgroundColor: palette.glow,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: -52,
            left: -24,
            width: 180,
            height: 180,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.05)",
          }}
        />
        <View
          style={{
            flex: 1,
            padding: metrics.padding,
            paddingTop:
              variant === "grid" ? metrics.padding + 18 : metrics.padding,
            justifyContent: variant === "grid" ? "space-between" : "center",
          }}
        >
          {variant !== "feed" && (
            <View
              style={{
                position: "absolute",
                top: 4,
                right: -14,
                width: variant === "grid" ? 118 : 132,
                height: variant === "grid" ? 28 : 32,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TextPostBadgeLogo
                width={variant === "grid" ? 102 : 116}
                height={variant === "grid" ? 20 : 24}
              />
            </View>
          )}

          <HashtagText
            text={displayText}
            numberOfLines={numberOfLines ?? (variant === "grid" ? gridLines : undefined)}
            adjustsFontSizeToFit
            color={palette.textPrimary}
            textStyle={{
              color: palette.textPrimary,
              fontSize,
              lineHeight,
              textAlign: "left",
              width: "100%",
              minWidth: 0,
              flexShrink: 1,
              ...(Platform.OS === "web" ? { overflowWrap: "anywhere", wordBreak: "break-word" } : {}),
              fontWeight: variant === "grid" ? "700" : "800",
              letterSpacing: -0.6,
            }}
          />

          {variant === "grid" ? (
            <View
              style={{
                marginTop: 16,
                width: 42,
                height: 3,
                borderRadius: 999,
                backgroundColor: palette.accent,
              }}
            />
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}

export const TextPostSurface = memo(TextPostSurfaceComponent);
