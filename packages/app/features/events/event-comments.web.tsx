/**
 * Event Comments — WEB (@dvnt/app/features/events/event-comments). Full comments
 * thread for an event, ported from the native screen
 * `app/(protected)/events/[id]/comments.tsx`. The native screen can't run on web
 * (ScrollView / KeyboardStickyView / expo-router / useSafeHeader), so this is a
 * focused web view over the SHARED data: the EXACT event-comment hooks native
 * uses (useEventComments / useCreateEventComment → react-query) plus the same
 * @mention search (usersApi.searchUsers). Event comments are a FLAT list (the
 * data layer exposes only fetch + create — no like/reply/delete), so there is no
 * threading here, mirroring native.
 *
 * Conventions: NativeWind interop is OFF, so Tailwind className lives only on raw
 * DOM tags (no <View>/<Text>). The comment list is a TanStack Virtual list
 * (never FlatList on web). Avatars are rounded squares. Composer draft + caret
 * state live in Zustand (comment-draft-store + event-comment-mention-store),
 * never useState. Composer pinned above the bottom safe-area like
 * post-detail.web; sticky "Comments" header like legal-page.web.
 */
"use client";

import { useRef, useMemo } from "react";
import { useParams, useRouter } from "solito/navigation";
import { Send, MessageCircle, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEventComments,
  useCreateEventComment,
} from "@dvnt/app/lib/hooks/use-event-comments";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCommentDraftStore } from "@dvnt/app/lib/stores/comment-draft-store";
import { useEventCommentMentionStore } from "@dvnt/app/lib/stores/event-comment-mention-store";
import { MENTION_COLOR } from "@dvnt/app/src/constants/mentions";

const ESTIMATED_ROW = 88;

type EventComment = {
  id: string;
  content: string;
  createdAt: string;
  parentId: string | null;
  author: { id: string; username: string; avatar: string } | null;
};

type MentionUser = { username: string; avatar?: string };

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/**
 * One comment row — avatar (rounded square) + author/time + body with inline
 * @mention highlighting. Tapping a mention routes to the mentioned profile.
 */
