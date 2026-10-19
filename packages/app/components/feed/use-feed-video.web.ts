import { useEffect, useRef, useState } from "react";
import { useStoryViewerStore } from "@dvnt/app/lib/stores/story-viewer-store";
import { WebFeedPlayback, type PlaybackState } from "./web-video-playback";

export function useFeedVideo(source: string | undefined) {
  const ref = useRef<HTMLVideoElement>(null);
  const controller = useRef<WebFeedPlayback | null>(null);
  const [state, setState] = useState<PlaybackState>({ muted: true, blocked: false });
  useEffect(() => {
    const video = ref.current;
    if (!source || !video) return;
    const playback = new WebFeedPlayback(video, setState);
    controller.current = playback;
    let visible = false;
    const sync = () => playback.setActive(visible && !document.hidden && !useStoryViewerStore.getState().open);
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
    };
  }, [source]);
  return { ref, ...state, toggleSound: () => controller.current?.toggleSound(), play: () => controller.current?.play() };
}
