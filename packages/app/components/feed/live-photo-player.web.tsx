"use client";

/**
 * Live Photo playback for web. The still shows with a LIVE badge, and the
 * paired clip plays muted on its own while the photo is at least 60% in view,
 * looping until it scrolls away, the slide is swiped away, the tab hides, or
 * the story viewer or lightbox covers it. Hover (mouse), press-and-hold (touch,
 * pen) and the badge (keyboard) still play it on demand. Reduced motion turns
 * autoplay and hover off; a deliberate hold or key press still plays.
 *
 * One Live Photo clip plays at a time on the page. Among the ones eligible to
 * autoplay, the one that most recently came into view wins, and when it leaves
 * the next eligible one starts.
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
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";
import { useStoryViewerStore } from "@dvnt/app/lib/stores/story-viewer-store";

/** A press shorter than this is a tap (open the post), not a hold. */
const HOLD_MS = 350;
/** Moving further than this before the hold fires means a scroll, not a hold. */
const HOLD_SLOP_PX = 8;
/** How much of the photo must be on screen before its clip autoplays. */
const AUTOPLAY_RATIO = 0.6;
/** Clips this close to the viewport start buffering; the rest of a long grid does not. */
const PRELOAD_MARGIN = "300px";
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

type Mode = "idle" | "auto" | "manual";
interface Player {
  mode: Mode;
  /** When this came into view (IntersectionObserver time); the newest eligible one autoplays. */
  enteredAt: number;
  element(): Element | null;
  eligible(): boolean;
  play(mode: "auto" | "manual"): void;
  halt(): void;
}

/** Every mounted Live Photo. */
const players = new Set<Player>();
/** The one clip playing (or starting) on the page. */
let current: Player | null = null;

/**
 * Later entry wins. Photos that entered in the same observer delivery tie, and
 * the delivery order is not document order, so the earlier one in the
 * document (top of the grid) wins the tie.
 */
