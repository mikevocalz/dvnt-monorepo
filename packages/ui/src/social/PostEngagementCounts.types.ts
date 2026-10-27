/** Shared interaction contract for native and web feed/detail engagement. */
export type PostEngagementCountsProps = {
  likes: number;
  hasLiked: boolean;
  comments: number;
  onLike: () => void;
  onComments: () => void;
  onViewLikes?: () => void;
  onPrefetchLikes?: () => void;
  onPrefetchComments?: () => void;
  disabled?: boolean;
  compact?: boolean;
  iconSize?: number;
};
