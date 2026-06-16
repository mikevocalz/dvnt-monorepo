import type { Comment } from "@/lib/types";

type CommentLike = Comment & {
  replies?: CommentLike[];
};

function toComparableTime(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stripNestedReplies(comment: CommentLike): CommentLike {
  return {
    ...comment,
    replies: [],
  };
}

export function getThreadRootId(comment: Pick<CommentLike, "id" | "parentId" | "rootId">): string {
  if (!comment.parentId) return String(comment.id);
  return String(comment.rootId || comment.parentId);
}

export function buildTwoLevelCommentThreads(
  comments: CommentLike[] = [],
): CommentLike[] {
  const rootMap = new Map<string, CommentLike>();
  const roots: Array<{ order: number; comment: CommentLike }> = [];
  const replies: Array<{ order: number; comment: CommentLike }> = [];

  function collect(comment: CommentLike, order: number) {
    if (!comment?.id) return;

    const normalized = {
      ...comment,
      id: String(comment.id),
      parentId: comment.parentId ? String(comment.parentId) : null,
      rootId: comment.rootId ? String(comment.rootId) : null,
      replies: [],
    } satisfies CommentLike;

    const isTopLevel =
      normalized.parentId == null && normalized.rootId == null;

    if (isTopLevel) {
      rootMap.set(normalized.id, normalized);
      roots.push({ order, comment: normalized });
    } else {
      replies.push({ order, comment: stripNestedReplies(normalized) });
    }
  }

  comments.forEach((comment, index) => {
    collect(comment, index);
    (comment.replies || []).forEach((reply, replyIndex) => {
      collect(reply, index + (replyIndex + 1) / 1000);
    });
  });

  replies.forEach(({ comment }) => {
    const rootId = getThreadRootId(comment);
    const root = rootMap.get(rootId);
    if (!root) return;
    root.replies = [...(root.replies || []), comment];
  });

  const orderedRoots = roots
    .sort((left, right) => {
      const byDate =
        toComparableTime(right.comment.createdAt) -
        toComparableTime(left.comment.createdAt);
      return byDate !== 0 ? byDate : left.order - right.order;
    })
    .map(({ comment }) => ({
      ...comment,
      replies: (comment.replies || []).sort((left, right) => {
        const byDate =
          toComparableTime(left.createdAt) - toComparableTime(right.createdAt);
        return byDate !== 0 ? byDate : 0;
      }),
    }));

  return orderedRoots;
}

export function countCommentsTree(comments: CommentLike[] = []): number {
  return comments.reduce(
    (total, comment) => total + 1 + countCommentsTree(comment.replies || []),
    0,
  );
}

export function findCommentInThreads(
  comments: CommentLike[] = [],
  targetId: string,
): CommentLike | undefined {
  for (const comment of comments) {
    if (String(comment.id) === targetId) return comment;
    const replies = comment.replies || [];
    const reply = replies.find((item) => String(item.id) === targetId);
    if (reply) return reply;
  }
  return undefined;
}

export function findCommentThread(
  comments: CommentLike[] = [],
  targetId: string,
): { parentComment: CommentLike; replies: CommentLike[] } | null {
  const directRoot = comments.find((comment) => String(comment.id) === targetId);
  if (directRoot) {
    return {
      parentComment: directRoot,
      replies: directRoot.replies || [],
    };
  }

  for (const comment of comments) {
    const reply = (comment.replies || []).find(
      (item) => String(item.id) === targetId,
    );
    if (reply) {
      return {
        parentComment: comment,
        replies: comment.replies || [],
      };
    }
  }

  return null;
}

export function insertCommentIntoThreads(
  comments: CommentLike[] = [],
  optimisticComment: CommentLike,
): CommentLike[] {
  if (!optimisticComment.parentId) {
    return buildTwoLevelCommentThreads([optimisticComment, ...comments]);
  }

  const rootId = getThreadRootId(optimisticComment);

  return comments.map((comment) => {
    if (String(comment.id) !== rootId) return comment;
    return {
      ...comment,
      replies: [...(comment.replies || []), stripNestedReplies(optimisticComment)],
    };
  });
}
