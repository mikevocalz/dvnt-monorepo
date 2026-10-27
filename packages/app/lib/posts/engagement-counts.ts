import type { Comment } from "../types";
import { countCommentsTree } from "../comments/threading.ts";

/** Post payloads carry either a total or a comment tree; replies count too. */
export function getPostCommentCount(comments: number | Comment[] | null | undefined): number {
  return Array.isArray(comments)
    ? countCommentsTree(comments)
    : Number.isFinite(comments) ? Math.max(0, Math.floor(comments ?? 0)) : 0;
}

