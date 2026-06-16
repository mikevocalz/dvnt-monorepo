/**
 * Comment replies — WEB (@dvnt/app/features/comments). Full-screen thread of
 * replies under a single parent comment, ported from the native screen
 * `app/(protected)/comments/replies/[commentId].tsx`. The native screen can't
 * run on web (FlatList / expo-router / useSafeHeader), so this is a focused web
 * view over the SHARED data: the EXACT thread hook native uses
 * (useCommentThread → react-query) + the create-reply mutation
 * (useCreateComment), the threaded UI (CommentRow), and the Zustand composer
 * draft (comment-draft-store).
 *
 * Conventions: NativeWind interop is OFF, so Tailwind className lives only on
 * raw DOM tags; the RN-based CommentRow renders via react-native-web. The reply
 * list is a TanStack Virtual list (never FlatList on web). Composer is pinned
 * above the safe-area bottom (Instagram-style), reply target + draft live in the
 * shared comment-draft-store (Zustand, never useState). bg #06070d, accent
 * cyan #3FDCFF.
 */
"use client";

import { useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { Send } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCommentThread,
  useCreateComment,
} from "@dvnt/app/lib/hooks/use-comments";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCommentDraftStore } from "@dvnt/app/lib/stores/comment-draft-store";
import {
  CommentRow,
  type CommentData,
} from "@dvnt/app/components/comments/threaded-comment";
import type { Comment } from "@dvnt/app/lib/types";

const ESTIMATED_ROW = 120;

function mapComment(comment: Comment): CommentData {
  return {
    id: comment.id,
    username: comment.username,
    avatar: comment.avatar,
    text: comment.text,
    timeAgo: comment.timeAgo,
    createdAt: comment.createdAt,
    likes: comment.likes,
    hasLiked: comment.hasLiked,
    parentId: comment.parentId,
    rootId: comment.rootId,
    depth: comment.depth,
    replies: [],
  };
}

/**
 * Virtualized replies list. Each reply is one measured row rendered with the
 * shared CommentRow (reply variant) so like / reply / profile wiring matches
 * native. Reply taps seed the Zustand composer draft (setReplyTo) and reveal the
 * bottom bar.
 */
function RepliesList({
  postId,
  replies,
  focusCommentId,
}: {
  postId: string;
  replies: Comment[];
  focusCommentId?: string;
}) {
  const router = useRouter();
  const setReplyTo = useCommentDraftStore((s) => s.setReplyTo);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: replies.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 6,
  });

  if (replies.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-white/55">No replies yet</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="px-1">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const reply = replies[item.index];
          if (!reply) return null;
          return (
            <div
              key={reply.id}
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
              <CommentRow
                comment={mapComment(reply)}
                postId={postId}
                variant="reply"
                isHighlighted={reply.id === focusCommentId}
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
 * Composer pinned above the bottom safe-area (Instagram-style). Reply target +
 * draft live in the shared comment-draft-store (Zustand, never useState). When a
 * reply is open it submits via the EXACT useCreateComment mutation native uses,
 * threading the new reply under the parent comment.
 */
function ReplyComposer({
  postId,
  parentCommentId,
}: {
  postId: string;
  parentCommentId: string;
}) {
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
    if (!body || !postId || !parentCommentId) return;
    createComment.mutate({
      post: postId,
      text: body,
      parent: parentCommentId,
      replyToCommentId: replyTo?.commentId || parentCommentId,
      authorUsername: user?.username,
      authorId: user?.id,
    });
    reset();
  };

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
          Add a reply…
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
        <span>{replyTo ? `Replying to @${replyTo.username}` : "Add a reply"}</span>
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
            replyTo ? `Reply to @${replyTo.username}…` : "Add a reply…"
          }
          className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/40"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Post reply"
          className="text-[#3FDCFF] disabled:opacity-35"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}

export function CommentRepliesScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = params as any;
  const commentId = String(p?.commentId ?? "");
  const postId = String(p?.postId ?? "");
  const focusCommentId = p?.focusCommentId
    ? String(p.focusCommentId)
    : undefined;

  const setReplyTo = useCommentDraftStore((s) => s.setReplyTo);

  const { data: thread, isLoading } = useCommentThread(postId, commentId, 100);
  const parentComment = thread?.parentComment || null;
  const replies = thread?.replies || [];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#06070d] text-white">
      {/* Sticky top bar: "Replies" + back. */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <span className="text-lg leading-none text-white">‹</span>
        </button>
        <h1 className="text-[17px] font-semibold">Replies</h1>
        <span className="w-9" />
      </div>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
            <p className="mt-4 text-sm text-white/55">Loading replies…</p>
          </div>
        ) : !parentComment ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
            <p className="text-base font-bold text-white">Thread unavailable</p>
            <p className="mt-2 text-sm text-white/55">
              This comment may have been removed.
            </p>
          </div>
        ) : (
          <div className="flex-1 px-4 py-4">
            {/* Parent comment header */}
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-white/55">
              Parent comment
            </p>
            <CommentRow
              comment={mapComment(parentComment)}
              postId={postId}
              onReply={() =>
                setReplyTo({
                  commentId: parentComment.id,
                  username: parentComment.username,
                })
              }
              onProfilePress={(username) => router.push(`/feed/${username}`)}
            />

            <div className="my-3 h-px w-full bg-white/8" />

            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-white/55">
              Replies
            </p>
            <RepliesList
              postId={postId}
              replies={replies}
              focusCommentId={focusCommentId}
            />
          </div>
        )}

        {parentComment ? (
          <ReplyComposer postId={postId} parentCommentId={parentComment.id} />
        ) : null}
      </main>
    </div>
  );
}

export default CommentRepliesScreen;
