"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useStories } from "@dvnt/app/lib/hooks/use-stories";
import {
  useStoryViewerStore,
  type StoryViewerGroup,
} from "@dvnt/app/lib/stores/story-viewer-store";
import { StoryViewerOverlay } from "@dvnt/app/components/story-viewer-overlay.web";

// Same flatten as the feed StoriesRow: keep playable image/video segments.
function toViewerGroup(s: any): StoryViewerGroup {
  const segments = (s.items ?? [])
    .filter((it: any) => typeof it.url === "string" && it.url)
    .map((it: any) => ({
      type: (it.type === "video" ? "video" : "image") as "image" | "video",
      url: it.url as string,
      duration: it.duration as number | undefined,
    }));
  return { id: String(s.id ?? s.username), username: s.username, avatar: s.avatar, segments };
}

/**
 * Direct-link story route (web) — /feed/story/[id]. Opens the SAME full-screen
 * story overlay used from the feed StoriesRow, starting at the requested story
 * group, and continues through the rest. Falls back to /feed when the story
 * isn't in the loaded set. The overlay itself owns close + nav.
 */
export function StoryRouteScreen() {
  const params = useParams();
  const router = useRouter();
  const { data: stories } = useStories();
  const open = useStoryViewerStore((s) => s.open);
  const openAt = useStoryViewerStore((s) => s.openAt);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = String((params as any)?.id ?? "");
  // transient render flag: did we actually open the viewer yet?
  const openedRef = useRef(false);

  useEffect(() => {
    if (!stories || !id) return;
    const groups = (stories as any[])
      .filter((s) => !s.isYou)
      .map(toViewerGroup)
      .filter((g) => g.segments.length > 0);
    const idx = groups.findIndex((g) => g.id === id);
    if (idx >= 0) {
      openedRef.current = true;
      openAt(groups, idx);
    } else {
      router.replace("/feed"); // unknown / expired story
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories, id]);

  // Only after we opened it: when the overlay closes (open→false), go to feed.
  useEffect(() => {
    if (openedRef.current && !open) router.replace("/feed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="min-h-[100dvh] bg-black">
      <StoryViewerOverlay />
    </div>
  );
}
