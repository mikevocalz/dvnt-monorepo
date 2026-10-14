/** In-memory Supabase fixture: exercises the real APIs without live users/tokens. */
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test, mock } from "node:test";
import * as nodeModule from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RoomMember } from "../../video/types";
import type { RoomComment } from "./comments";

const ROOM = "00000000-0000-4000-8000-000000000099";
const OTHER_ROOM = "00000000-0000-4000-8000-000000000088";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

class FixtureChannel {
  topic: string;
  removed = false;
  status?: (status: string, error?: Error) => void;
  blocked = false;
  bindings: Array<{ config: any; callback: (payload: any) => void }> = [];
  constructor(topic: string) { this.topic = topic; }
  on(_kind: string, config: any, callback: (payload: any) => void) {
    this.bindings.push({ config, callback });
    return this;
  }
  subscribe(callback: (status: string, error?: Error) => void) {
    this.status = callback;
    queueMicrotask(() => { if (!this.removed && !this.blocked) callback("SUBSCRIBED"); });
    return this;
  }
}

class Fixture {
  members = [
    this.member(1, "ba-host", "host"),
    this.member(2, "ba-guest", "participant"),
    this.member(3, "ba-secret", "participant", true),
  ];
  comments = [this.comment(1, "ba-host", "Welcome"), this.comment(2, "member:3", "Anonymous hello")];
  profiles = ["ba-host", "ba-guest", "ba-secret"].map((id) => ({ auth_id: id, username: id.slice(3), first_name: id.slice(3), avatar: { url: `${id}.png` }, verified: false }));
  channels = new Map<string, FixtureChannel[]>();
  queries: Array<{ viewer: string; table: string; columns: string; ids?: string[] }> = [];
  rosterCalls: Array<{ viewer: string; args: Record<string, unknown> }> = [];
  holdRoster = new Map<string, ReturnType<typeof deferred<void>>>();
  rosterError: Error | null = null;
  commentError: Error | null = null;
  blockWebsockets = false;
  member(id: number, userId: string, role: string, anonymous = false) {
    return { member_id: id, room_id: 99, user_id: userId, role, status: "active", hand_raised: false, joined_at: "2026-10-13T12:00:00Z", left_at: null, is_anonymous: anonymous, anon_label: anonymous ? "Anon 3" : null };
  }
  comment(id: number, handle: string, body: string, roomId = ROOM) {
    return { id, room_id: roomId, author_handle: handle, body, parent_id: null, root_id: null, depth: 0, mentions: [], created_at: new Date(Date.UTC(2026, 9, 13, 12, 0, id)).toISOString() };
  }
  client(viewer: string) {
    const fixture = this;
    return {
      functions: {
        async invoke(name: string, { body }: { body: Record<string, any> }) {
          assert.equal(name, "lynk-room-comment");
          if (body.action === "post") {
            const member = fixture.members.find((m) => m.user_id === viewer)!;
            const handle = member.is_anonymous ? `member:${member.member_id}` : viewer;
            const row = fixture.comment(Math.max(...fixture.comments.map((c) => c.id)) + 1, handle, body.body);
            fixture.comments.push(row);
            return { data: { ok: true, data: { comment: row } }, error: null };
          }
          assert.equal(body.action, "delete");
          fixture.comments = fixture.comments.filter((c) => c.id !== body.commentId);
          return { data: { ok: true, data: { deleted: true } }, error: null };
        },
      },
      from(table: string) {
        let columns = "";
        const filters: Array<[string, unknown]> = [];
        const orders: Array<[string, boolean]> = [];
        let ids: string[] | undefined;
        let limit = Infinity;
        let single = false;
        const query = {
          select(value: string) { columns = value; return query; },
          eq(key: string, value: unknown) { filters.push([key, value]); return query; },
          in(_key: string, value: string[]) { ids = value; return query; },
          order(key: string, value: { ascending: boolean }) { orders.push([key, value.ascending]); return query; },
          limit(value: number) { limit = value; return query; },
          single() { single = true; return query; },
          maybeSingle() { single = true; return query; },
          then(yes: (result: any) => unknown, no?: (error: any) => unknown) {
            return Promise.resolve().then(() => {
              fixture.queries.push({ viewer, table, columns, ids });
              if (table === "room_comments" && fixture.commentError) return { data: null, error: fixture.commentError };
              if (table === "room_comments" && !fixture.members.some((m) => m.user_id === viewer && m.status === "active")) return { data: null, error: new Error("Room admission required") };
              assert.ok(!columns.split(/\s*,\s*/).includes("author_id"), "private author_id must not be selected");
              let rows: any[] = table === "video_rooms" ? [{ id: 99, uuid: ROOM }]
                : table === "room_comments" ? fixture.comments.map((r) => ({ ...r }))
                : table === "users" ? fixture.profiles.filter((p) => !ids || ids.includes(p.auth_id))
                : assert.fail(`Unexpected table read: ${table}`);
              rows = rows.filter((row) => filters.every(([key, value]) => String(row[key]) === String(value)));
              rows.sort((a, b) => {
                for (const [key, ascending] of orders) {
                  const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
                  if (comparison) return ascending ? comparison : -comparison;
                }
                return 0;
              });
              rows = rows.slice(0, limit);
              return { data: single ? rows[0] ?? null : rows, error: null };
            }).then(yes, no);
          },
        };
        return query;
      },
      async rpc(name: string, args: Record<string, unknown>) {
        assert.equal(name, "lynk_room_roster");
        fixture.rosterCalls.push({ viewer, args });
        const admitted = fixture.members.some((m) => m.user_id === viewer && m.status === "active");
        const error = fixture.rosterError ?? (!admitted ? new Error("Room admission required") : null);
        const data = fixture.members.map((member) => ({ ...member, user_id: member.is_anonymous && member.user_id !== viewer ? `member:${member.member_id}` : member.user_id }));
        const hold = fixture.holdRoster.get(viewer);
        fixture.holdRoster.delete(viewer);
        if (hold) await hold.promise;
        return { data: error ? null : data, error };
      },
      removeChannel(channel: FixtureChannel) { channel.removed = true; return Promise.resolve("ok"); },
    };
  }
  freshChannel(viewer: string, prefix: string) {
    const channels = this.channels.get(viewer) ?? [];
    for (const channel of channels) {
      if (channel.topic === `realtime:${prefix}` || channel.topic.startsWith(`realtime:${prefix}:`)) channel.removed = true;
    }
    const channel = new FixtureChannel(`realtime:${prefix}:${channels.length + 1}`);
    channel.blocked = this.blockWebsockets;
    channels.push(channel);
    this.channels.set(viewer, channels);
    return channel;
  }
  emit(table: string, eventType: string, row: any) {
    const payload = { eventType, new: eventType === "DELETE" ? {} : row, old: eventType === "DELETE" ? row : {} };
    for (const channels of this.channels.values()) for (const channel of channels) {
      if (channel.removed) continue;
      for (const { config, callback } of channel.bindings) {
        if (config.table !== table || config.event !== eventType) continue;
        if (config.filter && config.filter !== `room_id=eq.${row.room_id}`) continue;
        callback(payload);
      }
    }
  }
  reconnect(viewer: string) {
    for (const channel of this.channels.get(viewer) ?? []) if (!channel.removed) channel.status?.("SUBSCRIBED");
  }
}

