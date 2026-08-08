/**
 * Comments — public feature surface (WS-6 single-root barrel).
 *
 * Cross-feature / cross-app consumers import ONLY from here
 * (`@dvnt/app/features/comments`) — never a deep path into `ui/`. Re-exports only.
 */
export {
  ThreadedComment,
  CommentRow,
  CommentLikeButton,
} from "./ui/threaded-comment";
export type { CommentData } from "./ui/threaded-comment";
export { CommentComposerFooter } from "./ui/comment-composer-footer";
