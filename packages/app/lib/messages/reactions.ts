export interface MessageReaction {
  emoji: string;
  userId: string;
  username: string;
}

/** Metadata is untrusted, and older rows may use numeric user IDs. */
export function parseMessageReactions(value: unknown): MessageReaction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((reaction) => {
    if (!reaction || typeof reaction !== "object" ||
        typeof reaction.emoji !== "string" ||
        !["string", "number"].includes(typeof reaction.userId)) return [];
    return [{ emoji: reaction.emoji, userId: String(reaction.userId),
      username: typeof reaction.username === "string" ? reaction.username : "user" }];
  });
}

/** undefined means a partial/invalid realtime payload: leave cached state alone. */
export function reactionsFromMetadata(metadata: unknown): MessageReaction[] | undefined {
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { return undefined; }
  }
  if (metadata === null) return [];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return parseMessageReactions((metadata as Record<string, unknown>).reactions);
}

export function setReactionPresence(
  reactions: MessageReaction[], reaction: MessageReaction, present: boolean,
): MessageReaction[] {
  const rest = reactions.filter((r) => r.emoji !== reaction.emoji || r.userId !== reaction.userId);
  return present ? [...rest, reaction] : rest;
}