function newer(a: Player, b: Player) {
  if (a.enteredAt !== b.enteredAt) return a.enteredAt > b.enteredAt;
  const ea = a.element();
  const eb = b.element();
  return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Hand autoplay to the newest eligible Live Photo. A manual play keeps the screen until it ends. */
function reconcile() {
  if (current?.mode === "manual") return;
  let best: Player | null = null;
  for (const player of players) {
    if (player.eligible() && (!best || newer(player, best))) best = player;
  }
  if (current && current !== best) current.halt();
  if (best && current !== best) best.play("auto");
}

export type LivePhotoController = ReturnType<typeof useLivePhoto>;

export function useLivePhoto(
  videoUrl: string | undefined,
  {
    active = true,
    pauseForLightbox = true,
    autoplay = true,
  }: { active?: boolean; pauseForLightbox?: boolean; autoplay?: boolean } = {},
) {
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
  /** Bumped by every play/halt; a play() promise from an older request is ignored. */
  const request = useRef(0);
  /** A half-visible neighbouring carousel slide must never start. */
  const activeRef = useRef(active);
  /** The mouse is over this Live Photo, so becoming the selected slide plays it. */
  const hovered = useRef(false);
  const inView = useRef(false);
  /** The browser refused an unprompted play(); wait for a gesture before autoplaying again. */
  const autoBlocked = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const failed = enabled && failedUrl === videoUrl;
  // Cells and slides that are not Live Photos never subscribe.
  const reducedMotion = useSyncExternalStore(
    enabled ? subscribeReducedMotion : subscribeNothing,
    enabled ? reducedMotionNow : notReduced,
    notReduced,
  );
  const settings = useRef({ enabled, failed, autoplay, pauseForLightbox, reducedMotion });

  /** Nothing else owns the screen: tab visible, slide selected, no story or (feed) lightbox. */
  const sessionAllows = useCallback(() => {
    const { enabled, failed, pauseForLightbox } = settings.current;
    if (!enabled || failed || !activeRef.current || document.hidden) return false;
    if (useStoryViewerStore.getState().open) return false;
    return !(pauseForLightbox && useLightboxStore.getState().open);
  }, []);

  const playerRef = useRef<Player | null>(null);
  if (!playerRef.current) {
    const player: Player = {
      mode: "idle",
      enteredAt: 0,
      element: () => surfaceRef.current,
      eligible: () => {
        const { autoplay, reducedMotion } = settings.current;
        return autoplay && !reducedMotion && !autoBlocked.current && inView.current && sessionAllows();
      },
      play: (mode) => {
        const video = videoRef.current;
        if (!video || !sessionAllows()) return;
        if (current && current !== player) current.halt();
        current = player;
        player.mode = mode;
        // Already playing or starting (autoplay, then a hover): keep going.
        if (wantsPlay.current) return;
        const token = ++request.current;
        wantsPlay.current = true;
        video.preload = "auto";
        video.currentTime = 0;
        video.play().then(() => {
          // Resolved after a newer halt/play: this clip is outgoing, keep it still.
          if (token !== request.current && !wantsPlay.current) video.pause();
        }, (error: unknown) => {
          // A newer play/halt owns the element now, and pause() before play()
          // settles rejects with AbortError: neither is a failure of this request.
          if (token !== request.current) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (player.mode === "auto") autoBlocked.current = true;
          wantsPlay.current = false;
          player.mode = "idle";
          if (current === player) current = null;
          setPlaying(false);
        });
      },
      halt: () => {
        request.current += 1;
        window.clearTimeout(holdTimer.current);
        holdTimer.current = undefined;
        wantsPlay.current = false;
        player.mode = "idle";
        if (current === player) current = null;
        const video = videoRef.current;
        if (video && !video.paused) video.pause();
        setPlaying(false);
      },
    };
    playerRef.current = player;
  }
  const player = playerRef.current;

  const prime = useCallback(() => {
    const video = videoRef.current;
    if (video && video.preload !== "auto") video.preload = "auto";
  }, []);

  /** Play on demand: hover, hold, badge. */
  const start = useCallback(() => {
    if (!sessionAllows()) return;
    autoBlocked.current = false;
    player.play("manual");
  }, [player, sessionAllows]);

  /** End an on-demand play. If this clip is still the one that should autoplay, it keeps looping. */
  const stop = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    if (player.mode !== "manual") return;
    player.mode = "auto";
    if (!player.eligible()) player.halt();
    reconcile();
  }, [player]);

  useEffect(() => {
    settings.current = { enabled, failed, autoplay, pauseForLightbox, reducedMotion };
    if (wantsPlay.current && !sessionAllows()) player.halt();
    if (wantsPlay.current && player.mode === "auto" && !player.eligible()) player.halt();
    reconcile();
  }, [enabled, failed, autoplay, pauseForLightbox, reducedMotion, player, sessionAllows]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      if (wantsPlay.current) player.halt();
      reconcile();
    } else if (hovered.current && !settings.current.reducedMotion) start();
    else reconcile();
    // Only a selection change re-evaluates; hover changes call start/stop directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Registration, viewport tracking, media events, session pauses, plus a
  // non-passive touchend: after a hold that played, cancelling the touchend
  // stops the browser from synthesising the click, so letting go neither
  // follows the post link nor opens the lightbox.
  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    const surface = surfaceRef.current;
    players.add(player);
    const onPlaying = () => {
      if (!wantsPlay.current) video?.pause();
      setPlaying(wantsPlay.current);
      if (wantsPlay.current && holding.current) playedThisHold.current = true;
    };
    // Loops while it stays eligible; a hold or hover that outlasts the clip replays it.
    const onEnded = () => {
      const next = player.eligible() ? "auto" : holding.current || hovered.current ? "manual" : null;
      if (next && sessionAllows()) {
        wantsPlay.current = false;
        player.play(next);
      } else {
        player.halt();
        reconcile();
      }
    };
    const onError = () => {
      setFailedUrl(videoUrl);
      player.halt();
      reconcile();
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
    const onSession = () => {
      if (wantsPlay.current && !sessionAllows()) player.halt();
      reconcile();
    };
    document.addEventListener("visibilitychange", onSession);
    const unsubscribeStory = useStoryViewerStore.subscribe(onSession);
    const unsubscribeLightbox = pauseForLightbox ? useLightboxStore.subscribe(onSession) : noop;
    let viewObserver: IntersectionObserver | undefined;
    let nearObserver: IntersectionObserver | undefined;
    if (surface && typeof IntersectionObserver !== "undefined") {
      viewObserver = new IntersectionObserver(([entry]) => {
        const visible = !!entry && entry.isIntersecting && entry.intersectionRatio >= AUTOPLAY_RATIO;
        if (visible === inView.current) return;
        inView.current = visible;
        if (visible) player.enteredAt = entry.time ?? performance.now();
        else if (wantsPlay.current && player.mode === "auto") player.halt();
        reconcile();
      }, { threshold: [0, AUTOPLAY_RATIO] });
      viewObserver.observe(surface);
      nearObserver = new IntersectionObserver(([entry]) => {
        if (entry?.isIntersecting) {
          prime();
          nearObserver?.disconnect();
        }
      }, { rootMargin: PRELOAD_MARGIN });
      nearObserver.observe(surface);
    }
    return () => {
      viewObserver?.disconnect();
      nearObserver?.disconnect();
      players.delete(player);
      inView.current = false;
      document.removeEventListener("visibilitychange", onSession);
      unsubscribeStory();
      unsubscribeLightbox();
      // Unmount or a replaced clip: never leave the outgoing element running.
      // On unmount React has already cleared videoRef, so pause the captured one.
      player.halt();
      if (video && !video.paused) video.pause();
      video?.removeEventListener("playing", onPlaying);
      video?.removeEventListener("ended", onEnded);
      video?.removeEventListener("error", onError);
      surface?.removeEventListener("touchend", onTouchEnd);
      window.clearTimeout(holdTimer.current);
      reconcile();
    };
  }, [enabled, videoUrl, pauseForLightbox, player, prime, sessionAllows]);

  const cancelHold = () => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    holdOrigin.current = null;
  };

  /** Mouse hover. Spread on an element that encloses the media and the badge. */
  const containerProps = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      hovered.current = true;
      prime();
      if (!reducedMotion) start();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      hovered.current = false;
      stop();
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
        // Holding a clip that is already autoplaying is still a hold that played.
        const alreadyPlaying = wantsPlay.current && !!videoRef.current && !videoRef.current.paused;
        start();
        if (alreadyPlaying && wantsPlay.current) playedThisHold.current = true;
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
    // A scroll or carousel swipe takes the pointer: end the hold, never start mid-pan.
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

  const isManual = () => player.mode === "manual";
  return { videoUrl, videoRef, surfaceRef, containerProps, surfaceProps, playing, failed, prime, start, stop, isManual };
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
          data-live-photo-motion
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
        if (live.isManual()) live.stop();
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
