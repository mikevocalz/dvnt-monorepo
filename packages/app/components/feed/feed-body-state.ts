/**
 * Which body the home feed renders. Shared by the web feed
 * (features/home/screen.web.tsx) and both native feeds (feed.tsx,
 * masonry-feed.tsx) so the three cannot drift.
 *
 * An empty list has three different causes, and each needs its own copy:
 * - the fetch failed: say so and offer Retry. Saying "No posts yet" here made
 *   a network error look like an empty app.
 * - Spicy is on: the query returns ONLY isNSFW posts (api/posts.ts strict
 *   filter), so an empty Spicy feed says nothing about the normal feed.
 * - neither: the feed really is empty.
 *
 * Posts already on screen win over an error, so a failed background refetch
 * never replaces a feed the user is reading.
 */
export type FeedBodyState =
  | "loading"
  | "posts"
  | "error"
  | "spicy-empty"
  | "empty";

export function feedBodyState(input: {
  isLoading: boolean;
  isError: boolean;
  spicy: boolean;
  postCount: number;
}): FeedBodyState {
  if (input.postCount > 0) return "posts";
  if (input.isLoading) return "loading";
  if (input.isError) return "error";
  return input.spicy ? "spicy-empty" : "empty";
}

export const FEED_COPY = {
  empty: "No posts yet — be the first to share something.",
  spicyEmpty: "No Spicy posts to show right now.",
  spicyOff: "Turn off Spicy",
  error: "Couldn't load the feed. Check your connection and try again.",
  retry: "Retry",
} as const;
