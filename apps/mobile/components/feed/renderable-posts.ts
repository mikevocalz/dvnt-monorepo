import type { Post } from "@/lib/types";

const LYNK_FEED_PREFIX = "\uD83C\uDFA5 Live now:";
const LYNK_FEED_STANDALONE = "\uD83C\uDFA5 Started a live video";

export function shouldRenderInFeed(post: Post): boolean {
  const caption = post.caption?.trim();
  if (!caption) return true;
  return (
    !caption.startsWith(LYNK_FEED_PREFIX) && caption !== LYNK_FEED_STANDALONE
  );
}
