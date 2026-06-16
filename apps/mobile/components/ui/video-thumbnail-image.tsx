/**
 * VideoThumbnailImage
 *
 * Generates a real thumbnail from a remote video URL via getVideoThumbnail service.
 * Caches the result with React Query so thumbnails are only generated once per video.
 * Falls back to a dark placeholder + Play icon if generation fails or times out.
 */

import { View } from "react-native";
import { Image } from "expo-image";
import { Play } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { getVideoThumbnail } from "@/lib/media/getVideoThumbnail";

const thumbnailKeys = {
  forVideo: (videoUrl: string) => ["videoThumbnail", videoUrl] as const,
};

interface VideoThumbnailImageProps {
  videoUrl: string;
  style?: any;
  transition?: number;
}

export function VideoThumbnailImage({
  videoUrl,
  style,
  transition = 200,
}: VideoThumbnailImageProps) {
  const { data: thumbnailUri } = useQuery({
    queryKey: thumbnailKeys.forVideo(videoUrl),
    queryFn: () => getVideoThumbnail(videoUrl),
    enabled: !!videoUrl,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  if (thumbnailUri) {
    return (
      <Image
        source={{ uri: thumbnailUri }}
        style={[{ width: "100%", height: "100%" }, style]}
        contentFit="cover"
        transition={transition}
        cachePolicy="memory-disk"
      />
    );
  }

  return (
    <View
      style={[
        {
          width: "100%",
          height: "100%",
          backgroundColor: "#1a1a1a",
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Play size={24} color="#666" fill="#666" />
    </View>
  );
}
