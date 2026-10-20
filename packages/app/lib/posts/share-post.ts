import type { Post } from "../types";
import type { SharedPostContext } from "../stores/chat-store";
import { isVideoKind } from "../media/types";
import { resolveTextPostPresentation } from "./text-post";

/** Same post-card metadata as the native inbox reshare, not a new feed post. */
export function sharedPostContext(post: Post): SharedPostContext {
  return {
    postId: post.id,
    authorUsername: post.author?.username || "",
    authorAvatar: post.author?.avatar || "",
    caption:
      post.kind === "text"
        ? resolveTextPostPresentation(post.textSlides, post.caption).previewText
        : post.caption,
    mediaUrl: post.media?.[0]?.url,
    mediaType: post.media?.[0]?.type,
  };
}

/** Native feed parity: share the first media item, using the existing story API. */
export function postStoryItem(post: Pick<Post, "media"> | null | undefined) {
  const media = post?.media?.[0];
  if (!media?.url) return null;
  return {
    type: isVideoKind(media.type) ? "video" : "image",
    url: media.url,
    thumbnail: media.thumbnail,
  };
}
