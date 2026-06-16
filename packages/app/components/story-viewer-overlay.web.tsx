"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { StoryViewer } from "@dvnt/ui";
import { useStoryViewerStore } from "@dvnt/app/lib/stores/story-viewer-store";

/**
 * Full-screen story viewer overlay (web) — pops over the ENTIRE app at the top
 * z-layer (above header z-100 / tab bar z-1000 / lightbox z-2000 → here z-2100),
 * with a close button. Plays the selected user's segments (react-insta-stories
 * via the `StoryViewer` kit) and advances to the next user on completion. Mount
 * once per app shell; reads the shared `story-viewer-store`.
 *
 * The story media renders inside a centered PORTRAIT (9:16) frame — stories are
 * shot portrait, so filling the full landscape viewport with object-fit:cover
 * would crop them hard. The frame is letterboxed on the black backdrop on wide
 * screens and fills the width on phones.
 */
export function StoryViewerOverlay() {
  const open = useStoryViewerStore((s) => s.open);
  const groups = useStoryViewerStore((s) => s.groups);
  const groupIndex = useStoryViewerStore((s) => s.groupIndex);
  const close = useStoryViewerStore((s) => s.close);
  const nextGroup = useStoryViewerStore((s) => s.nextGroup);

  // Portal target only exists on the client; gate the portal until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // react-insta-stories positions its internal layers using the width/height
  // props as PIXEL values — passing "100%" breaks its layout math so segments
  // letterbox and preloaded ones bleed through. Feed it the real PORTRAIT frame
  // pixels: full viewport height, 9:16 width, clamped to the viewport width.
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let h = vh;
      let w = Math.round((h * 9) / 16);
      if (w > vw) {
        w = vw;
        h = Math.round((w * 16) / 9);
      }
      setSize({ w, h });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // While the story is open, silence/hide every OTHER video on the page (feed
    // posts keep autoplaying underneath and otherwise bleed through as a
    // "cut-out" over the story — only visible for video stories). Pause them and
    // hide them, then restore on close.
    const others = Array.from(
      document.querySelectorAll<HTMLVideoElement>("video"),
    ).filter((v) => !v.closest(".dvnt-story-viewer"));
    const restore = others.map((v) => {
      const prevVisibility = v.style.visibility;
      const wasPlaying = !v.paused;
      try {
        v.pause();
      } catch {
        // ignore
      }
      v.style.visibility = "hidden";
      return { v, prevVisibility, wasPlaying };
    });

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restore.forEach(({ v, prevVisibility, wasPlaying }) => {
        v.style.visibility = prevVisibility;
        if (wasPlaying) v.play().catch(() => {});
      });
    };
  }, [open, close]);

  if (!mounted || !open || groups.length === 0 || size.w === 0) return null;
  const group = groups[Math.min(groupIndex, groups.length - 1)];
  if (!group || group.segments.length === 0) return null;

  // Portal to <body> so the overlay escapes every ancestor stacking context
  // (the shell's backdrop-filter / transforms) and truly sits on top of the
  // whole app — above header (z-100), tab bar (z-1000) and lightbox (z-2000).
  return createPortal(
    <div className="fixed inset-0 z-2100 bg-black flex items-center justify-center">
      <button
        onClick={close}
        aria-label="Close story"
        className="absolute right-4 z-10 w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 border border-white/20"
        style={{
          top: "calc(env(safe-area-inset-top) + 14px)",
          background: "rgba(255,255,255,0.12)",
          backdropFilter: "saturate(160%) blur(18px)",
          WebkitBackdropFilter: "saturate(160%) blur(18px)",
        }}
      >
        <X size={18} color="#fff" />
      </button>

      {/* Centered portrait frame — letterboxed on the black backdrop. */}
      <div
        style={{
          width: size.w,
          height: size.h,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <StoryViewer
          key={group.id}
          stories={group.segments.map((seg) => ({
            url: seg.url,
            type: seg.type,
            duration: seg.duration,
            header: { heading: group.username, profileImage: group.avatar },
          }))}
          onAllStoriesEnd={nextGroup}
          width={size.w}
          height={size.h}
        />
      </div>
    </div>,
    document.body,
  );
}
