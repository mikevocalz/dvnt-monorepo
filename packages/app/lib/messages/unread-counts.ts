import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 200;
const CONCURRENCY = 4;

export interface UnreadConversationCounts {
  inbox: number;
  spam: number;
  // Enables exact, idempotent local reconciliation without trusting old lists.
  inboxConversationIds: string[];
  spamConversationIds: string[];
}

function snapshot(inboxIds: string[], spamIds: string[]): UnreadConversationCounts {
  return {
    inbox: inboxIds.length, spam: spamIds.length,
    inboxConversationIds: inboxIds.sort(), spamConversationIds: spamIds.sort(),
  };
}

/** Paginate metadata, never a global messages scan (one busy thread can fill it). */
async function allRows(query: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Unread metadata unavailable");
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Authoritative unread-conversation totals under the current viewer's RLS.
 * Each conversation uses an indexed existence read, so >1000 recent messages
 * in one thread cannot hide another thread's unread message. No history bodies
 * or participant names are fetched. Failed/partial reads reject, never zero.
 */
export async function fetchUnreadConversationCounts(
  client: SupabaseClient,
  authId: string,
  viewerId: number,
): Promise<UnreadConversationCounts> {
  const [memberships, reads] = await Promise.all([
    allRows(() => client.from("conversations_rels")
      .select("parent_id,conversation:parent_id(id,is_group)")
      .eq("users_id", authId).order("parent_id")),
    allRows(() => client.from("conversation_reads")
      .select("conversation_id,last_read_at")
      .eq("user_id", viewerId).order("conversation_id")),
  ]);
  const conversations = [...new Map<number, { id: number; isGroup: boolean }>(
    memberships.filter(row => row.conversation?.id != null).map(row => [
      Number(row.parent_id),
      { id: Number(row.parent_id), isGroup: !!row.conversation.is_group },
    ]),
  ).values()];
  const cursors = new Map(reads.map(row => [Number(row.conversation_id), row.last_read_at]));
  const unread: typeof conversations = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, conversations.length) }, async () => {
    while (index < conversations.length) {
      const conversation = conversations[index++];
      let query = client.from("messages").select("id")
        .eq("conversation_id", conversation.id).neq("sender_id", viewerId);
      const cursor = cursors.get(conversation.id);
      if (cursor) query = query.gt("created_at", cursor);
      const { data, error } = await query.limit(1);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Unread message state unavailable");
      if (data.length > 0) unread.push(conversation);
    }
  }));
  const directIds = unread.filter(row => !row.isGroup).map(row => row.id);
  const inboxIds = unread.filter(row => row.isGroup).map(row => String(row.id));
  const spamIds: string[] = [];
  if (directIds.length === 0) return snapshot(inboxIds, spamIds);

  const [follows, blocks] = await Promise.all([
    allRows(() => client.from("follows").select("following_id")
      .eq("follower_id", viewerId).order("following_id")),
    allRows(() => client.from("blocks").select("id,blocker_id,blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`).order("id")),
  ]);
  const followed = new Set(follows.map(row => String(row.following_id)));
  const blocked = new Set(blocks.map(row => String(
    Number(row.blocker_id) === viewerId ? row.blocked_id : row.blocker_id,
  )));
  for (let offset = 0; offset < directIds.length; offset += PAGE_SIZE) {
    const ids = directIds.slice(offset, offset + PAGE_SIZE);
    const participants = await allRows(() => client.from("conversations_rels")
      .select("parent_id,users_id").in("parent_id", ids).neq("users_id", authId)
      .order("parent_id").order("users_id"));
    const authIds = [...new Set(participants.map(row => row.users_id))];
    const userIds = new Map<string, string>();
    for (let userOffset = 0; userOffset < authIds.length; userOffset += PAGE_SIZE) {
      const users = await allRows(() => client.from("users").select("id,auth_id")
        .in("auth_id", authIds.slice(userOffset, userOffset + PAGE_SIZE)).order("id"));
      for (const user of users) userIds.set(user.auth_id, String(user.id));
    }
    for (const id of ids) {
      const participant = participants.find(row => Number(row.parent_id) === id);
      const userId = participant && userIds.get(participant.users_id);
      // Deleted/orphan participants cannot be opened as a valid direct thread.
      // Exclude them rather than freezing every unrelated badge forever.
      if (!userId) continue;
      if (blocked.has(userId)) continue;
      if (followed.has(userId)) inboxIds.push(String(id));
      else spamIds.push(String(id));
    }
  }
  return snapshot(inboxIds, spamIds);
}
