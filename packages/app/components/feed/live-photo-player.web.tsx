"use client";

/**
 * Live Photo playback for web, matching iOS: the still shows with a LIVE
 * badge; hovering (mouse) or pressing and holding (touch) plays the paired clip
 * muted from the start, and letting go returns to the still.
 *
 * Why not Apple's LivePhotosKit JS: it downloads `videoSrc` with an
 * XMLHttpRequest (arraybuffer) to parse the QuickTime metadata, so the clip
 * needs CORS. dvnt.b-cdn.net sends `Access-Control-Allow-Origin` on images but
 * not on `.mov` responses, and LivePhotosKit fails post 689 with
 * VIDEO_FAILED_TO_LOAD in Chrome. A plain <video> needs no CORS to play.
 *
 * Usage keeps the controls out of links (see no-control-inside-link.test.ts):
 *   const live = useLivePhoto(videoUrl);
 *   <div {...live.containerProps}>   // mouse hover; wraps media + badge
 *     <CardLink><LivePhotoMedia live={live}><img …/></LivePhotoMedia></CardLink>
 *     <LivePhotoBadge live={live} className="absolute top-2 left-2" />
 *   </div>
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** A press shorter than this is a tap (open the post), not a hold. */
const HOLD_MS = 350;
/** Moving further than this before the hold fires means a scroll, not a hold. */
const HOLD_SLOP_PX = 8;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const noop = () => {};
const subscribeNothing = () => noop;
const notReduced = () => false;

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedMotionNow = () => window.matchMedia(REDUCED_MOTION).matches;

export type LivePhotoController = ReturnType<typeof useLivePhoto>;

export function useLivePhoto(videoUrl: string | undefined, { active = true }: { active?: boolean } = {}) {
  const enabled = !!videoUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const holdOrigin = useRef<{ x: number; y: number } | null>(null);
  /** A hold fired and has not been released yet. */
  const holding = useRef(false);
  /** The clip actually played during this hold, so the release must not click. */
  const playedThisHold = useRef(false);
  /** The next click on the surface belongs to a hold release: swallow it. */
  const suppressClick = useRef(false);
  const wantsPlay = useRef(false);
  /** Bumped by every start/stop; a play() promise from an older request is ignored. */
  const request = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const failed = enabled && failedUrl === videoUrl;
  // Hover is incidental, so reduced motion turns it off. A deliberate hold or
  // a key press on the badge still plays, as it does on iOS. Cells and slides
  // that are not Live Photos never subscribe.
  const reducedMotion = useSyncExternalStore(
    enabled ? subscribeReducedMotion : subscribeNothing,
    enabled ? reducedMotionNow : notReduced,
    notReduced,
  );

  const prime = useCallback(() => {
    const video = videoRef.current;
    if (video && video.preload !== "auto") video.preload = "auto";
  }, []);

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    const token = ++request.current;
    wantsPlay.current = true;
    video.preload = "auto";
    video.currentTime = 0;
    video.play().catch((error: unknown) => {
      // A newer start/stop owns the element now, and pause() before play()
      // settles rejects with AbortError: neither is a failure of this request.
      if (token !== request.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      wantsPlay.current = false;
      setPlaying(false);
    });
  }, [failed]);

  const stop = useCallback(() => {
    request.current += 1;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    wantsPlay.current = false;
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);

  // Media events, plus a non-passive touchend: after a hold that played,
  // cancelling the touchend stops the browser from synthesising the click, so
  // letting go neither follows the post link nor opens the lightbox.
  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    const surface = surfaceRef.current;
    const onPlaying = () => {
      setPlaying(wantsPlay.current);
      if (wantsPlay.current && holding.current) playedThisHold.current = true;
    };
    const onEnded = () => stop();
    const onError = () => {
      setFailedUrl(videoUrl);
      stop();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      if (e.cancelable) e.preventDefault();
    };
    video?.addEventListener("playing", onPlaying);
    video?.addEventListener("ended", onEnded);
    video?.addEventListener("error", onError);
    surface?.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      video?.removeEventListener("playing", onPlaying);
      video?.removeEventListener("ended", onEnded);
      video?.removeEventListener("error", onError);
      surface?.removeEventListener("touchend", onTouchEnd);
      window.clearTimeout(holdTimer.current);
    };
  }, [enabled, videoUrl, stop]);

  const cancelHold = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    holdOrigin.current = null;
  };

  /** Mouse hover. Spread on an element that encloses the media and the badge. */
  const containerProps = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      prime();
      if (!reducedMotion) start();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") stop();
    },
  };

  /** Touch and pen press-and-hold. Applied to the media only by LivePhotoMedia. */
  const surfaceProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      prime();
      cancelHold();
      holding.current = false;
      playedThisHold.current = false;
      suppressClick.current = false;
      holdOrigin.current = { x: e.clientX, y: e.clientY };
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = undefined;
        holding.current = true;
        start();
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const origin = holdOrigin.current;
      if (!origin || holdTimer.current === undefined) return;
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > HOLD_SLOP_PX) cancelHold();
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      cancelHold();
      if (!holding.current) return;
      holding.current = false;
      suppressClick.current = playedThisHold.current;
      playedThisHold.current = false;
      stop();
    },
    // A scroll or carousel swipe takes the pointer: stop, never play mid-pan.
    onPointerCancel: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      cancelHold();
      holding.current = false;
      playedThisHold.current = false;
      suppressClick.current = false;
      stop();
    },
    // Pens get no touchend to cancel, so their release click is dropped here.
    onClickCapture: (e: React.MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    // Long press would otherwise raise the image/link context menu.
    onContextMenu: (e: React.MouseEvent) => {
      if (holdTimer.current !== undefined || holding.current) e.preventDefault();
    },
  };

  return { videoUrl, videoRef, surfaceRef, containerProps, surfaceProps, playing, failed, prime, start, stop };
}