let fixture: Fixture;
// The repository's Node typings predate registerHooks; Node 24 runs this API.
const hooks = (nodeModule as any).registerHooks({
  resolve(specifier: string, context: { parentURL?: string }, next: (specifier: string, context: { parentURL?: string }) => { url: string }) {
    if (specifier === "react-native") {
      return { url: `data:text/javascript,${encodeURIComponent('export const Platform = { OS: "web" };')}`, shortCircuit: true };
    }
    if (["@dvnt/app/lib/supabase/client", "@dvnt/app/lib/supabase/realtime", "@dvnt/app/lib/auth/identity"].includes(specifier)) {
      const viewer = new URL(context.parentURL!).searchParams.get("viewer") ?? "ba-host";
      const source = `const fixture = () => globalThis.__lynkRealtimeFixture;
        export const supabase = { from: (...a) => fixture().client(${JSON.stringify(viewer)}).from(...a), rpc: (...a) => fixture().client(${JSON.stringify(viewer)}).rpc(...a), removeChannel: (...a) => fixture().client(${JSON.stringify(viewer)}).removeChannel(...a), functions: { invoke: (...a) => fixture().client(${JSON.stringify(viewer)}).functions.invoke(...a) } };
        export const freshChannel = (prefix) => fixture().freshChannel(${JSON.stringify(viewer)}, prefix);
        export const requireBetterAuthToken = async () => 'synthetic-fixture-session';`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate.href))) return { url: candidate.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const viewers = ["ba-host", "ba-guest", "ba-secret"];
const activeStops = new Set<() => void>();
function trackStop(stop: () => void) {
  const dispose = () => { stop(); activeStops.delete(dispose); };
  activeStops.add(dispose);
  return dispose;
}
const apis = await Promise.all(viewers.map(async (viewer) => {
  const video = (await import(new URL(`../../video/api.ts?viewer=${viewer}`, import.meta.url).href)).videoApi;
  const comments = await import(new URL(`./comments.ts?viewer=${viewer}`, import.meta.url).href);
  return {
    viewer,
    video: { ...video, subscribeToMembers: (...args: any[]) => trackStop(video.subscribeToMembers(...args)) },
    comments: { ...comments, subscribeToRoomComments: (...args: any[]) => trackStop(comments.subscribeToRoomComments(...args)) },
  };
}));
afterEach(() => { for (const stop of [...activeStops]) stop(); mock.restoreAll(); });
beforeEach(() => {
  fixture = new Fixture();
  (globalThis as any).__lynkRealtimeFixture = fixture;
  mock.method(console, "error", () => {});
});
after(() => { hooks.deregister(); mock.restoreAll(); delete (globalThis as any).__lynkRealtimeFixture; });

test("three admitted viewers get existing members/chat, masked anonymity, and live role/hand changes", async () => {
  const rosters = new Map<string, RoomMember[]>();
  const comments = new Map<string, RoomComment[]>();
  const stops: Array<() => void> = [];
  for (const api of apis) {
    stops.push(api.video.subscribeToMembers(ROOM, () => assert.fail("initial snapshot must not announce existing users"), { onSync: (rows: RoomMember[]) => rosters.set(api.viewer, rows) }));
    stops.push(api.comments.subscribeToRoomComments(ROOM, () => assert.fail("onSync owns snapshot delivery"), { onSync: (rows: RoomComment[]) => comments.set(api.viewer, rows), resolveAuthor: () => ({ username: "secret", displayName: "Secret identity", avatar: "private.png", isVerified: true }) }));
  }
  await settle();
  for (const viewer of viewers) {
    assert.equal(rosters.get(viewer)?.length, 3);
    const anonymous = rosters.get(viewer)!.find((m) => m.isAnonymous)!;
    assert.equal(anonymous.userId, viewer === "ba-secret" ? "ba-secret" : "member:3");
    assert.equal(anonymous.avatar, undefined);
    const message = comments.get(viewer)!.find((c) => c.id === 2)!;
    assert.equal(message.authorId, viewer === "ba-secret" ? "ba-secret" : "member:3");
    assert.equal(message.author?.displayName, "Anon 3");
    assert.equal(message.author?.avatar, "");
  }
  assert.ok(fixture.queries.filter((q) => q.table === "users").every((q) => !q.ids?.includes("ba-secret") && !q.ids?.some((id) => id.startsWith("member:"))));
  stops.forEach((stop) => stop());

  const updates: Array<[string, string]> = [];
  const stop = apis[0]!.video.subscribeToMembers(ROOM, (member: RoomMember, type: string) => updates.push([member.userId, type]), { onSync: (rows: RoomMember[]) => rosters.set("ba-host", rows) });
  await settle();
  fixture.members[1]!.role = "speaker";
  fixture.members[1]!.hand_raised = true;
  fixture.emit("video_room_members", "UPDATE", { id: 2, room_id: 99 });
  await settle();
  assert.equal(rosters.get("ba-host")![1]!.role, "speaker");
  assert.equal(rosters.get("ba-host")![1]!.handRaised, true);
  assert.deepEqual(updates, [["ba-guest", "UPDATE"]]);
  stop();
});

test("late join hydration cannot resurrect a named member after an id-only DELETE", async () => {
  const snapshots: RoomMember[][] = [];
  const changes: Array<[string, string]> = [];
  const stop = apis[0]!.video.subscribeToMembers(ROOM, (m: RoomMember, type: string) => changes.push([m.userId, type]), { onSync: (rows: RoomMember[]) => snapshots.push(rows) });
  await settle();
  const hold = deferred<void>();
  fixture.holdRoster.set("ba-host", hold);
  fixture.emit("video_room_members", "INSERT", { id: 2, room_id: 99 });
  fixture.members = fixture.members.filter((m) => m.member_id !== 2);
  fixture.emit("video_room_members", "DELETE", { id: 2 });
  hold.resolve();
  await settle();
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots.at(-1)!.map((m) => m.userId), ["ba-host", "member:3"]);
  assert.deepEqual(changes, [["ba-guest", "DELETE"]]);
  stop();
});

test("reconnect recovers missed joins, new comments and deletions for both viewers", async () => {
  const rosters = new Map<string, RoomMember[]>();
  const comments = new Map<string, RoomComment[]>();
  const stops: Array<() => void> = [];
  for (const api of apis.slice(0, 2)) {
    stops.push(api.video.subscribeToMembers(ROOM, () => {}, { onSync: (rows: RoomMember[]) => rosters.set(api.viewer, rows) }));
    stops.push(api.comments.subscribeToRoomComments(ROOM, () => {}, { onSync: (rows: RoomComment[]) => comments.set(api.viewer, rows) }));
  }
  await settle();
  fixture.members.push(fixture.member(4, "ba-new", "participant"));
  fixture.comments = [fixture.comments[1]!, fixture.comment(3, "ba-guest", "While offline")];
  fixture.reconnect("ba-host");
  fixture.reconnect("ba-guest");
  await settle();
  for (const viewer of viewers.slice(0, 2)) {
    assert.equal(rosters.get(viewer)?.length, 4);
    assert.deepEqual(comments.get(viewer)?.map((c) => c.id), [2, 3]);
  }
  stops.forEach((stop) => stop());
});

test("chat loads the newest 200 in stable chronological order and scopes snapshots to the room", async () => {
  fixture.comments = Array.from({ length: 205 }, (_, i) => fixture.comment(i + 1, "ba-host", `Message ${i + 1}`));
  fixture.comments.push(fixture.comment(999, "ba-host", "Other room", OTHER_ROOM));
  const comments = await apis[0]!.comments.fetchRoomComments(ROOM);
  assert.equal(comments.length, 200);
  assert.equal(comments[0].id, 6);
  assert.equal(comments.at(-1).id, 205);
  const snapshots: RoomComment[][] = [];
  const stop = apis[0]!.comments.subscribeToRoomComments(ROOM, () => {}, { onSync: (rows: RoomComment[]) => snapshots.push(rows) });
  await settle();
  fixture.comments = fixture.comments.filter((c) => c.id !== 205);
  fixture.emit("room_comments", "DELETE", { id: 205 });
  await settle();
  assert.equal(snapshots.at(-1)!.at(-1)!.id, 204);
  assert.equal(snapshots.at(-1)![0]!.id, 5);
  stop();
});

test("concurrent subscriptions do not sweep each other and cleanup discards late author hydration", async () => {
  const snapshots: RoomMember[][] = [];
  const first = apis[0]!.video.subscribeToMembers(ROOM, () => {}, { onSync: (rows: RoomMember[]) => snapshots.push(rows) });
  const second = apis[0]!.video.subscribeToMembers(ROOM, () => {}, { onSync: (rows: RoomMember[]) => snapshots.push(rows) });
  await settle();
  assert.equal(snapshots.length, 2);
  assert.equal(fixture.channels.get("ba-host")!.filter((c) => !c.removed).length, 2);
  first(); second();
  const hold = deferred<void>();
  fixture.holdRoster.set("ba-host", hold);
  let calls = 0;
  const stop = apis[0]!.comments.subscribeToRoomComments(ROOM, () => calls++, { onSync: () => calls++, onError: () => calls++ });
  await settle();
  stop();
  hold.resolve();
  await settle();
  assert.equal(calls, 0);
});

test("read errors propagate instead of replacing a healthy roster/chat with success-empty", async () => {
  const rosterError = new Error("Roster permission denied");
  fixture.rosterError = rosterError;
  await assert.rejects(apis[0]!.video.getRoomMembers(ROOM), (error: unknown) => error === rosterError);
  fixture.rosterError = null;
  const snapshots: RoomComment[][] = [];
  const errors: unknown[] = [];
  const stop = apis[0]!.comments.subscribeToRoomComments(ROOM, () => {}, { onSync: (rows: RoomComment[]) => snapshots.push(rows), onError: (error: unknown) => errors.push(error) });
  await settle();
  const commentError = new Error("Comment read offline");
  fixture.commentError = commentError;
  fixture.emit("room_comments", "INSERT", { id: 3, room_id: ROOM });
  await settle();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]!.length, 2);
  assert.deepEqual(errors, [commentError]);
  stop();
});

