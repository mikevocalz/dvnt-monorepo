import { useEffect, useRef, useState } from "react";
import { useStoryViewerStore } from "@dvnt/app/lib/stores/story-viewer-store";
import { useLightboxStore } from "@dvnt/app/lib/stores/lightbox-store";
import { WebFeedPlayback, type PlaybackState } from "./web-video-playback";

export function useFeedVideo(
  source: string | undefined,
  { active = true, pauseForLightbox = true }: { active?: boolean; pauseForLightbox?: boolean } = {},
) {
  const lightboxOpen = useLightboxStore((s) => s.open);
  const enabled = active && (pauseForLightbox ? !lightboxOpen : lightboxOpen);
  const ref = useRef<HTMLVideoElement>(null);
  const controller = useRef<WebFeedPlayback | null>(null);
  const syncPlayback = useRef<(() => void) | null>(null);
  const activeRef = useRef(enabled);
  const [state, setState] = useState<PlaybackState>({ muted: true, blocked: false });
  // A half-visible neighbouring carousel slide must never autoplay. Keep its
  // controller/observer mounted while selection transfers to the next slide.
  useEffect(() => {
    activeRef.current = enabled;
    syncPlayback.current?.();
    // React runs all changed-effect cleanups before their setups. On a reverse
    // swipe this pauses the outgoing (later DOM) slide before the earlier slide
    // starts, rather than briefly playing both during the setup pass.
    return () => {
      activeRef.current = false;
      syncPlayback.current?.();
    };
  }, [enabled]);
  useEffect(() => {
    const video = ref.current;
    if (!source || !video) return;
    const playback = new WebFeedPlayback(video, setState);
    controller.current = playback;
    let visible = false;
    const sync = () => playback.setActive(
      activeRef.current && visible && !document.hidden &&
      !useStoryViewerStore.getState().open,
    );
    syncPlayback.current = sync;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      sync();
    }, { threshold: [0, 0.25] });
    observer.observe(video);
    document.addEventListener("visibilitychange", sync);
    const unsubscribe = useStoryViewerStore.subscribe(sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      unsubscribe();
      playback.dispose();
      controller.current = null;
      syncPlayback.current = null;
    };
  }, [source]);
  return { ref, ...state, toggleSound: () => controller.current?.toggleSound(), play: () => controller.current?.play() };
}
