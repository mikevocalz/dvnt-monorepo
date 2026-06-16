import * as React from "react";
import { Pressable, Text, ActivityIndicator } from "react-native";
import { cn } from "@/lib/cn";

type Variant = "default" | "secondary" | "outline" | "link";

export function Button({
  children,
  onPress,
  disabled,
  loading,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  className?: string;
}) {
  const base = variant === "link" ? "px-0 py-2" : "px-4 py-3 rounded-xl";

  const bg =
    variant === "secondary"
      ? "bg-card"
      : variant === "outline"
        ? "bg-transparent border border-border"
        : variant === "link"
          ? ""
          : "bg-primary";

  const opacity = disabled ? "opacity-50" : "opacity-100";

  const textClassName =
    variant === "link"
      ? "text-primary"
      : variant === "default"
        ? "text-primary-foreground"
        : "text-foreground";

  const shouldWrapText =
    typeof children === "string" || typeof children === "number";

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      className={cn(
        base,
        bg,
        opacity,
        "items-center justify-center",
        className,
      )}
    >
      {loading ? (
        <ActivityIndicator color={variant === "default" ? "#fff" : undefined} />
      ) : shouldWrapText ? (
        <Text className={cn(textClassName, "font-semibold")}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
