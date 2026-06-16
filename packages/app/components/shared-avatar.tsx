/**
 * SharedAvatar — Avatar with shared element transition support.
 *
 * Wraps the standard Avatar in an Animated.View with sharedTransitionTag
 * so avatars smoothly morph between screens (e.g. feed → profile, message row → chat).
 *
 * Uses the "avatar" spring preset: snappy, circular shape preserved.
 *
 * CRITICAL: The avatar must render identically on both screens (same size, shape, URI).
 * If sizes differ, the transition handles the interpolation automatically.
 */

import React, { memo } from "react";
import { Platform, View, Text } from "react-native";
import { Image } from "expo-image";
import Animated from "react-native-reanimated";
import { avatarTransition } from "@dvnt/app/lib/shared-transitions";
import { resolveAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";

interface SharedAvatarProps {
  /** Shared transition tag — must match exactly on destination screen */
  sharedTag: string;
  /** Image URI or media object */
  uri?: unknown;
  /** Username for fallback */
  username?: string;
  /** Pixel size */
  size?: number;
  /** Shape variant */
  variant?: "roundedSquare" | "circle";
  /** Additional style */
  style?: object;
}

const FALLBACK_BG = "#3EA4E5";

function SharedAvatarComponent({
  sharedTag,
  uri,
  username = "User",
  size = 44,
  variant = "roundedSquare",
  style,
}: SharedAvatarProps) {
  const borderRadius =
    variant === "circle"
      ? size / 2
      : Math.min(Math.round(size * 0.18), 16);

  const resolvedUri = resolveAvatarUrl(uri);
  const showImage = Boolean(resolvedUri);
  const usernameInitial =
    username && username.trim().length > 0
      ? username.trim()[0].toUpperCase()
      : "U";

  // On web or without tag, render plain (no shared transition)
  if (Platform.OS === "web" || !sharedTag) {
    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius,
            backgroundColor: "#2a2a2a",
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
            style={{ width: size, height: size }}
            contentFit="cover"
            transition={0}
            cachePolicy="memory-disk"
            recyclingKey={resolvedUri ?? undefined}
          />
        ) : (
          <View
            style={{
              width: size,
              height: size,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: FALLBACK_BG,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontWeight: "700",
                fontSize: Math.round(size / 2),
              }}
            >
              {usernameInitial}
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <Animated.View
      // @ts-ignore - sharedTransitionTag is valid in Reanimated
      sharedTransitionTag={sharedTag}
      // @ts-ignore - SharedTransition builder type
      sharedTransitionStyle={avatarTransition}
      style={[
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: "#2a2a2a",
          overflow: "hidden",
          borderWidth: 1.5,
          borderColor: "#34A2DF",
          // Android stacking fix
          ...(Platform.OS === "android" ? { zIndex: 9999, elevation: 9999 } : {}),
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: resolvedUri! }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
          recyclingKey={resolvedUri ?? undefined}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: FALLBACK_BG,
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontWeight: "700",
              fontSize: Math.round(size / 2),
            }}
          >
            {usernameInitial}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

export const SharedAvatar = memo(SharedAvatarComponent);
