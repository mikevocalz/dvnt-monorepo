/**
 * Room Comments API
 * Threaded Sneaky Lynk room chat: read, real-time subscription, and writes.
 *
 * Writes go through the lynk-room-comment edge function; clients have no
 * write privilege on room_comments and cannot read its author_id (migration
 * 20261003150300). Rows carry author_handle, resolved against the room roster
 * in comment-anonymity.ts.
 */

import { supabase } from "@dvnt/app/lib/supabase/client";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import {
  bindRoomSnapshotChanges,
  createRoomSnapshotSync,
} from "./room-snapshot-sync";
import {
  isMemberHandle,
  resolveCommentAuthor,
  type RosterRow,
} from "./comment-anonymity";

/** Columns a client may read. author_id is not granted. */
const COMMENT_COLUMNS =
  "id, room_id, author_handle, body, parent_id, root_id, depth, mentions, created_at";

// Local writes can beat their realtime echo while an older snapshot is still
// hydrating authors. Invalidate those reads as soon as the write is confirmed.
const commentInvalidators = new Map<string, Set<() => void>>();
function invalidateRoomComments(roomId: string) {
  for (const invalidate of commentInvalidators.get(roomId) ?? []) invalidate();
}

// ── Types ────────────────────────────────────────────────────────────

export interface Mention {
  userId: string;
  username: string;
  /** Character offset in body where @mention starts */
  start: number;
  /** Character offset in body where @mention ends */
  end: number;
}

export interface RoomComment {
  id: number;
  roomId: string;
  /** The author's auth id when they are named or are the viewer, otherwise
   *  their `member:<id>` handle. Pass it as targetUserId to kick/ban. */
  authorId: string;
  body: string;
  parentId: number | null;
  rootId: number | null;
  depth: number;
  mentions: Mention[];
  createdAt: string;
  // Joined from users table
  author?: {
    username: string;
    displayName: string;
    avatar: string;
    isVerified: boolean;
    /** Anonymity is per-ROOM (video_room_members), not per-user. Carried on the
     *  author so every chat surface can resolve the label through
     *  lib/user-label instead of guessing from the name fields. */
    isAnonymous?: boolean;
    anonLabel?: string | null;
  };
  // Client-side only
  replies?: RoomComment[];
  isOptimistic?: boolean;
}

export type RoomCommentAuthor = NonNullable<RoomComment["author"]>;

/** Roster for a room addressed by uuid (room_comments.room_id), or null. */
async function fetchRoomRoster(roomUuid: string): Promise<RosterRow[] | null> {
  const { data: room, error: roomError } = await supabase
    .from("video_rooms")
    .select("id")
    .eq("uuid", roomUuid)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room?.id) throw new Error("Room not found or access unavailable");
  const { data, error } = await supabase.rpc("lynk_room_roster", {
    p_room_id: room.id,
  });
  if (error) throw error;
  return (data as RosterRow[] | null) ?? null;
}

function anonymousAuthor(anonLabel: string | null): RoomCommentAuthor {
  const label = anonLabel || "Anonymous";
  return {
    username: label,
    displayName: label,
    avatar: "",
    isVerified: false,
    isAnonymous: true,
    anonLabel,
  };
}

// ── Fetch comments for a room ────────────────────────────────────────

export async function fetchRoomComments(
  roomId: string,
): Promise<RoomComment[]> {
  const { data, error } = await supabase
    .from("room_comments")
    .select(COMMENT_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);

  if (error) throw error;
  // Limit the newest messages first, then render them in chronological order.
  const rows = ((data || []) as any[]).slice().reverse();
  if (rows.length === 0) return [];

  // Anonymity is per ROOM (video_room_members.is_anonymous), and the handle
  // on each row only resolves against this room's roster.
  const roster = await fetchRoomRoster(roomId);
  const resolved = new Map(
    [...new Set(rows.map((r) => r.author_handle as string))].map((h) => [
      h,
      resolveCommentAuthor(roster, h),
    ]),
  );
  const namedIds = [...resolved.values()]
    .filter((r) => !r.isAnonymous && !isMemberHandle(r.authorId))
    .map((r) => r.authorId);

  const authorsMap: Record<string, any> = {};
  if (namedIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("auth_id, username, first_name, avatar:avatar_id(url), verified")
      .in("auth_id", namedIds);
    if (usersError) throw usersError;
    for (const u of users || []) authorsMap[u.auth_id] = u;
  }

  return rows.map((row) => {
    const who = resolved.get(row.author_handle)!;
    const user = who.isAnonymous ? undefined : authorsMap[who.authorId];
    return {
      ...toRoomComment(row, who.authorId),
      author: who.isAnonymous
        ? anonymousAuthor(who.anonLabel)
        : user
          ? {
              username: user.username || "unknown",
              displayName: user.first_name || user.username || "unknown",
              avatar: (user.avatar as any)?.url || "",
              isVerified: user.verified || false,
              isAnonymous: false,
              anonLabel: null,
            }
          : undefined,
    };
  });
}

function toRoomComment(row: any, authorId: string): RoomComment {
  return {
    id: row.id,
    roomId: row.room_id,
    authorId,
    body: row.body,
    parentId: row.parent_id ?? null,
    rootId: row.root_id ?? null,
    depth: row.depth ?? 0,
    mentions: row.mentions || [],
    createdAt: row.created_at,
  };
}

/** POST to lynk-room-comment with the Better Auth token. */
async function invokeRoomComment<T>(
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const token = await requireBetterAuthToken();
    const { data, error } = await supabase.functions.invoke("lynk-room-comment", {
      body,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) return { ok: false, message: error.message || "Edge function error" };
    if (!data?.ok) return { ok: false, message: data?.error?.message || "Request failed" };
    return { ok: true, data: data.data as T };
  } catch (err: any) {
    return { ok: false, message: err?.message || "Request failed" };
  }
}

