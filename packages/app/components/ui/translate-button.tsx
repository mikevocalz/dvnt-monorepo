import React, { useCallback, useRef, useEffect } from "react";
import {
  Pressable,
  ActivityIndicator,
  View,
  Text,
  Animated,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { Languages } from "lucide-react-native";
import { useTranslation } from "react-i18next";

/**
 * TranslateButton — glass/liquid premium translate affordance.
 *
 * Visual states:
 *   idle       → glass pill, subtle globe icon
 *   loading    → spinner inside glass pill
 *   translated → cyan tint, "Original" label
 *   error      → amber tint, brief error, auto-clears
 *   unavailable → hidden (caller must gate with isCapable)
 */

interface TranslateButtonProps {
  onTranslate: () => Promise<void>;
  isTranslated: boolean;
  onToggleOriginal: () => void;
  /** sm = 26px height (feed), md = 30px height (detail) */
  size?: "sm" | "md";
  /** Show text label beside icon */
  showLabel?: boolean;
}

export function TranslateButton({
  onTranslate,
  isTranslated,
  onToggleOriginal,
  size = "sm",
  showLabel = false,
}: TranslateButtonProps) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  // Fade between states
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Clear error after 2.5s
  useEffect(() => {
    if (!hasError) return;
    const t = setTimeout(() => setHasError(false), 2500);
    return () => clearTimeout(t);
  }, [hasError]);

  const handlePress = useCallback(async () => {
    if (isTranslated) {
      // Micro-spring feedback
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 0.92,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 300,
          friction: 10,
        }),
      ]).start();
      onToggleOriginal();
      return;
    }

    setIsLoading(true);
    setHasError(false);

    // Pulse animation while loading
    Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0.55,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    ).start();

    try {
      await onTranslate();
      // Success spring
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.08,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 300,
          friction: 10,
        }),
      ]).start();
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
      fadeAnim.stopAnimation();
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start();
    }
  }, [isTranslated, onToggleOriginal, onTranslate, fadeAnim, scaleAnim]);

  const height = size === "sm" ? 26 : 30;
  const iconSize = size === "sm" ? 12 : 14;
  const fontSize = size === "sm" ? 11 : 12;
  const px = showLabel || hasError ? 9 : 7;

  // State-based styling
  const tint: "light" | "dark" = "dark";
  const borderColor = hasError
    ? "rgba(255, 165, 60, 0.45)"
    : isTranslated
      ? "rgba(63, 220, 255, 0.4)"
      : "rgba(255, 255, 255, 0.15)";

  const glassColor = hasError
    ? "rgba(255, 140, 40, 0.18)"
    : isTranslated
      ? "rgba(63, 220, 255, 0.18)"
      : "rgba(255, 255, 255, 0.06)";

  const iconColor = hasError
    ? "rgba(255, 165, 60, 0.95)"
    : isTranslated
      ? "#3FDCFF"
      : "rgba(255, 255, 255, 0.65)";

  const label = hasError
    ? t("common.error")
    : isTranslated
      ? t("common.original")
      : t("common.translate");

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ scale: scaleAnim }],
        alignSelf: "flex-start",
      }}
    >
      <Pressable
        onPress={handlePress}
        disabled={isLoading}
        style={({ pressed }) => [
          styles.container,
          {
            height,
            minWidth: height,
            paddingHorizontal: px,
            borderRadius: 8,
            borderColor,
            backgroundColor: glassColor,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        {/* Glass background layer */}
        <BlurView
          intensity={12}
          tint={tint}
          style={StyleSheet.absoluteFill}
        />

        {/* Content */}
        <View style={styles.inner}>
          {isLoading ? (
            <ActivityIndicator
              size="small"
              color={isTranslated ? "#3FDCFF" : "rgba(255,255,255,0.7)"}
              style={{ width: iconSize, height: iconSize }}
            />
          ) : (
            <Languages size={iconSize} color={iconColor} strokeWidth={2} />
          )}

          {(showLabel || hasError) && (
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  fontSize,
                  color: iconColor,
                },
              ]}
            >
              {isLoading ? null : label}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 0.75,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    zIndex: 1,
  },
  label: {
    fontWeight: "500",
    letterSpacing: 0.1,
  },
});

/** Small badge shown after translation is applied — used in detail views */
export function TranslatedBadge() {
  const { t } = useTranslation();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: "rgba(63, 220, 255, 0.1)",
        borderWidth: 0.75,
        borderColor: "rgba(63, 220, 255, 0.25)",
        alignSelf: "flex-start",
      }}
    >
      <Languages size={11} color="#3FDCFF" strokeWidth={2} />
      <Text
        style={{
          fontSize: 10,
          fontWeight: "500",
          color: "#3FDCFF",
          letterSpacing: 0.2,
        }}
      >
        {t("common.translated")}
      </Text>
    </View>
  );
}