function CommentRow({
  comment,
  onProfilePress,
}: {
  comment: EventComment;
  onProfilePress: (username: string) => void;
}) {
  return (
    <div className="flex gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={comment.author?.avatar || ""}
        alt=""
        className="h-10 w-10 shrink-0 rounded-xl bg-white/10 object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[15px] font-semibold text-white">
            {comment.author?.username || "User"}
          </span>
          <span className="text-xs text-white/45">
            {formatDate(comment.createdAt)}
          </span>
        </div>
        <p className="text-sm leading-5 text-white/90">
          {(comment.content || "").split(/(@\w+)/g).map((part, i) =>
            part.startsWith("@") ? (
              <button
                key={i}
                onClick={() => onProfilePress(part.slice(1))}
                style={{ color: MENTION_COLOR }}
                className="font-extrabold"
              >
                {part}
              </button>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Flat, virtualized comment list (TanStack Virtual — never FlatList on web).
 * Each comment is one measured row.
 */
function CommentList({
  comments,
  onProfilePress,
}: {
  comments: EventComment[];
  onProfilePress: (username: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: comments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 6,
  });

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4 py-4"
      style={{ maxHeight: "calc(100dvh - 180px)" }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const comment = comments[item.index];
          if (!comment) return null;
          return (
            <div
              key={comment.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
                paddingBottom: 16,
              }}
            >
              <CommentRow comment={comment} onProfilePress={onProfilePress} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Composer pinned above the bottom safe-area (post-detail.web style). Draft text
 * + open state live in the shared comment-draft-store; the caret position lives
 * in event-comment-mention-store. While an `@query` is active a suggestion list
 * (local commenters merged with usersApi.searchUsers — the exact native search)
 * floats above the input. Submit calls the EXACT useCreateEventComment mutation.
 */
function EventCommentComposer({
  eventId,
  comments,
}: {
  eventId: string;
  comments: EventComment[];
}) {
  const text = useCommentDraftStore((s) => s.text);
  const setText = useCommentDraftStore((s) => s.setText);
  const reset = useCommentDraftStore((s) => s.reset);
  const cursorPos = useEventCommentMentionStore((s) => s.cursorPos);
  const setCursorPos = useEventCommentMentionStore((s) => s.setCursorPos);
  const user = useAuthStore((s) => s.user);
  const createComment = useCreateEventComment();
  const inputRef = useRef<HTMLInputElement>(null);

  // Active @query derived from the caret position (mirrors native).
  const mentionQuery = useMemo(() => {
    const before = text.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, [text, cursorPos]);

  // Existing commenters for instant local suggestions.
  const commenters = useMemo<MentionUser[]>(() => {
    const seen = new Set<string>();
    const result: MentionUser[] = [];
    for (const c of comments) {
      const uname = c.author?.username;
      const avatar = c.author?.avatar;
      if (uname && !seen.has(uname) && uname !== user?.username) {
        seen.add(uname);
        result.push({ username: uname, avatar });
      }
    }
    return result;
  }, [comments, user?.username]);

  // API-backed user search — same usersApi.searchUsers native uses.
  const { data: apiMentionResults = [] } = useQuery<MentionUser[]>({
    queryKey: ["users", "mention-search", "event", mentionQuery],
    queryFn: async () => {
      if (!mentionQuery || mentionQuery.length < 1) return [];
      const result = await usersApi.searchUsers(mentionQuery.toLowerCase(), 8);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result.docs || []).map((u: any) => ({
        username: u.username,
        avatar: u.avatar,
      }));
    },
    enabled: !!mentionQuery && mentionQuery.length >= 1,
    staleTime: 10_000,
  });

  // Merge local + API results.
  const mentionSuggestions = useMemo<MentionUser[]>(() => {
    if (mentionQuery === null) return [];
    if (!mentionQuery) return commenters.slice(0, 5);
    const seen = new Set<string>();
    const merged: MentionUser[] = [];
    const localMatches = commenters.filter((c) =>
      c.username.toLowerCase().includes(mentionQuery.toLowerCase()),
    );
    for (const u of localMatches) {
      if (!seen.has(u.username)) {
        seen.add(u.username);
        merged.push(u);
      }
    }
    for (const u of apiMentionResults) {
      if (!seen.has(u.username) && u.username !== user?.username) {
        seen.add(u.username);
        merged.push(u);
      }
    }
    return merged.slice(0, 8);
  }, [mentionQuery, commenters, apiMentionResults, user?.username]);

  const syncCaret = () => {
    const el = inputRef.current;
    if (el) setCursorPos(el.selectionStart ?? el.value.length);
  };

  const insertMention = (username: string) => {
    const before = text.slice(0, cursorPos);
    const after = text.slice(cursorPos);
    const atIdx = before.lastIndexOf("@");
    const newBefore = before.slice(0, atIdx);
    const newText = `${newBefore}@${username} ${after}`;
    const newCursor = newBefore.length + username.length + 2;
    setText(newText);
    setCursorPos(newCursor);
    inputRef.current?.focus();
  };

  const submit = () => {
    const body = text.trim();
    if (!body || !user) return;
    createComment.mutate({
      eventId,
      text: body,
      authorUsername: user.username,
      authorAvatar: user.avatar,
    });
    reset();
  };

  return (
    <div
      className="sticky z-20 mx-auto w-full max-w-2xl px-3"
      // Lift the composer above the persistent floating tab bar (it occupies
      // ~82px on desktop, ~74px + safe-area on mobile) so the input is never
      // hidden behind it.
      style={{ bottom: "calc(88px + env(safe-area-inset-bottom))", paddingBottom: 12 }}
    >
      {mentionSuggestions.length > 0 ? (
        <div className="mb-2 max-h-52 overflow-y-auto rounded-2xl border border-white/12 bg-[#0b0d16]/95 backdrop-blur">
          <p className="px-4 pb-1.5 pt-2.5 text-[11px] text-white/45">
            Mention a user
          </p>
          {mentionSuggestions.map((u) => (
            <button
              key={u.username}
              onClick={() => insertMention(u.username)}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-white/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u.avatar || ""}
                alt=""
                className="h-8 w-8 rounded-lg bg-white/10 object-cover"
              />
              <span className="text-[15px] font-medium text-white">
                @{u.username}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-[#0b0d16]/95 px-3 py-2 backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={user?.avatar || ""}
          alt=""
          className="h-8 w-8 shrink-0 rounded-lg bg-white/10 object-cover"
        />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCursorPos(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Add a comment… (@ to mention)"
          className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/40"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Post comment"
          className="text-[#3FDCFF] disabled:opacity-35"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}

export function EventCommentsScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = String((params as any)?.id ?? "");
  const { data, isLoading } = useEventComments(eventId, 100);
  const comments = (data ?? []) as EventComment[];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#06070d] text-white">
      {/* Sticky top bar: "Comments" + close X (legal-page.web pattern). */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Comments</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
            <p className="mt-4 text-sm text-white/55">Loading comments…</p>
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-10 py-24 text-center">
            <MessageCircle size={48} color="rgba(255,255,255,0.4)" />
            <p className="mt-4 text-lg font-semibold text-white">
              No Comments Yet
            </p>
            <p className="mt-2 text-sm text-white/55">
              Be the first to share your thoughts about this event!
            </p>
          </div>
        ) : (
          <CommentList
            comments={comments}
            onProfilePress={(username) => router.push(`/feed/${username}`)}
          />
        )}

        <EventCommentComposer eventId={eventId} comments={comments} />
      </main>
    </div>
  );
}

export default EventCommentsScreen;
