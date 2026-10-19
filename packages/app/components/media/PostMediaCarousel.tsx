import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { DVNTMediaRenderer } from "./DVNTMediaRenderer";
import { DVNTAnimatedVideoView } from "./DVNTAnimatedVideoView";
import { MediaLightbox } from "./MediaLightbox";
import type { MediaKind } from "@dvnt/app/lib/media/types";

export type PostCarouselMedia = {
  type?: string;
  url?: string;
  thumbnail?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
  updatedAt?: string | number;
};

const MediaSlide = memo(function MediaSlide({
  medium,
  galeriaIndex,
  width,
  height,
  isPlaying,
}: {
  medium: PostCarouselMedia;
  galeriaIndex: number;
  width: number;
  height: number;
  isPlaying: boolean;
}) {
  if (!medium.url || !/^https?:\/\//.test(medium.url)) {
    return (
      <View style={{ width, height, alignItems: "center", justifyContent: "center" }} className="bg-muted">
        <Text className="text-muted-foreground text-xs">No image</Text>
      </View>
    );
  }

  const media = (
    <DVNTMediaRenderer
      item={{ ...medium, url: medium.url, type: (medium.type ?? "image") as MediaKind }}
      width={width}
      height={height}
      contentFit="contain"
      isPlaying={isPlaying}
      videoSlot={medium.type === "video" ? (
        <DVNTAnimatedVideoView
          uri={medium.url}
          width="100%"
          height="100%"
          contentFit="contain"
          isPlaying={isPlaying}
        />
      ) : undefined}
    />
  );
  return (
    <View style={{ width, height }}>
      {galeriaIndex >= 0 ? (
        <MediaLightbox.Image index={galeriaIndex}>{media}</MediaLightbox.Image>
      ) : media}
    </View>
  );
});

/** Keep decoders mounted by asset identity, but give playback to one page only. */
export const PostMediaCarousel = memo(function PostMediaCarousel({
  media,
  width,
  height,
  isPlaying,
  onSlideChange,
  children,
}: {
  media: PostCarouselMedia[];
  width: number;
  height: number;
  isPlaying: boolean;
  onSlideChange: (index: number) => void;
  children?: ReactNode;
}) {
  // Per-carousel state starts at zero even if another post's screen is still
  // mounted underneath. The screen's shared slide store is only for overlays.
  const [currentSlide, setCurrentSlide] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const activeSlide = Math.min(currentSlide, Math.max(0, media.length - 1));
  const { lightboxMedia, lightboxIndices } = useMemo(() => {
    const items: (PostCarouselMedia & { url: string })[] = [];
    const indices = new Map<number, number>();
    media.forEach((item, index) => {
      if (item.type === "video" || !item.url || !/^https?:\/\//.test(item.url)) return;
      // Use the slide's index, not its URL: two Live Photos may share a still
      // but have different paired videos and must open the correct pair.
      indices.set(index, items.length);
      items.push({ ...item, url: item.url });
    });
    return { lightboxMedia: items, lightboxIndices: indices };
  }, [media]);
  const handleScroll = useCallback((event: any) => {
    if (width <= 0) return;
    const next = Math.max(0, Math.min(media.length - 1, Math.round(
      event.nativeEvent.contentOffset.x / width,
    )));
    setCurrentSlide(next);
    onSlideChange(next);
  }, [media.length, onSlideChange, width]);

  return (
    <MediaLightbox media={lightboxMedia} onOpenChange={setLightboxOpen}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {media.map((medium, index) => (
          <MediaSlide
            key={`${index}:${medium.url ?? ""}`}
            medium={medium}
            galeriaIndex={lightboxIndices.get(index) ?? -1}
            width={width}
            height={height}
            isPlaying={isPlaying && !lightboxOpen && index === activeSlide}
          />
        ))}
      </ScrollView>
      {children}
    </MediaLightbox>
  );
});
