/**
 * UserAvatar — Production-grade reusable avatar component
 *
 * Features:
 * - Sizes: xs(20) / sm(28) / md(40) / lg(56) / xl(80) / xxl(120)
 * - Rounded-square crop with consistent padding
 * - Gradient fallback initials (no external API dependency)
 * - Image-first: snaps in from memory-disk cache with no transition,
 *   no shimmer, no loading overlay. Fallback to initials only when
 *   the URI is null/empty or a 404 fires via onError.
 * - Status badge support (online / live / away)
 * - Active speaker ring animation
 */

import { View, Text, Animated, Easing } from "react-native";
import { Image } from "expo-image";
import { memo, useEffect, useRef, useState, useCallback } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { resolveAvatarUrl } from "@/lib/media/resolveAvatarUrl";

// ── Size presets ────────────────────────────────────────────────────
export const AVATAR_SIZES = {
  xs: 20,
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
  xxl: 120,
} as const;

export type AvatarSizeKey = keyof typeof AVATAR_SIZES;
export type AvatarSize = AvatarSizeKey | number;

// ── Status badge ────────────────────────────────────────────────────
export type AvatarStatus = "online" | "live" | "away" | "none";

// ── Gradient palettes for initials fallback ─────────────────────────
const GRADIENT_PALETTES: [string, string][] = [
  ["#8A40CF", "#6C2FA0"],
  ["#FC253A", "#D91A2E"],
  ["#3EA4E5", "#2B7CB5"],
  ["#F59E0B", "#D97706"],
  ["#10B981", "#059669"],
  ["#EC4899", "#BE185D"],
  ["#6366F1", "#4F46E5"],
  ["#14B8A6", "#0D9488"],
];

function getGradient(name: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENT_PALETTES[Math.abs(hash) % GRADIENT_PALETTES.length];
}

// ── Speaker ring animation ──────────────────────────────────────────
function SpeakerRing({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.15],
  });

  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });

  const ringSize = size + 8;

  return (
    <View
      style={{
        width: ringSize,
        height: ringSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={{
          position: "absolute",
          width: ringSize,
          height: ringSize,
          borderRadius: Math.min(Math.round(ringSize * 0.18), 18),
          borderWidth: 2,
          borderColor: "#22C55E",
          opacity: ringOpacity,
          transform: [{ scale: ringScale }],
        }}
      />
      <View
        style={{
          width: size + 4,
          height: size + 4,
          borderRadius: Math.min(Math.round((size + 4) * 0.18), 18),
          borderWidth: 2,
          borderColor: "#22C55E",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </View>
  );
}

// ── Status badge dot ────────────────────────────────────────────────
function StatusBadge({ status, size }: { status: AvatarStatus; size: number }) {
  if (status === "none") return null;

  const dotSize = Math.max(Math.round(size * 0.22), 8);
  const borderWidth = Math.max(Math.round(size * 0.04), 2);

  const colors: Record<AvatarStatus, string> = {
    online: "#22C55E",
    live: "#FC253A",
    away: "#F59E0B",
    none: "transparent",
  };

  return (
    <View
      style={{
        position: "absolute",
        bottom: 0,
        right: 0,
        width: dotSize,
        height: dotSize,
        borderRadius: dotSize / 2,
        backgroundColor: colors[status],
        borderWidth,
        borderColor: "#0A0A0A",
      }}
    />
  );
}

// ── Props ────────────────────────────────────────────────────────────
export interface UserAvatarProps {
  uri?: unknown;
  username?: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  isSpeaking?: boolean;
  style?: object;
}

// ── Main component ──────────────────────────────────────────────────
function UserAvatarComponent({
  uri,
  username = "User",
  size = "md",
  status = "none",
  isSpeaking = false,
  style,
}: UserAvatarProps) {
  const sizeValue = typeof size === "number" ? size : AVATAR_SIZES[size];
  // hasError fallback is kept so a 404 flips back to the gradient
  // initials. No isLoading state — the image snaps in from cache and
  // the shimmer overlay used to BE the "trickle" the user complained
  // about, so it's gone.
  const [hasError, setHasError] = useState(false);

  const resolvedUri = resolveAvatarUrl(uri);
  const showImage = Boolean(resolvedUri) && !hasError;

  const initial =
    username.trim().length > 0 ? username.trim()[0].toUpperCase() : "U";

  const gradient = getGradient(username);
  const fontSize = Math.round(sizeValue * 0.4);

  const handleError = useCallback(() => setHasError(true), []);

  const avatarContent = (
    <View
      style={[
        {
          width: sizeValue,
          height: sizeValue,
          borderRadius: Math.min(Math.round(sizeValue * 0.18), 16),
          overflow: "hidden",
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: resolvedUri! }}
          style={{ width: sizeValue, height: sizeValue }}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
          recyclingKey={resolvedUri ?? undefined}
          onError={handleError}
        />
      ) : (
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: sizeValue,
            height: sizeValue,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontWeight: "700",
              fontSize,
              includeFontPadding: false,
            }}
          >
            {initial}
          </Text>
        </LinearGradient>
      )}

      <StatusBadge status={status} size={sizeValue} />
    </View>
  );

  if (isSpeaking) {
    return <SpeakerRing size={sizeValue}>{avatarContent}</SpeakerRing>;
  }

  return avatarContent;
}

export const UserAvatar = memo(UserAvatarComponent);
