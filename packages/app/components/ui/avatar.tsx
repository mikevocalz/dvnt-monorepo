import { View, Text } from "react-native";
import { Image } from "expo-image";
import { memo } from "react";
import { resolveAvatarUrl } from "../../lib/media/resolveAvatarUrl";

// Preset sizes for consistency
export const AvatarSizes = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 64,
  xl: 80,
  xxl: 100,
} as const;

export type AvatarSize = keyof typeof AvatarSizes | number;
export type AvatarVariant = "roundedSquare" | "circle";

export interface AvatarProps {
  /** Image URI or media object - resolved internally */
  uri?: unknown;
  /** Username for generating fallback avatar */
  username?: string;
  /** Size - can be preset name or number */
  size?: AvatarSize;
  /** Shape variant - roundedSquare (default) or circle */
  variant?: AvatarVariant;
  /** Additional style overrides */
  style?: object;
  /**
   * Image transition (ms). Defaults to 0 — no fade. Setting this
   * non-zero reintroduces the "trickle" where initials flash and the
   * image fades in over them. Leave at 0 unless the caller has a
   * specific reason (e.g. a hero avatar with dramatic entrance).
   */
  transition?: number;
}

const FALLBACK_BG = "#1a1a1a"; // neutral DVNT muted — no initial flash

/**
 * Reusable UserAvatar component
 *
 * Image-first: when a uri resolves, the image layer owns the tile and
 * snaps in with no fade (transition=0). Initials are ONLY rendered as
 * a fallback when the uri is null/empty — this removes the "initials
 * flash → image trickle" pattern that was showing across the app.
 *
 * Cache: `memory-disk` + `recyclingKey={uri}` lets expo-image reuse
 * native views across re-renders and serve the same URL instantly on
 * subsequent mounts.
 */
function AvatarComponent({
  uri,
  username = "User",
  size = "md",
  variant = "roundedSquare",
  style,
  transition = 0,
}: AvatarProps) {
  const sizeValue = typeof size === "number" ? size : AvatarSizes[size];

  const borderRadius =
    variant === "circle"
      ? sizeValue / 2
      : Math.min(Math.round(sizeValue * 0.18), 16);

  const resolvedUri = resolveAvatarUrl(
    uri,
    __DEV__ ? `Avatar:${username}` : undefined,
  );
  const showImage = Boolean(resolvedUri);
  const usernameInitial =
    username && username.trim().length > 0
      ? username.trim()[0].toUpperCase()
      : "U";

  return (
    <View
      style={[
        {
          width: sizeValue,
          height: sizeValue,
          borderRadius,
          backgroundColor: showImage ? FALLBACK_BG : "#3EA4E5",
          overflow: "hidden",
          borderWidth: 1.5,
          borderColor: "#34A2DF",
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: resolvedUri! }}
          style={{
            width: sizeValue,
            height: sizeValue,
          }}
          contentFit="cover"
          transition={transition}
          cachePolicy="memory-disk"
          recyclingKey={resolvedUri ?? undefined}
        />
      ) : (
        <View
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
              fontSize: Math.round(sizeValue / 2),
            }}
          >
            {usernameInitial}
          </Text>
        </View>
      )}
    </View>
  );
}

export const Avatar = memo(AvatarComponent);

// Alias for semantic clarity
export const UserAvatar = Avatar;
