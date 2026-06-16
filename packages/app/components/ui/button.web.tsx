import * as React from "react";
import { Pressable, Text, ActivityIndicator, StyleSheet } from "react-native";

type Variant = "default" | "secondary" | "outline" | "link";

/**
 * Web Button. Styled with RN StyleSheet (NOT NativeWind `className`): className
 * doesn't resolve on react-native-web in this Next build, which left the shared
 * button.tsx invisible (no bg, dark-on-dark text). StyleSheet styles ARE applied
 * by RNW. Default variant = the deviant cyan→purple gradient CTA.
 */
export function Button({
  children,
  onPress,
  disabled,
  loading,
  variant = "default",
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  className?: string;
}) {
  const isLink = variant === "link";
  const shouldWrapText =
    typeof children === "string" || typeof children === "number";

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.base,
        variant === "default" && styles.default,
        variant === "secondary" && styles.secondary,
        variant === "outline" && styles.outline,
        isLink && styles.link,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : shouldWrapText ? (
        <Text
          style={[
            styles.text,
            variant === "default" && styles.textOnPrimary,
            isLink && styles.textLink,
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const GRADIENT = "linear-gradient(135deg, #3FDCFF 0%, #8A40CF 100%)";

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  default: ({ backgroundImage: GRADIENT } as unknown) as Record<string, unknown>,
  secondary: { backgroundColor: "rgba(255,255,255,0.08)" },
  outline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  link: { height: undefined, paddingHorizontal: 0, paddingVertical: 8 },
  disabled: { opacity: 0.5 },
  text: { fontSize: 16, fontWeight: "700", color: "#fff" },
  textOnPrimary: { color: "#fff" },
  textLink: { color: "rgb(62, 164, 229)" },
});
