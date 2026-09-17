/**
 * Replying to a story, and reacting to one, are both direct messages carrying
 * story context — that context is what lets the chat render a StoryReplyBubble
 * with the frame you were looking at.
 *
 * It lived inline in the native story screen, which is why web had neither:
 * porting the UI meant porting 60 lines of conversation resolution and metadata
 * shaping with it. Both platforms call this instead, so a change to the bubble
 * contract happens once.
 *
 * No react-native, no expo — this is importable from the web overlay.
 */

import type { QueryClient } from "@tanstack/react-query";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { getOrCreateConversationCached } from "@dvnt/app/lib/hooks/use-conversation-resolution";

/** The emoji row under a story. Same set on both platforms. */
export const STORY_REACTION_EMOJIS = ["❤️", "🔥", "😂", "😍", "👏", "😮", "😈"];

/** A story as both platforms hold it — only the fields the bubble needs. */
export interface StoryMessageContext {
  id?: string | number | null;
  username?: string | null;
  avatar?: string | null;
  items?: Array<{
    type?: string | null;
    url?: string | null;
    thumbnail?: string | null;
  }> | null;
}

/**
 * A story expires 24h after it was posted; the chat hides the preview past
 * that. Sent as an absolute time so the recipient's clock decides, not ours.
 */
function expiresAt(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

/** The frame being replied to. Video replies preview the poster, not the file. */
function previewUrl(story: StoryMessageContext, itemIndex: number): string {
  const item = story.items?.[itemIndex];
  if (!item) return "";
  return (
    (item.type === "video" ? item.thumbnail || item.url : item.url) || ""
  );
}

export function buildStoryMessageMetadata(
  kind: "story_reply" | "story_reaction",
  story: StoryMessageContext,
  itemIndex: number,
  emoji?: string,
): Record<string, unknown> {
  return {
    type: kind,
    storyId: story.id != null ? String(story.id) : "",
    storyMediaUrl: previewUrl(story, itemIndex),
    storyUsername: story.username || "",
    storyAvatar: story.avatar || "",
    ...(emoji ? { reactionEmoji: emoji } : {}),
    storyExpiresAt: expiresAt(),
  };
}

/**
 * Sends the reply/reaction to the story owner's DM thread, creating the
 * conversation if there isn't one. Throws on failure — the caller owns what the
 * member sees, because a reply that silently fails is the bug this whole
 * session started with.
 */
export async function sendStoryMessage({
  queryClient,
  recipientUserId,
  story,
  itemIndex,
  kind,
  content,
}: {
  queryClient: QueryClient;
  recipientUserId: string;
  story: StoryMessageContext;
  itemIndex: number;
  kind: "story_reply" | "story_reaction";
  /** The reply text, or the emoji for a reaction. */
  content: string;
}) {
  const conversationId = await getOrCreateConversationCached(
    queryClient,
    recipientUserId,
  );
  if (!conversationId) throw new Error("Could not start conversation");

  return messagesApiClient.sendMessage({
    conversationId,
    content,
    metadata: buildStoryMessageMetadata(
      kind,
      story,
      itemIndex,
      kind === "story_reaction" ? content : undefined,
    ),
  });
}
