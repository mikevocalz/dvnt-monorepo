import type { RealtimeChannel } from "@supabase/supabase-js";

/** Attach before subscribe; callers own channel lifecycle and refetch under current RLS. */
export function bindMessageChanges(
  channel: RealtimeChannel,
  viewerId: string,
  onChange: () => void,
  conversationId?: string,
): RealtimeChannel {
  if (!/^[1-9]\d*$/.test(viewerId)) throw new Error("Invalid message viewer ID");
  if (conversationId !== undefined && !/^[1-9]\d*$/.test(conversationId)) throw new Error("Invalid conversation ID");
  return channel
    .on("postgres_changes", {
      event: "*", schema: "public", table: "messages",
      ...(conversationId ? { filter: `conversation_id=eq.${conversationId}` } : {}),
    }, onChange)
    .on("postgres_changes", {
      event: "*", schema: "public", table: "conversation_reads", filter: `user_id=eq.${viewerId}`,
    }, onChange);
}
