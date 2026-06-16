/**
 * Comments — WEB (@dvnt/app/features/comments). Full-screen threaded comments
 * view for a post, ported from the native screen
 * `app/(protected)/comments/[postId].tsx`. The native screen can't run on web
 * (FlatList / expo-router / useSafeHeader), so this is a focused web view over
 * the SHARED data: the EXACT comment hooks native uses
 * (useComments / useCreateComment → react-query) plus the threaded UI
 * (ThreadedComment) and the Zustand composer draft (comment-draft-store).
 *
 * Conventions: NativeWind interop is OFF, so Tailwind className lives only on
 * raw DOM tags; the RN-based ThreadedComment renders via react-native-web. The
 * comment list is a TanStack Virtual list (never FlatList on web). Composer is
 * pinned above the safe-area bottom like Instagram, revealed on demand exactly
 * like post-detail.web.
 */
"use client";

import { useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { Send, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useComments, useCreateComment } from "@dvnt/app/lib/hooks/use-comments";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCommentDraftStore } from "@dvnt/app/lib/stores/comment-draft-store";
import { ThreadedComment } from "@dvnt/app/components/comments/threaded-comment";

const ESTIMATED_ROW = 140;

/**
 * Threaded comment list — virtualized. Each top-level comment (with its nested
 * replies) is one measured row. Reply / like / delete all live inside
 * ThreadedComment (shared with native + post-detail.web). Reply taps seed the
 * Zustand composer draft and reveal the bottom bar.
 */
function CommentList({ postId }: { postId: string }) {
  const router = useRouter();
  const { data: comments } = useComments(postId, 50);
  const setReplyTo = useCommentDraftStore((s) => s.setReplyTo);
  const items = comments ?? [];

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 6,
  });

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
        <p className="text-base font-bold text-white">No comments yet</p>
        <p className="mt-2 text-sm text-white/55">Start the conversation.</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4 py-4"
      style={{ maxHeight: "calc(100dvh - 160px)" }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const comment = items[item.index];
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
                paddingBottom: 12,
              }}
            >
              <ThreadedComment
                comment={comment}
                postId={postId}
                showAllReplies
                onReply={(username, commentId) =>
                  setReplyTo({ commentId, username })
                }
                onProfilePress={(username) => router.push(`/feed/${username}`)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Composer pinned above the bottom safe-area (Instagram-style). Hidden until
 * the user taps a Reply (which calls setReplyTo → opens the composer), mirroring
 * the reveal-on-demand bar in post-detail.web. Draft + reply target live in the
 * shared comment-draft-store (Zustand, never useState).
 */
function CommentComposer({ postId }: { postId: string }) {
  const open = useCommentDraftStore((s) => s.open);
  const text = useCommentDraftStore((s) => s.text);
  const replyTo = useCommentDraftStore((s) => s.replyTo);
  const setText = useCommentDraftStore((s) => s.setText);
  const openComposer = useCommentDraftStore((s) => s.openComposer);
  const reset = useCommentDraftStore((s) => s.reset);
  const user = useAuthStore((s) => s.user);
  const createComment = useCreateComment();

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    createComment.mutate({
      post: postId,
      text: body,
      parent: replyTo?.commentId,
      replyToCommentId: replyTo?.commentId,
      authorUsername: user?.username,
      authorId: user?.id,
    });
    reset();
  };

  // Closed: a single "Add a comment…" affordance pinned to the bottom that
  // reveals the full input on tap.
  if (!open) {
    return (
      <div
        className="sticky bottom-0 z-20 mx-auto w-full max-w-2xl px-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <button
          onClick={() => openComposer()}
          className="w-full rounded-2xl border border-white/12 bg-[#0b0d16]/95 px-4 py-3 text-left text-[15px] text-white/45 backdrop-blur"
        >
          Add a comment…
        </button>
      </div>
    );
  }

  return (
    <div
      className="sticky bottom-0 z-20 mx-auto w-full max-w-2xl px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="flex items-center justify-between rounded-t-xl bg-white/5 px-3 py-1.5 text-xs text-white/55">
        <span>
          {replyTo ? `Replying to @${replyTo.username}` : "Add a comment"}
        </span>
        <button onClick={reset} className="font-medium" aria-label="Close composer">
          Close
        </button>
      </div>
      <div className="flex items-center gap-2 rounded-b-2xl border border-white/12 bg-[#0b0d16]/95 px-3 py-2 backdrop-blur">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            replyTo ? `Reply to @${replyTo.username}…` : "Add a comment…"
          }
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

export function CommentsScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postId = String((params as any)?.postId ?? "");
  const { isLoading } = useComments(postId, 50);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#06070d] text-white">
      {/* Sticky top bar: "Comments" + close X. */}
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
        ) : (
          <CommentList postId={postId} />
        )}

        <CommentComposer postId={postId} />
      </main>
    </div>
  );
}

export default CommentsScreen;
