"use client";

import type {
  StoryAnimatedGifOverlay,
  StoryOverlay,
} from "@dvnt/app/lib/types";

/**
 * Shared web renderer for a story item's overlays (text / emoji / image sticker
 * / WS-4 interactive sticker) + animated-GIF overlays. ONE component used by
 * BOTH the create-story preview and the full-screen story viewer so the two can
 * never drift.
 *
 * Positioning + styling mirror the NATIVE playback renderer `StoryOverlayLayer`
 * in `packages/app/features/routes/screens/(protected)/story/[id].tsx`
 * (lines ~464-657) exactly:
 *   - size  = width * sizeRatio * scale (square, width-based)  → CSS `cqw`
 *   - center = (width * x, height * y)                          → left/top % + translate(-50%,-50%)
 *   - text fontSize = max(width * fontSizeRatio * scale, 18)    → max(18px, N cqw)
 *   - text box: left = width*x - maxWidth/2, top = height*y - fontSize
 *   - rotation about the element centre
 * `cqw` (container-query width) reproduces native's width-based sizing — the
 * wrapper declares `containerType: inline-size`, so it fills the 9:16 stage and
 * `cqw` == stage width. Ratios come straight from the editor producers
 * (`textElementToOverlay` / `stickerElementToOverlay` / `ws4StickerToOverlay` /
 * `gifStickerToAnimatedOverlay` in `story-editor.web.tsx`) on a 1080×1920 canvas.
 *
 * DOM/CSS only — no Skia / reanimated — consistent with the web story files.
 */

// Web URLs for the DVNT/Ballroom image-sticker packs. Same map + resolution
// approach `story-editor.web.tsx` uses; that file imports STICKER_WEB_URLS from
// here so the two stay in sync (single source of truth).
export const STICKER_WEB_URLS: Record<string, string> = {
  "dvnt-app": "/stickers/dvnt/DVNT-stickers_APP.png",
  "dvnt-afterhours": "/stickers/dvnt/DVNT-stickers_AfterHours.png",
  "dvnt-counterculture": "/stickers/dvnt/DVNT-stickers_CounterCulture.png",
  "dvnt-dayplay": "/stickers/dvnt/DVNT-stickers_DAYPLAY.png",
  "dvnt-deviant": "/stickers/dvnt/DVNT-stickers_Deviant.png",
  "dvnt-energycheck": "/stickers/dvnt/DVNT-stickers_EnergyCheck.png",
  "dvnt-ftc": "/stickers/dvnt/DVNT-stickers_FTC.png",
  "dvnt-outside": "/stickers/dvnt/DVNT-stickers_OUTSIDE.png",
  "dvnt-eatit": "/stickers/dvnt/eat-it.png",
  "ballroom-chop": "/stickers/ballroom/1-chop.png",
  "ballroom-serve1": "/stickers/ballroom/serve.png",
  "ballroom-serve2": "/stickers/ballroom/category-is.png",
  "ballroom-ate": "/stickers/ballroom/ate-that.png",
  "ballroom-tea": "/stickers/ballroom/tea.png",
};

/** Resolve an image sticker to a browser URL (explicit url first, else pack id). */
export function resolveStickerWebUrl(
  assetId?: string,
  url?: string,
): string | null {
  if (url) return url;
  if (assetId && STICKER_WEB_URLS[assetId]) return STICKER_WEB_URLS[assetId];
  return null;
}

/**
 * Deep-link target for a WS-4 interactive text overlay, from its metadata ONLY
 * (never invented). Producers (`WS4_STICKERS` in story-editor.web.tsx) stamp:
 *   event  → { kind: "event",  eventId }
 *   ticket → { kind: "ticket", eventId }
 *   mention→ { kind: "mention", username }
 *   link   → { kind: "link",    url }
 * Routes verified in apps/web: `/feed/events/[id]`, `/feed/[username]`.
 * Returns null when the metadata carries no usable target (e.g. empty eventId).
 */
export function ws4OverlayTarget(
  overlay: StoryOverlay,
): { href: string; external: boolean } | null {
  if (overlay.type !== "text" || !overlay.metadata) return null;
  const meta = overlay.metadata;
  const kind = meta.kind ?? overlay.stickerKind;
  if (kind === "event" || kind === "ticket") {
    const eventId = meta.eventId;
    if (eventId) return { href: `/feed/events/${eventId}`, external: false };
    return null;
  }
  if (kind === "mention") {
    const username = meta.username;
    if (username) return { href: `/feed/${username}`, external: false };
    return null;
  }
  if (kind === "link") {
    const url = meta.url;
    if (url) return { href: url, external: true };
    return null;
  }
  return null;
}

