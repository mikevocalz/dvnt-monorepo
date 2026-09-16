/**
 * Shared direct-conversation write path.
 *
 * create-conversation (client, session-verified) and the brand outbox worker
 * (server, cron-authenticated) both go through here, so an automated DM lands
 * on the same conversations + conversations_rels rows a person's DM does.
 * Neither caller writes a messages row without a membership row.
 *
 * send-message still owns the client send. Push fan-out, media metadata and
 * operation-id replay live there and the worker needs none of them.
 * ponytail: postConversationMessage is the minimum write — membership check,
 * insert, last_message_at. If the worker ever needs push or media, move
 * send-message's body in here rather than copying it.
 */

type Db = {
  from: (table: string) => any;
};

export type ConversationResult =
  | { ok: true; conversationId: number; isNew: boolean }
  | { ok: false; error: string };

/** Find the existing direct conversation between two auth ids, or create it. */
export async function ensureDirectConversation(
  supabase: Db,
  authIdA: string,
  authIdB: string,
): Promise<ConversationResult> {
  const { data: convsA } = await supabase
    .from("conversations_rels")
    .select("parent_id")
    .eq("users_id", authIdA);

  const { data: convsB } = await supabase
    .from("conversations_rels")
    .select("parent_id")
    .eq("users_id", authIdB);

  const idsA = (convsA || []).map((c: any) => c.parent_id);
  const idsB = (convsB || []).map((c: any) => c.parent_id);
  const commonIds = idsA.filter((id: number) => idsB.includes(id));

  for (const convId of commonIds) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, is_group")
      .eq("id", convId)
      .single();

    if (conv && !conv.is_group) {
      // Both participants must really be on the row. An orphaned conversation
      // with missing participant rows is skipped, not reused.
      const { data: participants } = await supabase
        .from("conversations_rels")
        .select("users_id")
        .eq("parent_id", conv.id)
        .eq("path", "participants");

      const participantIds = (participants || []).map((p: any) => p.users_id);
      if (
        participantIds.includes(authIdA) &&
        participantIds.includes(authIdB)
      ) {
        return { ok: true, conversationId: conv.id, isNew: false };
      }
      console.log(
        `[conversation-delivery] Skipping orphaned conversation ${conv.id}`,
      );
    }
  }

  const { data: newConv, error: convError } = await supabase
    .from("conversations")
    .insert({ is_group: false, last_message_at: new Date().toISOString() })
    .select()
    .single();

  if (convError || !newConv) {
    return { ok: false, error: "Failed to create conversation" };
  }

  const { error: participantsError } = await supabase
    .from("conversations_rels")
    .insert([
      { parent_id: newConv.id, users_id: authIdA, path: "participants" },
      { parent_id: newConv.id, users_id: authIdB, path: "participants" },
    ]);

  if (participantsError) {
    console.error(
      "[conversation-delivery] Failed to add participants:",
      participantsError,
    );
    await supabase.from("conversations").delete().eq("id", newConv.id);
    return { ok: false, error: "Failed to add participants to conversation" };
  }

  return { ok: true, conversationId: newConv.id, isNew: true };
}

export type MessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/** Post to a conversation the sender is already a member of. */
export async function postConversationMessage(
  supabase: Db,
  args: {
    conversationId: number;
    senderAuthId: string;
    senderId: number;
    content: string;
    metadata?: Record<string, unknown>;
  },
): Promise<MessageResult> {
  const { data: membership } = await supabase
    .from("conversations_rels")
    .select("id")
    .eq("parent_id", args.conversationId)
    .eq("users_id", args.senderAuthId)
    .single();

  if (!membership) {
    return { ok: false, error: "Sender is not a member of this conversation" };
  }

  const sentAt = new Date().toISOString();
  const payload: Record<string, unknown> = {
    conversation_id: args.conversationId,
    sender_id: args.senderId,
    content: args.content,
  };
  if (args.metadata && Object.keys(args.metadata).length > 0) {
    payload.metadata = args.metadata;
  }

  const { data: message, error: insertError } = await supabase
    .from("messages")
    .insert(payload)
    .select()
    .single();

  if (insertError || !message) {
    console.error("[conversation-delivery] Insert error:", insertError);
    return { ok: false, error: "Failed to send message" };
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: sentAt })
    .eq("id", args.conversationId);

  return { ok: true, messageId: String(message.id) };
}
