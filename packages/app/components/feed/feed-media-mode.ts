/**
 * Which media treatment a feed post gets.
 *
 * Extracted from `feed-post.tsx` because the rule is easy to get subtly wrong
 * and impossible to see from the JSX: the branch used to key off the type of
 * the FIRST item, so a post of [video, image, image] rendered the video alone —
 * the images were unreachable and the carousel dots never appeared.
 */

export type FeedMediaMode = "text" | "carousel" | "single-video" | "single";

export interface MediaItemLike {
  type?: string;
}

export function feedMediaMode(
  media: MediaItemLike[] | null | undefined,
  opts?: { isTextPost?: boolean },
): FeedMediaMode {
  if (opts?.isTextPost) return "text";
  if (!media || media.length === 0) return "single";
  // Anything with a second item is a carousel, whatever the mix — each slide
  // renders through DVNTMediaRenderer, which plays video on the focused slide.
  if (media.length > 1) return "carousel";
  // The standalone player (mute, fullscreen, seek bar, raised social row) is
  // scoped to media[0], so it may only claim a post that IS one video.
  return media[0]?.type === "video" ? "single-video" : "single";
}

/** Dots appear for every carousel, so a mixed post still says there is more. */
export function showsCarouselDots(mode: FeedMediaMode): boolean {
  return mode === "carousel";
}

/**
 * Dots shown at once. The row sits between the NSFW pill and the more-menu
 * button; uncapped, a long post grows the row left until it collides with them.
 */
export const DOT_WINDOW = 7;

/** First dot index of the sliding window, clamped to both ends. */
export function dotWindowStart(count: number, current: number): number {
  if (count <= DOT_WINDOW) return 0;
  const half = Math.floor(DOT_WINDOW / 2);
  return Math.min(Math.max(0, current - half), count - DOT_WINDOW);
}