function overlayCenterBox(
  x: number,
  y: number,
  sizeRatio: number,
  scale: number,
  rotation: number,
  opacity?: number,
): React.CSSProperties {
  const size = `${sizeRatio * scale * 100}cqw`;
  return {
    position: "absolute",
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: size,
    height: size,
    opacity: opacity ?? 1,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
}

function GifOrImage({ url }: { url: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="w-full h-full"
      style={{ objectFit: "contain" }}
      draggable={false}
    />
  );
}

export interface StoryOverlaysLayerProps {
  storyOverlays?: StoryOverlay[];
  animatedGifOverlays?: StoryAnimatedGifOverlay[];
  /** Viewer = true (WS-4 stickers tappable). Create preview = false. */
  interactive?: boolean;
  /** Internal navigation (solito router.push). Called for event/mention taps. */
  onNavigate?: (path: string) => void;
}

export function StoryOverlaysLayer({
  storyOverlays = [],
  animatedGifOverlays = [],
  interactive = false,
  onNavigate,
}: StoryOverlaysLayerProps) {
  if (storyOverlays.length === 0 && animatedGifOverlays.length === 0) {
    return null;
  }

  // Animated-GIF overlays are published as a SEPARATE array (the editor puts
  // gifs only there). Render them alongside storyOverlays, de-duped against any
  // `animated_gif`-typed entries already present in storyOverlays.
  const gifIds = new Set(
    storyOverlays
      .filter((o) => o.type === "animated_gif")
      .map((o) => o.id),
  );
  const extraGifs = animatedGifOverlays.filter((g) => !gifIds.has(g.id));

  return (
    <div
      aria-hidden={!interactive}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        containerType: "inline-size",
        pointerEvents: "none",
      }}
    >
      {storyOverlays.map((overlay) => {
        if (overlay.type === "animated_gif") {
          return (
            <div
              key={overlay.id}
              style={overlayCenterBox(
                overlay.x,
                overlay.y,
                overlay.sizeRatio,
                overlay.scale,
                overlay.rotation,
                overlay.opacity,
              )}
            >
              <GifOrImage url={overlay.url} />
            </div>
          );
        }

        if (overlay.type === "emoji") {
          return (
            <span
              key={overlay.id}
              style={{
                ...overlayCenterBox(
                  overlay.x,
                  overlay.y,
                  overlay.sizeRatio,
                  overlay.scale,
                  overlay.rotation,
                  overlay.opacity,
                ),
                fontSize: `${overlay.sizeRatio * overlay.scale * 100}cqw`,
                lineHeight: 1,
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {overlay.emoji}
            </span>
          );
        }

        if (overlay.type === "text") {
          const fontSize = `max(18px, ${overlay.fontSizeRatio * overlay.scale * 100}cqw)`;
          const target = interactive ? ws4OverlayTarget(overlay) : null;
          const inner = (
            <span
              style={{
                color: overlay.color,
                backgroundColor: overlay.backgroundColor || "transparent",
                fontSize,
                lineHeight: 1.14,
                fontWeight: 700,
                textAlign: overlay.textAlign || "center",
                fontFamily: overlay.fontFamily || undefined,
                display: "inline-block",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                borderRadius: overlay.stickerKind ? 999 : 0,
                padding: overlay.stickerKind ? "0.2em 0.6em" : 0,
              }}
            >
              {overlay.content}
            </span>
          );
          const boxStyle: React.CSSProperties = {
            position: "absolute",
            left: `${overlay.x * 100}%`,
            top: `calc(${overlay.y * 100}% - ${fontSize})`,
            width: `${overlay.maxWidthRatio * 100}%`,
            opacity: overlay.opacity ?? 1,
            transform: `translateX(-50%) rotate(${overlay.rotation}deg)`,
            textAlign: overlay.textAlign || "center",
          };
          if (target) {
            return (
              <button
                key={overlay.id}
                type="button"
                onClick={() => {
                  if (target.external) {
                    if (typeof window !== "undefined") {
                      window.open(target.href, "_blank", "noopener,noreferrer");
                    }
                  } else {
                    onNavigate?.(target.href);
                  }
                }}
                style={{
                  ...boxStyle,
                  pointerEvents: "auto",
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                }}
              >
                {inner}
              </button>
            );
          }
          return (
            <div key={overlay.id} style={boxStyle}>
              {inner}
            </div>
          );
        }

        // Image sticker.
        const url = resolveStickerWebUrl(overlay.assetId, overlay.url);
        if (!url) return null;
        return (
          <div
            key={overlay.id}
            style={overlayCenterBox(
              overlay.x,
              overlay.y,
              overlay.sizeRatio,
              overlay.scale,
              overlay.rotation,
              overlay.opacity,
            )}
          >
            <GifOrImage url={url} />
          </div>
        );
      })}

      {extraGifs.map((gif) => (
        <div
          key={gif.id}
          style={overlayCenterBox(
            gif.x,
            gif.y,
            gif.sizeRatio,
            gif.scale,
            gif.rotation,
          )}
        >
          <GifOrImage url={gif.url} />
        </div>
      ))}
    </div>
  );
}
