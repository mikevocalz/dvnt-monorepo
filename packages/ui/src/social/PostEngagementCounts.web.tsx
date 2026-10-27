import { Heart, MessageCircle } from "lucide-react";
import { formatEngagementCount } from "./engagement-counts";
import type { PostEngagementCountsProps } from "./PostEngagementCounts.types";

/** Keep each icon/count pair together, even in a narrow masonry card. */
export function PostEngagementCounts({
  likes, hasLiked, comments, onLike, onComments, onViewLikes,
  onPrefetchLikes, onPrefetchComments, disabled, compact = false, iconSize,
}: PostEngagementCountsProps) {
  const size = iconSize ?? (compact ? 14 : 22);
  const buttonClass = "pointer-events-auto inline-flex min-h-11 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-[#3FDCFF]";
  const heart = <Heart size={size} color={hasLiked ? "#ef4444" : "#fff"} fill={hasLiked ? "#ef4444" : "transparent"} aria-hidden="true" />;
  return (
    <div data-post-engagement className={`flex shrink-0 items-center ${compact ? "gap-1 text-xs" : "gap-5 text-[15px]"} font-medium text-white tabular-nums`}>
      <div data-like-count-pair className="inline-flex shrink-0 items-center">
        <button type="button" onClick={onLike} disabled={disabled} className={`${buttonClass} min-w-6 justify-center`} aria-label={hasLiked ? "Unlike" : "Like"} aria-pressed={hasLiked}>
          {heart}
          {!onViewLikes ? <span className="ml-1">{formatEngagementCount(likes)}</span> : null}
        </button>
        {onViewLikes ? (
          <button type="button" onClick={onViewLikes} onMouseEnter={onPrefetchLikes} onFocus={onPrefetchLikes} className={`${buttonClass} min-w-6 justify-start hover:underline`} aria-label={`View ${likes} ${likes === 1 ? "like" : "likes"}`}>
            {formatEngagementCount(likes)}
          </button>
        ) : null}
      </div>
      <button type="button" onClick={onComments} onMouseEnter={onPrefetchComments} onFocus={onPrefetchComments} className={`${buttonClass} gap-1 justify-center`} aria-label={`View ${comments} ${comments === 1 ? "comment" : "comments"}`}>
        <MessageCircle size={size} aria-hidden="true" />
        <span>{formatEngagementCount(comments)}</span>
      </button>
    </div>
  );
}
