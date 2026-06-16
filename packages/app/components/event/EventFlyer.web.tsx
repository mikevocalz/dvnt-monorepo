"use client";

import { useState } from "react";
import { color } from "@dvnt/app/lib/theme";
import { useEventDominantColor } from "@dvnt/app/lib/color/useEventDominantColor";

export interface EventFlyerMedia {
  /** Event id — lets the color hook persist a first-view extraction (write-back). */
  eventId?: number | string | null;
  videoFlyerUrl?: string | null;
  videoPosterUrl?: string | null;
  staticFlyerUrl?: string | null;
  dominantColor?: string | null;
  title: string;
}

export interface EventFlyerProps {
  media: EventFlyerMedia;
  /** Autoplay the video flyer muted (feed). Off for static contexts (wallet, share). */
  autoplay?: boolean;
  /** Force the static representation (wallet, share card, OG, scanner) — never video. */
  staticOnly?: boolean;
  /** Aspect ratio (w/h). Default 3/4 portrait flyer. */
  aspect?: number;
  className?: string;
  rounded?: number;
}

const VIDEO_RE = /\.(mp4|mov|webm|m3u8)(\?|$)/i;

/**
 * The flyer precedence primitive (Pillar D). Resolves: video → poster/static →
 * generated fallback. NEVER renders an empty media box — the generated gradient+
 * title is a real designed state. One component for feed, event page, wallet,
 * share card, scanner, boost slot so the precedence can't drift.
 */
export function EventFlyer({
  media,
  autoplay = false,
  staticOnly = false,
  aspect = 3 / 4,
  className,
  rounded = 16,
}: EventFlyerProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const hasVideo = !staticOnly && !!media.videoFlyerUrl && VIDEO_RE.test(media.videoFlyerUrl) && !videoFailed;
  const staticSrc = media.videoPosterUrl || media.staticFlyerUrl || null;
  const hasStatic = !!staticSrc && !imgFailed;

  // Dominant color: db value if set, else extracted on-device (and persisted via
  // set-event-color so video-only events stop falling through to the generic
  // gradient). Never blocks render — falls back to brand ink.
  const { color: bg } = useEventDominantColor({
    eventId: media.eventId,
    dominantColor: media.dominantColor,
    imageUrl: media.videoPosterUrl || media.staticFlyerUrl,
    videoUrl: media.videoFlyerUrl,
  });

  const wrap: React.CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: String(aspect),
    borderRadius: rounded,
    overflow: "hidden",
    background: bg || color.inkDeep,
  };

  // Generated fallback — gradient from dominant color + typeset title.
  const fallback = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-end",
        padding: 16,
        background: bg
          ? `linear-gradient(160deg, ${bg} 0%, ${color.inkDeep} 100%)`
          : `linear-gradient(160deg, ${color.violet} 0%, ${color.inkDeep} 100%)`,
      }}
    >
      <span
        style={{
          fontFamily: "SpaceGrotesk, system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 22,
          lineHeight: 1.1,
          letterSpacing: "0.01em",
          color: color.text,
          textShadow: "0 1px 12px rgba(0,0,0,0.5)",
        }}
      >
        {media.title}
      </span>
    </div>
  );

  return (
    <div style={wrap} className={className} aria-label={media.title}>
      {hasVideo ? (
        <video
          src={media.videoFlyerUrl!}
          poster={staticSrc || undefined}
          muted
          loop
          playsInline
          autoPlay={autoplay}
          onError={() => setVideoFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : hasStatic ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={staticSrc!}
          alt={media.title}
          onError={() => setImgFailed(true)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
