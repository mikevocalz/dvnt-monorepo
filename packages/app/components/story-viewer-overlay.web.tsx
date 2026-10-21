"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "solito/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  SendHorizontal,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { storiesApi, storyTagsApi } from "@dvnt/app/lib/api/stories";
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
import { StorySharedSourceCard, StorySharedSourceContent } from "./story-shared-source.web";
import { useSharedStoryPlayback } from "../lib/hooks/use-shared-story-playback";
import { SHARED_STORY_BACKDROP } from "../lib/stories/shared-source";

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
/**
 * react-insta-stories renders its own tap/hold overlay at zIndex 99999 — every
 * control we put over the story has to clear that or it is decoration: the
 * click lands on the player's "next" zone instead. The reply field could not be
 * focused at all, and tapping it advanced the story.
 */
const STORY_UI_Z = 100000;

export function StoryViewerOverlay() {
  const router = useRouter();
  const open = useStoryViewerStore((s) => s.open);
  const groups = useStoryViewerStore((s) => s.groups);
  const groupIndex = useStoryViewerStore((s) => s.groupIndex);
  const viewSession = useStoryViewerStore((s) => s.viewSession);
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
  const [selection, setSelection] = useState({ viewSession, groupIndex, index: 0 });
  const storyIndex = selection.viewSession === viewSession && selection.groupIndex === groupIndex ? selection.index : 0;
  const segmentEpoch = useRef(0);
  const activeSegmentEpoch = segmentEpoch.current;
  const changeStoryIndex = (index: number) => {
    if (index === storyIndex) return;
    // Invalidate queued sends synchronously, before React commits the new frame.
    segmentEpoch.current++;
    setSelection({ viewSession, groupIndex, index });
  };

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
  const [showTags, setShowTags] = useState(false);
  // Browsers only autoplay muted video, so a story with sound opens silent and
  // says so. Native starts unmuted because it can.
  const [muted, setMuted] = useState(true);
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setReplyText("");
    setSendingReply(false);
    setComposerFocused(false);
    setShowViewers(false);
    setShowTags(false);
    setFloatingEmojis([]);
  }, [viewSession, groupIndex, storyIndex, viewer?.id, viewer?.authId]);

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
        // Feed players resume only through their visibility/background policy.
        if (wasPlaying && !v.hasAttribute("data-feed-motion")) v.play().catch(() => {});
      });
    };
  }, [open, close]);

  // Everything below runs on EVERY render, before any early return. The tags
  // query used to sit under them, so a closed overlay ran one fewer hook than
  // an open one — React counts hooks per render, and reopening a story after a
  // close is exactly when it noticed.
  const activeGroup =
    groups.length > 0
      ? groups[Math.min(groupIndex, groups.length - 1)]
      : undefined;
  const rawSegment = activeGroup?.segments[Math.min(storyIndex, activeGroup.segments.length - 1)];
  const playback = useSharedStoryPlayback(rawSegment, open, `${viewSession}:${groupIndex}:${storyIndex}`);
  const segment = playback.segment;
  const playbackReady = playback.status === "ready";
  const activeStoryId = rawSegment?.sharedSource ? rawSegment.id : activeGroup?.id;

  // Tagged people — native shows a pill over the story; web showed nothing, so
  // being tagged was invisible to everyone but the poster.
  const { data: storyTags = [] } = useQuery({
    queryKey: ["story-tags", activeStoryId ?? ""],
    queryFn: () => storyTagsApi.getTagsForStory(activeStoryId ?? ""),
    enabled: open && playbackReady && !!activeStoryId,
    staleTime: 60_000,
  });

  /**
   * A fresh `stories` array on every render makes react-insta-stories reset the
   * segment it is playing. Before the composer existed this component barely
   * re-rendered; now a keystroke, a floating emoji and the tags query all
   * re-render it — so the story restarted under the reply box while you typed.
   * The identity has to be stable.
   */
  const storyItems = useMemo(
    () =>
      (activeGroup?.segments ?? []).map((seg, index) => ({
        // Never let the player prefetch a cached shared URL before its own
        // activation has passed a fresh source-visibility check.
        url: seg.sharedSource ? (index === storyIndex && segment ? segment.url : SHARED_STORY_BACKDROP) : seg.url,
        type: seg.sharedSource ? (index === storyIndex && segment ? segment.type : "image" as const) : seg.type,
        duration: seg.duration,
        header: {
          heading: activeGroup?.username ?? "",
          profileImage: activeGroup?.avatar ?? "",
        },
      })),
    [activeGroup, storyIndex, segment],
  );

  if (!mounted || !open || groups.length === 0 || size.w === 0) return null;
  const group = activeGroup;
  if (!group || group.segments.length === 0) return null;
  // By id only. isSameUser deliberately refuses a username fallback, and this
  // is an ownership check that hands out a Delete button.
  const isOwnStory = isSameUser(viewer, { userId: group.userId });
  const removeStory = () => {
    deleteStory.mutate(activeStoryId || group.id, {
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
    id: segment?.id || group.id,
    username: group.username,
    avatar: group.avatar,
    items: storyItems.map((s, index) => ({ type: s.type, url: index === storyIndex && segment?.isSourceCard ? "" : s.url })),
  };
  const canMessageOwner = playbackReady && !isOwnStory && !!group.userId;
  const isCurrentPlayback = () => {
    const state = useStoryViewerStore.getState();
    return playbackReady && playback.isCurrent() && state.open && state.viewSession === viewSession && state.groupIndex === groupIndex && segmentEpoch.current === activeSegmentEpoch;
  };
  const beforeSend = rawSegment?.sharedSource ? async () => {
    if (!rawSegment.id || !viewer?.id || !isCurrentPlayback()) throw new Error("Story viewer changed");
    try {
      const fresh = await storiesApi.getSharedStoryForPlayback(rawSegment.id, rawSegment.sharedSource!, viewer.id, isCurrentPlayback);
      if (!fresh) throw new Error("This shared story is no longer available");
    } catch (error) {
      playback.revoke();
      throw error;
    }
  } : undefined;

  const sendReply = async () => {
    const text = replyText.trim();
    if (!playbackReady || !text || sendingReply || !group.userId) return;
    setSendingReply(true);
    try {
      await sendStoryMessage({
        queryClient,
        recipientUserId: group.userId,
        story: storyContext,
        itemIndex: storyIndex,
        kind: "story_reply",
        content: text,
        expectedViewerId: viewer?.id,
        isCurrent: isCurrentPlayback,
        beforeSend,
      });
      if (!isCurrentPlayback()) return;
      setReplyText("");
      showToast("success", "Sent", `Reply sent to @${group.username}`);
    } catch (e: unknown) {
      if (!isCurrentPlayback()) return;
      showToast(
        "error",
        "Reply didn't send",
        e instanceof Error ? e.message : "Try again in a moment.",
      );
    } finally {
      if (isCurrentPlayback()) {
        setSendingReply(false);
        setComposerFocused(false);
      }
    }
  };

  const sendReaction = (emoji: string) => {
    if (!playbackReady || !group.userId) return;
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
      expectedViewerId: viewer?.id,
      isCurrent: isCurrentPlayback,
      beforeSend,
    }).catch(() => {
      if (!isCurrentPlayback()) return;
      showToast("error", "Reaction didn't send", "Try again in a moment.");
    });
  };

  const viewersAction = (
    <button
      type="button"
      onClick={() => setShowViewers(true)}
      className="flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/15 bg-black/45 px-3 text-white backdrop-blur-md focus-visible:outline-2 focus-visible:outline-white"
      aria-label="See who viewed this story"
    >
      <Eye size={16} color="#fff" />
      <span className="text-[13px] font-semibold">Viewers</span>
    </button>
  );

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
        ref={frameRef}
        style={{
          width: size.w,
          height: size.h,
          overflow: "hidden",
          position: "relative",
          // react-insta-stories stacks its own layers up to zIndex 99999. A
          // stacking context keeps that contest inside this frame instead of
          // letting it outrank the close and delete buttons beside it.
          isolation: "isolate",
        }}
      >
        {playbackReady ? <StoryViewer
          key={group.id}
          stories={storyItems}
          currentIndex={storyIndex}
          onAllStoriesEnd={nextGroup}
          onStoryChange={changeStoryIndex}
          onProfilePress={() => {
            const path = storyProfilePath(group, viewer, "web");
            if (!path) return;
            closeForNavigation();
            router.push(path);
          }}
          width={size.w}
          height={size.h}
          paused={composerFocused || showViewers || confirmingDelete}
        /> : (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center text-white" role="status">
            <p>{playback.status === "checking" ? "Checking this shared story…" : "This shared story is no longer available."}</p>
            {playback.status === "unavailable" ? (
              <button type="button" className="rounded-xl bg-white/15 px-4 py-2" onClick={() => {
                if (storyIndex < group.segments.length - 1) changeStoryIndex(storyIndex + 1);
                else nextGroup();
              }}>Next story</button>
            ) : null}
          </div>
        )}

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

        {/* Sound. The kit's <video> is muted so the browser will autoplay it at
            all; this is the only way back to the audio the poster recorded. */}
        {segment?.type === "video" ? (
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              frameRef.current
                ?.querySelectorAll("video")
                .forEach((v) => {
                  v.muted = next;
                  if (!next) void v.play().catch(() => {});
                });
            }}
            aria-label={muted ? "Unmute story" : "Mute story"}
            style={{ zIndex: STORY_UI_Z }}
            className="absolute right-4 top-16 flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-black/45 backdrop-blur-md"
          >
            {muted ? (
              <VolumeX size={17} color="#fff" />
            ) : (
              <Volume2 size={17} color="#fff" />
            )}
          </button>
        ) : null}

        {/* Reactions in flight — the receipt for a tap, without a toast over
            the story. */}
        {playbackReady && floatingEmojis.length > 0 ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center"
            style={{ zIndex: STORY_UI_Z }}
          >
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

        {/* One bottom stack keeps attribution, tags and messaging clear of each
            other. Empty story space stays transparent to the player's tap zones. */}
        {playbackReady ? (
          <div
            className="pointer-events-none absolute inset-0 flex min-h-0 flex-col"
            style={{
              zIndex: STORY_UI_Z,
              paddingTop: segment?.isSourceCard ? Math.max(72, size.h * 0.12) : 0,
            }}
          >
            {segment?.sharedSource && segment.isSourceCard ? (
              <StorySharedSourceContent
                key={`${segment.sharedSource.type}:${segment.sharedSource.id}`}
                source={segment.sharedSource}
              />
            ) : null}
            <div
              data-story-footer
              className="pointer-events-auto mt-auto flex shrink-0 flex-col gap-3 px-4"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {/* Keep tags in the bottom stack; their expanded list opens above
                  it instead of covering attribution or messaging controls. */}
              {storyTags.length > 0 ? (
                <div data-story-tags className="relative flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowTags((visible) => !visible)}
                    aria-label={`${storyTags.length} people tagged`}
                    aria-expanded={showTags}
                    className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/15 bg-black/60 px-3.5 py-2 backdrop-blur-md"
                  >
                    <Users size={14} color="#fff" />
                    <span className="text-[13px] font-semibold text-white">
                      {storyTags.length === 1
                        ? `@${storyTags[0].username}`
                        : `${storyTags.length} people`}
                    </span>
                  </button>
                  {showTags ? (
                    <div data-story-tag-list className="absolute bottom-full mb-2 flex max-h-32 max-w-full flex-col gap-1 overflow-y-auto rounded-2xl border border-white/15 bg-black/65 p-2 backdrop-blur-md">
                      {storyTags.map((tag) => (
                        <button
                          key={tag.id}
                          onClick={() => {
                            closeForNavigation();
                            router.push(`/feed/${tag.username}`);
                          }}
                          className="flex shrink-0 items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/10"
                        >
                          {tag.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={tag.avatar} alt="" className="h-6 w-6 rounded-md bg-white/10 object-cover" />
                          ) : null}
                          <span className="text-[13px] font-semibold text-white">@{tag.username}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {segment?.sharedSource ? (
                <StorySharedSourceCard
                  source={segment.sharedSource}
                  profilePath={segment.sharedSource.author.profileUnavailable ? null : storyProfilePath({
                    userId: segment.sharedSource.author.id,
                    username: segment.sharedSource.author.username,
                  }, viewer, "web")}
                  viewersAction={isOwnStory ? viewersAction : undefined}
                  onNavigate={(path) => {
                    closeForNavigation();
                    router.push(path);
                  }}
                />
              ) : isOwnStory ? (
                <div className="flex justify-start">{viewersAction}</div>
              ) : null}
              {canMessageOwner ? (
                <div className="flex min-w-0 flex-col gap-3">
                  {!composerFocused ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {STORY_REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => sendReaction(emoji)}
                          aria-label={`React ${emoji}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/45 text-[22px] backdrop-blur-md transition-transform active:scale-90 hover:scale-110"
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
            </div>
          </div>
        ) : null}

        <StoryViewersSheetWeb
          storyId={activeStoryId || group.id}
          open={playbackReady && isOwnStory && showViewers}
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
