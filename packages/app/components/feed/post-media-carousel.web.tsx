import { useId } from "react";
import { useCarouselStore } from "@dvnt/app/lib/stores/carousel-store";
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";
import { useMediaFrameStore } from "@dvnt/app/lib/stores/media-frame-store";
import { CAROUSEL_DOT_COLORS } from "./feed-media-mode";
import { LivePhotoBadge, LivePhotoMedia, useLivePhoto } from "./live-photo-player.web";
import { useFeedVideo } from "./use-feed-video.web";
import { isWebLivePhoto, resolveWebPostMedia, type WebPostMedium } from "./web-post-media";

export function PostMediaCarousel({
  media,
  caption,
}: { media: WebPostMedium[]; caption: string }) {
  const owner = useId();
  const selectedIndex = useCarouselStore((s) => s.owner === owner ? s.index : 0);
  const index = Math.max(0, Math.min(media.length - 1, selectedIndex));
  const setIndex = useCarouselStore((s) => s.setIndex);
  const openAt = useLightboxStore((s) => s.openAt);
  const multiple = media.length > 1;
  const items = media.map((m) => ({
    type: m.type,
    url: m.url,
    poster: resolveWebPostMedia(m).posterUrl,
    livePhotoVideoUrl: m.livePhotoVideoUrl,
    mimeType: m.mimeType,
  }));

  return (
    <div className="relative bg-black">
      <div
        data-post-media-carousel
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        onScroll={(e) => {
          const el = e.currentTarget;
          const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          setIndex(Math.max(0, Math.min(media.length - 1, next)), owner);
        }}
      >
        {media.map((medium, i) => (
          <PostMediaSlide
            key={`${i}:${medium.url}:${medium.livePhotoVideoUrl ?? ""}`}
            medium={medium}
            caption={caption}
            multiple={multiple}
            active={i === index}
            open={() => openAt(items, i)}
          />
        ))}
      </div>

      {multiple ? (
        <>
          <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/55 text-white text-xs font-medium pointer-events-none">
            {Math.min(index + 1, media.length)}/{media.length}
          </div>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 pointer-events-none">
            {media.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-4" : "w-1.5 bg-white/45"}`}
                style={i === index ? { backgroundColor: CAROUSEL_DOT_COLORS[i % CAROUSEL_DOT_COLORS.length] } : undefined}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PostMediaSlide({
  medium, caption, multiple, active, open,
}: {
  medium: WebPostMedium;
  caption: string;
  multiple: boolean;
  active: boolean;
  open: () => void;
}) {
  const { videoUrl, posterUrl } = resolveWebPostMedia(medium);
  // A Live Photo is a still that moves on hover/hold, never an autoplay loop.
  const livePhoto = isWebLivePhoto(medium);
  const { ref, muted, blocked, play } = useFeedVideo(livePhoto ? undefined : videoUrl, { active });
  const live = useLivePhoto(livePhoto ? videoUrl : undefined, { active });
  const aspect = useMediaFrameStore((s) => s.aspectByUrl[posterUrl ?? medium.url]);
  const setAspect = useMediaFrameStore((s) => s.setAspect);
  const still = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={posterUrl || medium.url}
      alt={caption}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (h > 0) setAspect(posterUrl || medium.url, w / h);
      }}
      className={multiple
        ? "w-full max-h-[78vh] object-contain bg-black"
        : "mx-auto block h-auto w-auto max-w-full max-h-[62vh] object-contain bg-black"}
      style={multiple ? undefined : { aspectRatio: String(aspect ?? 4 / 5) }}
    />
  );

  return (
    <div
      {...(livePhoto ? live.containerProps : null)}
      className="snap-center shrink-0 w-full relative"
    >
      <button type="button" onClick={open} aria-label="Open media" className="block w-full cursor-zoom-in">
        {livePhoto ? (
          <LivePhotoMedia live={live} fit="contain">{still}</LivePhotoMedia>
        ) : videoUrl ? (
          <video
            ref={ref}
            data-post-motion
            src={videoUrl}
            poster={posterUrl}
            preload="metadata"
            muted={muted}
            loop
            playsInline
            className="w-full max-h-[78vh] object-contain bg-black pointer-events-none"
          />
        ) : (
          still
        )}
      </button>
      {livePhoto ? <LivePhotoBadge live={live} className="absolute top-2 left-2" /> : null}
      {active && blocked ? (
        <button type="button" onClick={play} aria-label="Play video" className="absolute top-3 left-3 min-h-11 rounded-lg bg-black/70 px-3 text-white">
          Play
        </button>
      ) : null}
    </div>
  );
}
