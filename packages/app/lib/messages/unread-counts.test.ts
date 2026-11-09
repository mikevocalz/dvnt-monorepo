import test from "node:test";
import assert from "node:assert/strict";
import { fetchUnreadConversationCounts } from "./unread-counts.ts";

type Row = Record<string, any>;
function fixture(tables: Record<string, Row[]>, errorTable?: string, missingTable?: string) {
  const calls: { table: string; range?: number[]; limit?: number }[] = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const client = { from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let start = 0, end = 999, limit: number | undefined;
    const call: typeof calls[number] = { table }; calls.push(call);
    const query: any = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      neq(key: string, value: unknown) { filters.push(row => row[key] !== value); return query; },
      gt(key: string, value: unknown) { filters.push(row => row[key] > value!); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      or() { return query; }, order() { return query; },
      range(a: number, b: number) { start = a; end = b; call.range = [a, b]; return query; },
      limit(value: number) { limit = value; call.limit = value; return query; },
      async then(resolve: any, reject: any) {
        inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise(r => setTimeout(r, 0)); inFlight--;
        const data = tables[table]?.filter(row => filters.every(fn => fn(row))).slice(start, end + 1).slice(0, limit) ?? [];
        return Promise.resolve({ data: missingTable === table ? null : data, error: errorTable === table ? new Error("Synthetic unavailable") : null }).then(resolve, reject);
      },
    };
    return query;
  } };
  return { client: client as any, calls, max: () => maximumInFlight };
}
const member = (id: number, isGroup = false) => ({ parent_id: id, users_id: "viewer", conversation: { id, is_group: isGroup } });
const partner = (id: number, userId: number) => ({ parent_id: id, users_id: `auth-${userId}` });
const msg = (conversationId: number, senderId: number, createdAt = "2026-10-10") => ({ id: 1, conversation_id: conversationId, sender_id: senderId, created_at: createdAt });

test("1200 recent messages in one thread cannot hide an older unread thread", async () => {
  const h = fixture({
    conversations_rels: [member(1), member(2), partner(1, 2), partner(2, 3)],
    messages: [...Array.from({ length: 1200 }, () => msg(1, 2, "2026-10-20")), msg(2, 3, "2026-10-01")],
    follows: [{ follower_id: 1, following_id: 2 }, { follower_id: 1, following_id: 3 }],
    users: [{ id: 2, auth_id: "auth-2" }, { id: 3, auth_id: "auth-3" }],
  });
  assert.deepEqual(await fetchUnreadConversationCounts(h.client, "viewer", 1), { inbox: 2, spam: 0, inboxConversationIds: ["1", "2"], spamConversationIds: [] });
  assert.ok(h.calls.filter(c => c.table === "messages").every(c => c.limit === 1));
});

test("groups/followed inbox, requests separate, blocks excluded, own/read messages absent", async () => {
  const h = fixture({
    conversations_rels: [member(1), member(2), member(3), member(4, true), member(5), member(6), ...[1,2,3,5,6].map(id=>partner(id,id+10))],
    messages: [msg(1,11),msg(2,12),msg(3,13),msg(4,14),msg(5,1),msg(6,16,"2026-10-01")],
    conversation_reads: [{user_id:1,conversation_id:6,last_read_at:"2026-10-02"}],
    follows: [{follower_id:1,following_id:11},{follower_id:1,following_id:13}],
    blocks: [{id:1,blocker_id:13,blocked_id:1}],
    users: [11,12,13,15,16].map(id=>({id,auth_id:`auth-${id}`})),
  });
  assert.deepEqual(await fetchUnreadConversationCounts(h.client,"viewer",1),{inbox:2,spam:1,inboxConversationIds:["1","4"],spamConversationIds:["2"]});
  assert.ok(h.max()<=4,'existence reads bounded to four');
});

test("membership, cursors, follows and users traverse page boundaries; conversation IDs dedupe", async () => {
  const ids = Array.from({length:205},(_,i)=>i+1);
  const h=fixture({
    conversations_rels: [...ids.map(id=>member(id)),member(1),...ids.map(id=>partner(id,id+1000))],
    messages: ids.map(id=>msg(id,id+1000)),
    conversation_reads: ids.map(id=>({user_id:1,conversation_id:id,last_read_at:'2026-01-01'})),
    follows: ids.map(id=>({follower_id:1,following_id:id+1000})),
    users: ids.map(id=>({id:id+1000,auth_id:`auth-${id+1000}`})),
  });
  assert.deepEqual(await fetchUnreadConversationCounts(h.client,'viewer',1),{inbox:205,spam:0,inboxConversationIds:ids.map(String).sort(),spamConversationIds:[]});
  assert.ok(h.calls.some(c=>c.table==='conversations_rels'&&c.range?.[0]===200));
  assert.ok(h.calls.some(c=>c.table==='conversation_reads'&&c.range?.[0]===200));
  assert.ok(h.calls.some(c=>c.table==='follows'&&c.range?.[0]===200));
});

test("partial errors reject rather than fabricate zero or misclassify requests", async () => {
  const tables={conversations_rels:[member(1),partner(1,2)],messages:[msg(1,2)],users:[{id:2,auth_id:'auth-2'}]};
  for(const table of ['conversations_rels','messages','conversation_reads','follows','blocks','users']){
    const h=fixture(tables,table);
    await assert.rejects(fetchUnreadConversationCounts(h.client,'viewer',1),/Synthetic unavailable/);
  }
  await assert.rejects(fetchUnreadConversationCounts(fixture(tables,undefined,'messages').client,'viewer',1),/unavailable/);
});

test("empty account is confirmed zero and does not fetch message bodies", async () => {
  const h=fixture({});
  assert.deepEqual(await fetchUnreadConversationCounts(h.client,'viewer',1),{inbox:0,spam:0,inboxConversationIds:[],spamConversationIds:[]});
  assert.equal(h.calls.filter(c=>c.table==='messages').length,0);
});


test("orphan or deleted direct participants do not freeze unrelated badge totals", async () => {
  const h=fixture({conversations_rels:[member(1),member(2),member(3,true),partner(1,2)],messages:[msg(1,2),msg(2,9),msg(3,7)]});
  assert.deepEqual(await fetchUnreadConversationCounts(h.client,'viewer',1),{inbox:1,spam:0,inboxConversationIds:['3'],spamConversationIds:[]});
});
