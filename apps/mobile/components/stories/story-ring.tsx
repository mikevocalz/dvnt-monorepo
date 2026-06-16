import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { cn } from "@/lib/utils";

interface StoryRingProps {
  src?: string;
  alt: string;
  hasStory?: boolean;
  isViewed?: boolean;
  isCloseFriends?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Optional thumbnail from the first story item - shown instead of avatar if provided */
  storyThumbnail?: string;
}

const sizeStyles = {
  sm: { height: 88, width: 56 },
  md: { height: 104, width: 74 },
  lg: { height: 120, width: 96 },
};

const ringPadding = {
  sm: 2,
  md: 3,
  lg: 3,
};

export function StoryRing({
  src,
  alt,
  hasStory = false,
  isViewed = false,
  isCloseFriends = false,
  size = "md",
  className,
  storyThumbnail,
}: StoryRingProps) {
  const showGradient = hasStory && !isViewed;
  const dimensions = sizeStyles[size];
  const padding = ringPadding[size];

  // Use story thumbnail if available, otherwise fall back to avatar
  const imageSource = storyThumbnail || src;

  const avatarContent = (
    <View
      style={{
        height: dimensions.height - padding * 2,
        width: dimensions.width - padding * 2,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: "#0c0a09",
        overflow: "hidden",
        backgroundColor: "#1a1a1a",
      }}
    >
      {imageSource ? (
        <Image
          source={{ uri: imageSource }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority="high"
          recyclingKey={imageSource}
        />
      ) : (
        <View
          style={{ width: "100%", height: "100%", backgroundColor: "#2a2a2a" }}
        />
      )}
    </View>
  );

  if (showGradient) {
    // Close Friends stories get a red (#FC253A) gradient ring
    const gradientColors: [string, string, ...string[]] = isCloseFriends
      ? ["#FC253A", "#FF4D5E", "#FC253A"]
      : ["#3FDCFF", "#FF5BFC", "#8A40CF"];

    return (
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={{
          borderRadius: 12,
          padding: padding,
          height: dimensions.height,
          width: dimensions.width,
        }}
      >
        {avatarContent}
      </LinearGradient>
    );
  }

  return (
    <View
      style={{
        borderRadius: 12,
        padding: padding,
        height: dimensions.height,
        width: dimensions.width,
        backgroundColor:
          hasStory && isViewed ? "#292524" : "rgba(28, 25, 23, 0.6)",
      }}
      className={cn(className)}
    >
      {avatarContent}
    </View>
  );
}