/** The still (passed as children) with the clip laid over it, same fit. */
export function LivePhotoMedia({
  live,
  fit = "cover",
  children,
}: {
  live: LivePhotoController;
  fit?: "cover" | "contain";
  children: React.ReactNode;
}) {
  return (
    <div
      ref={live.surfaceRef}
      {...live.surfaceProps}
      data-live-photo
      data-playing={live.playing || undefined}
      className="relative select-none [-webkit-touch-callout:none]"
    >
      {children}
      {live.videoUrl && !live.failed ? (
        <video
          ref={live.videoRef}
          src={live.videoUrl}
          muted
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden
          tabIndex={-1}
          className={`absolute inset-0 h-full w-full pointer-events-none transition-opacity duration-200 motion-reduce:transition-none ${
            fit === "cover" ? "object-cover" : "object-contain"
          } ${live.playing ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
    </div>
  );
}

/**
 * The LIVE badge. It is the keyboard control: focus it, then hold Enter or
 * Space to play. A click or tap plays the clip through once.
 */
export function LivePhotoBadge({ live, className = "" }: { live: LivePhotoController; className?: string }) {
  if (!live.videoUrl || live.failed) return null;
  const isPlayKey = (e: React.KeyboardEvent) => e.key === "Enter" || e.key === " ";
  return (
    <button
      type="button"
      aria-label="Live Photo"
      title="Live Photo: hover, or press and hold, to play"
      onFocus={live.prime}
      onBlur={live.stop}
      onKeyDown={(e) => {
        if (!isPlayKey(e)) return;
        e.preventDefault();
        if (!e.repeat) live.start();
      }}
      onKeyUp={(e) => {
        if (!isPlayKey(e)) return;
        e.preventDefault();
        live.stop();
      }}
      onClick={(e) => {
        e.stopPropagation();
        // Keyboard activation (detail 0) is handled by the key handlers.
        if (e.detail === 0) return;
        if (live.playing) live.stop();
        else live.start();
      }}
      className={`group/live flex min-h-11 min-w-11 items-start justify-start p-1.5 rounded-full focus-visible:outline-none ${className}`}
    >
      <span
        className={`flex h-6 items-center gap-1 rounded-full pl-1.5 pr-2 text-[11px] font-semibold leading-none text-white backdrop-blur-md transition-colors group-focus-visible/live:outline-2 group-focus-visible/live:outline-[#3FDCFF] ${
          live.playing ? "bg-black/25" : "bg-black/45"
        }`}
      >
        <LiveGlyph />
        LIVE
      </span>
    </button>
  );
}

function LiveGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.1" strokeDasharray="0.9 1.35" />
      <circle cx="7" cy="7" r="3.9" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="1.8" fill="currentColor" />
    </svg>
  );
}
