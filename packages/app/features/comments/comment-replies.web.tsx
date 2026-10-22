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
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCommentThread,
} from "@dvnt/app/lib/hooks/use-comments";
import { useCommentDraftStore } from "@dvnt/app/lib/stores/comment-draft-store";
import {
  CommentRow,
  type CommentData,
} from "./ui/threaded-comment";
import { WebCommentComposer } from "./ui/comment-composer.web";
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
          <WebCommentComposer postId={postId} parentCommentId={parentComment.id} />
        ) : null}
      </main>
    </div>
  );
}

export default CommentRepliesScreen;
