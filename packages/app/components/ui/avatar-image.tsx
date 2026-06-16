/**
 * Avatar Image Component
 *
 * Image-first avatar. No loading spinner, no fade transition — the
 * image snaps in from cache. Fallback is only rendered when the URI
 * is missing or an error handler fires via the native onError event.
 *
 * Dark theme, rounded corners, consistent styling.
 */

import { Image } from "expo-image";
import { View } from "react-native";
import { User } from "lucide-react-native";

interface AvatarImageProps {
  uri?: string | null;
  size?: number;
  className?: string;
  showPlaceholder?: boolean;
}

export function AvatarImage({
  uri,
  size = 40,
  className = "",
  showPlaceholder = true,
}: AvatarImageProps) {
  const showFallback = !uri;
  const borderRadius = Math.min(Math.round(size * 0.18), 16);

  if (showFallback && showPlaceholder) {
    return (
      <View
        className={`bg-muted items-center justify-center ${className}`}
        style={{ width: size, height: size, borderRadius }}
      >
        <User size={size * 0.5} color="#666" />
      </View>
    );
  }

  if (showFallback) {
    return (
      <View
        className={`bg-muted ${className}`}
        style={{ width: size, height: size, borderRadius }}
      />
    );
  }

  return (
    <View
      style={{ width: size, height: size, borderRadius, overflow: "hidden" }}
      className={className}
    >
      <Image
        source={{ uri: uri! }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={0}
        cachePolicy="memory-disk"
        recyclingKey={uri ?? undefined}
      />
    </View>
  );
}

/**
 * Small avatar for lists and comments
 */
export function SmallAvatar({
  uri,
  className,
}: {
  uri?: string | null;
  className?: string;
}) {
  return <AvatarImage uri={uri} size={32} className={className} />;
}

/**
 * Medium avatar for feed posts
 */
export function MediumAvatar({
  uri,
  className,
}: {
  uri?: string | null;
  className?: string;
}) {
  return <AvatarImage uri={uri} size={40} className={className} />;
}

/**
 * Large avatar for profile headers
 */
export function LargeAvatar({
  uri,
  className,
}: {
  uri?: string | null;
  className?: string;
}) {
  return <AvatarImage uri={uri} size={80} className={className} />;
}

/**
 * Extra large avatar for profile edit
 */
export function XLargeAvatar({
  uri,
  className,
}: {
  uri?: string | null;
  className?: string;
}) {
  return <AvatarImage uri={uri} size={120} className={className} />;
}
