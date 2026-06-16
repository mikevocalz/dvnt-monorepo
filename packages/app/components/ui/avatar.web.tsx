import { View, Text } from "react-native";
import { memo } from "react";
import { resolveAvatarUrl } from "../../lib/media/resolveAvatarUrl";

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
  uri?: unknown;
  username?: string;
  size?: AvatarSize;
  variant?: AvatarVariant;
  style?: object;
  transition?: number;
}

const FALLBACK_BG = "#1a1a1a";

function AvatarComponent({
  uri,
  username = "User",
  size = "md",
  variant = "roundedSquare",
  style,
}: AvatarProps) {
  const sizeValue = typeof size === "number" ? size : AvatarSizes[size];
  const borderRadius =
    variant === "circle"
      ? sizeValue / 2
      : Math.min(Math.round(sizeValue * 0.18), 16);

  const resolvedUri = resolveAvatarUrl(uri);
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
        <img
          src={resolvedUri!}
          style={{ width: sizeValue, height: sizeValue, objectFit: "cover", display: "block" }}
          alt={username}
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
export const UserAvatar = Avatar;
