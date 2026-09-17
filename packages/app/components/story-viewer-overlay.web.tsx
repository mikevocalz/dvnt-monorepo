"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "solito/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, SendHorizontal, Trash2, X } from "lucide-react";
import { StoryViewer } from "@dvnt/ui";
import { useStoryViewerStore } from "@dvnt/app/lib/stores/story-viewer-store";
import { StoryOverlaysLayer } from "@dvnt/app/components/story-overlays-layer.web";
import { StoryViewersSheetWeb } from "@dvnt/app/components/story-viewers-sheet.web";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useDeleteStory } from "@dvnt/app/lib/hooks/use-stories";
import {
  STORY_REACTION_EMOJIS,
  sendStoryMessage,
} from "@dvnt/app/lib/stories/story-message";
import { isSameUser } from "@dvnt/app/lib/profile/same-user";
import { storyProfilePath } from "@dvnt/app/lib/profile/story-profile-path";

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
  const router = useRouter();
  const open = useStoryViewerStore((s) => s.open);
  const groups = useStoryViewerStore((s) => s.groups);
  const groupIndex = useStoryViewerStore((s) => s.groupIndex);
  const close = useStoryViewerStore((s) => s.close);
  const closeForNavigation = useStoryViewerStore((s) => s.closeForNavigation);
  const viewer = useAuthStore((s) => s.user);
  const nextGroup = useStoryViewerStore((s) => s.nextGroup);

  // Portal target only exists on the client; gate the portal until mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Which segment inside the current group is playing — drives which item's
  // overlays are shown. react-insta-stories fires onStoryChange (onStoryStart)
  // on every segment start; reset to 0 whenever the group changes (the viewer
  // remounts per group via key={group.id}).
  const [storyIndex, setStoryIndex] = useState(0);
  useEffect(() => setStoryIndex(0), [groupIndex]);

  // Deleting your own story existed on native and nowhere on web: the web
  // overlay had a close button and nothing else, so a member could post a story
  // here and never take it down. Same mutation native uses, so the rail drops
  // it optimistically and the list refetches behind that.
  const deleteStory = useDeleteStory();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setConfirmingDelete(false), [groupIndex]);

  // Replying and reacting — the half of stories web never had. Both are DMs
  // carrying story context; the shaping lives in lib/stories/story-message so
  // the two platforms send the same thing.
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  // Reactions land as a floating emoji so the send is visible without a toast
  // interrupting the story.
  const [floatingEmojis, setFloatingEmojis] = useState<
    Array<{ id: number; emoji: string }>
  >([]);
  const emojiCounter = useRef(0);
  const lastReactionAt = useRef(0);
  useEffect(() => {
    setReplyText("");
    setComposerFocused(false);
    setShowViewers(false);
  }, [groupIndex]);

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
  const segment =
    group.segments[Math.min(storyIndex, group.segments.length - 1)];
  // By id only. isSameUser deliberately refuses a username fallback, and this
  // is an ownership check that hands out a Delete button.
  const isOwnStory = isSameUser(viewer, { userId: group.userId });
  const removeStory = () => {
    deleteStory.mutate(group.id, {
      // The group is gone from the rail either way; leaving the viewer on a
      // deleted story is the one thing that must not happen.
      onSettled: () => {
        setConfirmingDelete(false);
        if (groups.length > 1) nextGroup();
        else close();
      },
    });
  };

  // The story context the DM carries. Segments are the items, in order.
  const storyContext = {
    id: group.id,
    username: group.username,
    avatar: group.avatar,
    items: group.segments.map((s) => ({ type: s.type, url: s.url })),
  };
  const canMessageOwner = !isOwnStory && !!group.userId;

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text || sendingReply || !group.userId) return;
    setSendingReply(true);
    try {
      await sendStoryMessage({
        queryClient,
        recipientUserId: group.userId,
        story: storyContext,
        itemIndex: storyIndex,
        kind: "story_reply",
        content: text,
      });
      setReplyText("");
      showToast("success", "Sent", `Reply sent to @${group.username}`);
    } catch (e: unknown) {
      showToast(
        "error",
        "Reply didn't send",
        e instanceof Error ? e.message : "Try again in a moment.",
      );
    } finally {
      setSendingReply(false);
      setComposerFocused(false);
    }
  };

  const sendReaction = (emoji: string) => {
    if (!group.userId) return;
    // Same 1.5s throttle native uses — the row is tappable faster than anyone
    // means to send five DMs.
    const now = Date.now();
    const id = emojiCounter.current++;
    setFloatingEmojis((prev) => [...prev, { id, emoji }]);
    window.setTimeout(
      () => setFloatingEmojis((prev) => prev.filter((f) => f.id !== id)),
      1400,
    );
    if (now - lastReactionAt.current < 1500) return;
    lastReactionAt.current = now;
    void sendStoryMessage({
      queryClient,
      recipientUserId: group.userId,
      story: storyContext,
      itemIndex: storyIndex,
      kind: "story_reaction",
      content: emoji,
    }).catch(() => {
      showToast("error", "Reaction didn't send", "Try again in a moment.");
    });
  };

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

      {/* Owner-only delete. Two taps, not a browser confirm() — a modal dialog
          over a playing story is worse than a button that asks once. */}
      {isOwnStory ? (
        <button
          onClick={() => (confirmingDelete ? removeStory() : setConfirmingDelete(true))}
          disabled={deleteStory.isPending}
          aria-label={confirmingDelete ? "Confirm delete story" : "Delete story"}
          className="absolute right-16 z-10 h-9 rounded-xl flex items-center justify-center gap-2 px-3 active:scale-95 border border-white/20 disabled:opacity-50"
          style={{
            top: "calc(env(safe-area-inset-top) + 14px)",
            background: confirmingDelete
              ? "rgba(244,63,94,0.85)"
              : "rgba(255,255,255,0.12)",
            backdropFilter: "saturate(160%) blur(18px)",
            WebkitBackdropFilter: "saturate(160%) blur(18px)",
          }}
        >
          <Trash2 size={18} color="#fff" />
          {confirmingDelete || deleteStory.isPending ? (
            <span className="text-[13px] font-semibold text-white">
              {deleteStory.isPending ? "Deleting…" : "Delete story"}
            </span>
          ) : null}
        </button>
      ) : null}

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
          onStoryChange={setStoryIndex}
          onProfilePress={() => {
            const path = storyProfilePath(group, viewer, "web");
            if (!path) return;
            closeForNavigation();
            router.push(path);
          }}
          width={size.w}
          height={size.h}
          paused={composerFocused || showViewers || confirmingDelete}
        />

        {/* Story overlays for the current segment — the SAME shared renderer the
            create preview uses. WS-4 stickers are tappable here (deep-link per
            their metadata); tapping closes the viewer and navigates. */}
        {segment ? (
          <StoryOverlaysLayer
            storyOverlays={segment.storyOverlays}
            animatedGifOverlays={segment.animatedGifOverlays}
            interactive
            onNavigate={(path) => {
              closeForNavigation();
              router.push(path);
            }}
          />
        ) : null}

        {/* Reactions in flight — the receipt for a tap, without a toast over
            the story. */}
        {floatingEmojis.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center">
            <style>{`
              @keyframes dvnt-story-float {
                0%   { opacity: 0; transform: translateY(0) scale(0.6); }
                20%  { opacity: 1; transform: translateY(-16px) scale(1.15); }
                100% { opacity: 0; transform: translateY(-140px) scale(1); }
              }
              @media (prefers-reduced-motion: reduce) {
                .dvnt-story-emoji { animation-duration: 0.01ms !important; }
              }
            `}</style>
            {floatingEmojis.map((f, i) => (
              <span
                key={f.id}
                className="dvnt-story-emoji absolute text-4xl"
                style={{
                  animation: "dvnt-story-float 1.4s ease-out forwards",
                  marginLeft: (i % 3) * 28 - 28,
                }}
              >
                {f.emoji}
              </span>
            ))}
          </div>
        ) : null}

        {/* Own story → who saw it. Someone else's → react or reply. Native has
            had both; web had neither. */}
        {isOwnStory ? (
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-5">
            <button
              onClick={() => setShowViewers(true)}
              className="flex items-center gap-2 rounded-2xl border border-white/15 bg-black/45 px-4 py-2.5 backdrop-blur-md"
              aria-label="See who viewed this story"
            >
              <Eye size={16} color="#fff" />
              <span className="text-[13px] font-semibold text-white">
                Viewers
              </span>
            </button>
          </div>
        ) : canMessageOwner ? (
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 px-4 pb-5">
            {!composerFocused ? (
              <div className="flex justify-center gap-2">
                {STORY_REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => sendReaction(emoji)}
                    aria-label={`React ${emoji}`}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-[22px] backdrop-blur-md transition-transform active:scale-90 hover:scale-110"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendReply();
              }}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-4 py-2 backdrop-blur-md"
            >
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                placeholder={`Reply to @${group.username}…`}
                aria-label={`Reply to ${group.username}`}
                maxLength={1000}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-white placeholder:text-white/45 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!replyText.trim() || sendingReply}
                aria-label="Send reply"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 disabled:opacity-40"
              >
                <SendHorizontal size={17} color="#fff" />
              </button>
            </form>
          </div>
        ) : null}

        <StoryViewersSheetWeb
          storyId={group.id}
          open={showViewers}
          onClose={() => setShowViewers(false)}
          onProfilePress={(username) => {
            closeForNavigation();
            router.push(`/feed/${username}`);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