// ── Post a comment ───────────────────────────────────────────────────

export async function postRoomComment(params: {
  roomId: string;
  /** The local user's auth id. Not sent: the server takes the author from
   *  the session. Used as the returned comment's authorId so "is this mine"
   *  checks keep working for anonymous senders. */
  authorId: string;
  body: string;
  parentId?: number | null;
  /** Ignored: the server derives thread position from parentId. */
  rootId?: number | null;
  /** Ignored: the server derives thread position from parentId. */
  depth?: number;
  mentions?: Mention[];
  author?: RoomCommentAuthor;
}): Promise<RoomComment | null> {
  const res = await invokeRoomComment<{ comment: any }>({
    action: "post",
    roomId: params.roomId,
    body: params.body,
    parentId: params.parentId || null,
    mentions: params.mentions || [],
  });
  if (!res.ok) {
    console.error("[RoomComments] post error:", res.message);
    return null;
  }
  invalidateRoomComments(params.roomId);
  return { ...toRoomComment(res.data.comment, params.authorId), author: params.author };
}

/**
 * Delete a message. Allowed for its author and for room moderators; the
 * server checks both. To ban the author, pass `comment.authorId` (a handle for
 * anonymous authors) to videoApi.banUser, which resolves it inside the room.
 */
export async function deleteRoomComment(params: {
  roomId: string;
  commentId: number;
}): Promise<boolean> {
  const res = await invokeRoomComment<{ deleted: boolean }>({
    action: "delete",
    roomId: params.roomId,
    commentId: params.commentId,
  });
  if (!res.ok) {
    console.error("[RoomComments] delete error:", res.message);
    return false;
  }
  invalidateRoomComments(params.roomId);
  return true;
}

// ── Real-time subscription ───────────────────────────────────────────

let commentSubscriptionId = 0;

/** Subscribe after admission; onSync is authoritative, including removals. */
export function subscribeToRoomComments(
  roomId: string,
  onNewComment: (comment: RoomComment) => void,
  options?: {
    resolveAuthor?: (authorId: string) => RoomCommentAuthor | undefined;
    onDeleted?: (commentId: number) => void;
    onSync?: (comments: RoomComment[]) => void;
    onError?: (error: unknown) => void;
  },
): () => void {
  let cancelled = false;
  let previous: RoomComment[] = [];
  const reportError = (error: unknown) => {
    if (cancelled) return;
    console.error("[RoomComments] sync failed:", error);
    options?.onError?.(error);
  };
  const sync = createRoomSnapshotSync({
    load: () => fetchRoomComments(roomId),
    onError: reportError,
    onSnapshot: (snapshot) => {
      const comments = snapshot.map((comment) => ({
        ...comment,
        // A cached profile can never name an anonymous author.
        author: comment.author?.isAnonymous
          ? comment.author
          : (options?.resolveAuthor?.(comment.authorId) ?? comment.author),
      }));
      if (options?.onSync) {
        options.onSync(comments);
      } else {
        const before = new Set(previous.map((comment) => comment.id));
        const after = new Set(comments.map((comment) => comment.id));
        for (const comment of comments) {
          if (!before.has(comment.id)) onNewComment(comment);
        }
        for (const comment of previous) {
          if (!after.has(comment.id)) options?.onDeleted?.(comment.id);
        }
      }
      previous = comments;
    },
  });
  const channel = bindRoomSnapshotChanges(
    freshChannel(`room-comments:${roomId}:consumer-${++commentSubscriptionId}`),
    "room_comments",
    roomId,
    sync.invalidate,
  ).subscribe((status, error) => {
    if (cancelled) return;
    // Taking the first snapshot after subscription closes the fetch/listen
    // gap; every reconnect also recovers events missed while disconnected.
    if (status === "SUBSCRIBED") sync.invalidate();
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      reportError(error ?? new Error(`Comment subscription ${status.toLowerCase()}`));
    }
  });
  const invalidators = commentInvalidators.get(roomId) ?? new Set<() => void>();
  invalidators.add(sync.invalidate);
  commentInvalidators.set(roomId, invalidators);
  sync.invalidate();

  return () => {
    if (cancelled) return;
    cancelled = true;
    sync.stop();
    invalidators.delete(sync.invalidate);
    if (invalidators.size === 0) commentInvalidators.delete(roomId);
    void supabase.removeChannel(channel);
  };
}

// ── Thread builder ───────────────────────────────────────────────────

/** Build threaded comment tree from flat list. Max 2 levels. */
export function buildCommentThreads(comments: RoomComment[]): RoomComment[] {
  const rootComments: RoomComment[] = [];
  const repliesByRootId = new Map<number, RoomComment[]>();
  const visibleRoots = new Set(comments.filter((comment) => comment.depth === 0).map((comment) => comment.id));

  for (const comment of comments) {
    if (comment.depth === 0) {
      rootComments.push({ ...comment, replies: [] });
    } else {
      const rootId = comment.rootId ?? comment.parentId;
      if (rootId == null || !visibleRoots.has(rootId)) {
        // The latest-message window can exclude an older thread root. Keep
        // its in-window replies visible without inventing a parent or changing
        // their server metadata (reply/moderation actions still need it).
        rootComments.push({ ...comment, replies: [] });
      } else {
        if (!repliesByRootId.has(rootId)) {
          repliesByRootId.set(rootId, []);
        }
        repliesByRootId.get(rootId)!.push(comment);
      }
    }
  }

  // Attach replies to their root comments
  for (const root of rootComments) {
    root.replies = repliesByRootId.get(root.id) || [];
  }

  return rootComments;
}
