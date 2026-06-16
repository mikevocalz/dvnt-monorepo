"use client";

import Stories from "react-insta-stories";
import type { Story } from "react-insta-stories/dist/interfaces";

export interface StoryItem {
  /** Media URL (image or video). */
  url: string;
  /** Explicit type — inferred from extension when omitted. */
  type?: "image" | "video";
  /** Per-story duration in ms (images). Default 5000. */
  duration?: number;
  /** Optional header (avatar + handle + time) rendered over the story. */
  header?: { heading: string; subheading?: string; profileImage?: string };
}

export interface StoryViewerProps {
  /** Ordered stories to play. */
  stories: StoryItem[];
  /** Start index. Default 0. */
  currentIndex?: number;
  /** Fires after the last story finishes (close / advance to next user). */
  onAllStoriesEnd?: () => void;
  /** Fires on each story change with the new index. */
  onStoryChange?: (index: number) => void;
  /** Viewport width / height (px or %). Defaults fill the container. */
  width?: number | string;
  height?: number | string;
  /** Loop back to the first story instead of ending. Default false. */
  loop?: boolean;
}

const VIDEO_RE = /\.(mp4|mov|webm|m3u8)(\?|$)/i;

/**
 * Custom story header — overrides react-insta-stories' default CIRCULAR avatar
 * with a DVNT rounded-square (rule: avatars are never circular; rounded-md on
 * small, rounded-lg larger).
 */
function StoryHeader(h: { heading?: string; subheading?: string; profileImage?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 12px" }}>
      {h.profileImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={h.profileImage}
          alt=""
          width={36}
          height={36}
          className="rounded-md md:rounded-lg"
          style={{
            width: 36,
            height: 36,
            objectFit: "cover",
            background: "rgba(255,255,255,0.12)",
            border: "2px solid #fff",
          }}
        />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>
          {h.heading}
        </span>
        {h.subheading ? (
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>
            {h.subheading}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Instagram-style story viewer (web) via `react-insta-stories` — the React
 * equivalent of the native story screen. Segmented progress bars, tap/keyboard
 * nav, image+video, optional per-story header. Native sibling delegates to the
 * native StoryScreen.
 */
export function StoryViewer({
  stories,
  currentIndex = 0,
  onAllStoriesEnd,
  onStoryChange,
  width = "100%",
  height = "100%",
  loop = false,
}: StoryViewerProps) {
  const mapped: Story[] = stories.map((s) => ({
    url: s.url,
    type: s.type ?? (VIDEO_RE.test(s.url) ? "video" : "image"),
    ...(s.duration ? { duration: s.duration } : {}),
    ...(s.header
      ? {
          header: {
            heading: s.header.heading,
            subheading: s.header.subheading ?? "",
            profileImage: s.header.profileImage ?? "",
          },
        }
      : {}),
  }));

  return (
    <div className="dvnt-story-viewer" style={{ width, height, position: "relative" }}>
      {/* The video renderer wraps <video> in a flex div with NO width/height, so
          the video's height:100% collapses (images skip this wrapper, which is
          why only video left a cutout). Force that wrapper + the video to fill
          and cover. :has() is supported in all current browsers. */}
      <style>{`
        .dvnt-story-viewer > div { width: 100%; height: 100%; }
        /* The video sits under several wrapper divs (videoContainer →
           withSeeMore → withHeader), NONE of which set a height — so the
           video's height:100% collapses. Size the WHOLE ancestor chain by
           matching any div that contains a <video> at any depth. */
        .dvnt-story-viewer div:has(video) { width: 100% !important; height: 100% !important; }
        .dvnt-story-viewer video { width: 100% !important; height: 100% !important; object-fit: cover !important; }
      `}</style>
      <Stories
        stories={mapped}
        width={width}
        height={height}
        defaultInterval={5000}
        currentIndex={currentIndex}
        loop={loop}
        keyboardNavigation
        header={(h: { heading?: string; subheading?: string; profileImage?: string }) => StoryHeader(h)}
        onAllStoriesEnd={() => onAllStoriesEnd?.()}
        onStoryStart={(i: number) => onStoryChange?.(i)}
        storyContainerStyles={{ background: "#000", borderRadius: 0 }}
        // Force BOTH image and video to fill the viewport (cover) — the library
        // default is width:"auto" which renders media at intrinsic size, leaving
        // a black "cutout". Cover = Instagram-style full-bleed, no gap.
        storyStyles={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