test("latest-window replies remain visible when their old root is outside the window", async () => {
  const comment = (id: number, changes: Partial<RoomComment> = {}): RoomComment => ({ id, roomId: ROOM, authorId: "ba-host", body: `Message ${id}`, parentId: null, rootId: null, depth: 0, mentions: [], createdAt: "2026-10-13T12:00:00Z", ...changes });
  const orphan = comment(200, { parentId: 1, rootId: 1, depth: 1 });
  const root = comment(201);
  const reply = comment(202, { parentId: 201, rootId: 201, depth: 1 });
  const threads = apis[0]!.comments.buildCommentThreads([orphan, root, reply]);
  assert.deepEqual(threads.map((c: RoomComment) => c.id), [200, 201]);
  assert.equal(threads[0].rootId, 1);
  assert.equal(threads[0].parentId, 1);
  assert.equal(threads[0].depth, 1);
  assert.deepEqual(threads[1].replies.map((c: RoomComment) => c.id), [202]);
});

test("a local POST invalidates an older hydrated snapshot even before its realtime echo", async () => {
  const snapshots: RoomComment[][] = [];
  const hold = deferred<void>();
  fixture.holdRoster.set("ba-host", hold);
  const stop = apis[0]!.comments.subscribeToRoomComments(ROOM, () => {}, { onSync: (rows: RoomComment[]) => snapshots.push(rows) });
  await settle();
  const saved = await apis[0]!.comments.postRoomComment({ roomId: ROOM, authorId: "ba-host", body: "Just posted" });
  assert.equal(saved.id, 3);
  hold.resolve();
  await settle();
  assert.deepEqual(snapshots.map((snapshot) => snapshot.map((c) => c.id)), [[1, 2, 3]]);
  await apis[0]!.comments.deleteRoomComment({ roomId: ROOM, commentId: 3 });
  await settle();
  assert.deepEqual(snapshots.at(-1)!.map((c) => c.id), [1, 2]);
  stop();
});

test("blocked websocket handshakes do not block admitted room roster or chat reads", async () => {
  fixture.blockWebsockets = true;
  const rosters: RoomMember[][] = [];
  const comments: RoomComment[][] = [];
  const stopMembers = apis[0]!.video.subscribeToMembers(ROOM, () => {}, { onSync: (rows: RoomMember[]) => rosters.push(rows) });
  const stopComments = apis[0]!.comments.subscribeToRoomComments(ROOM, () => {}, { onSync: (rows: RoomComment[]) => comments.push(rows) });
  await settle();
  assert.equal(rosters.at(-1)!.length, 3);
  assert.equal(comments.at(-1)!.length, 2);
  stopMembers(); stopComments();
});
