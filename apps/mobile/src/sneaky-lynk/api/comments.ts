/**
 * Room Comments API
 * CRUD + real-time subscription for threaded room comments.
 * Uses Supabase directly (no edge function needed for simple CRUD).
 */

import { supabase } from "@/lib/supabase/client";
import type { SneakyUser } from "../types";

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
  };
  // Client-side only
  replies?: RoomComment[];
  isOptimistic?: boolean;
}

export type RoomCommentAuthor = NonNullable<RoomComment["author"]>;

async function lookupRoomCommentAuthor(
  authorId: string,
): Promise<RoomCommentAuthor | undefined> {
  const { data: userData } = await supabase
    .from("users")
    .select("username, first_name, avatar:avatar_id(url), verified")
    .eq("auth_id", authorId)
    .single();

  if (!userData) return undefined;

  return {
    username: userData.username || "unknown",
    displayName: userData.first_name || userData.username || "unknown",
    avatar: (userData.avatar as any)?.url || "",
    isVerified: userData.verified || false,
  };
}

// ── Fetch comments for a room ────────────────────────────────────────

export async function fetchRoomComments(
  roomId: string,
): Promise<RoomComment[]> {
  const { data, error } = await supabase
    .from("room_comments")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[RoomComments] fetch error:", error.message);
    return [];
  }

  // Batch-lookup authors
  const authorIds = [...new Set((data || []).map((c: any) => c.author_id))];
  let authorsMap: Record<string, any> = {};
  if (authorIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select(
        "id, auth_id, username, first_name, avatar:avatar_id(url), verified",
      )
      .in("auth_id", authorIds);
    if (users) {
      for (const u of users) {
        authorsMap[u.auth_id] = u;
      }
    }
  }

  return (data || []).map((row: any) => {
    const author = authorsMap[row.author_id];
    return {
      id: row.id,
      roomId: row.room_id,
      authorId: row.author_id,
      body: row.body,
      parentId: row.parent_id,
      rootId: row.root_id,
      depth: row.depth,
      mentions: row.mentions || [],
      createdAt: row.created_at,
      author: author
        ? {
            username: author.username || "unknown",
            displayName: author.first_name || author.username || "unknown",
            avatar: (author.avatar as any)?.url || "",
            isVerified: author.verified || false,
          }
        : undefined,
    };
  });
}

// ── Post a comment ───────────────────────────────────────────────────

export async function postRoomComment(params: {
  roomId: string;
  authorId: string;
  body: string;
  parentId?: number | null;
  rootId?: number | null;
  depth?: number;
  mentions?: Mention[];
  author?: RoomCommentAuthor;
}): Promise<RoomComment | null> {
  const { data, error } = await supabase
    .from("room_comments")
    .insert({
      room_id: params.roomId,
      author_id: params.authorId,
      body: params.body,
      parent_id: params.parentId || null,
      root_id: params.rootId || null,
      depth: params.depth || 0,
      mentions: params.mentions || [],
    })
    .select()
    .single();

  if (error) {
    console.error("[RoomComments] post error:", error.message);
    return null;
  }

  return {
    id: data.id,
    roomId: data.room_id,
    authorId: data.author_id,
    body: data.body,
    parentId: data.parent_id,
    rootId: data.root_id,
    depth: data.depth,
    mentions: data.mentions || [],
    createdAt: data.created_at,
    author: params.author,
  };
}

// ── Real-time subscription ───────────────────────────────────────────

export function subscribeToRoomComments(
  roomId: string,
  onNewComment: (comment: RoomComment) => void,
  options?: {
    resolveAuthor?: (authorId: string) => RoomCommentAuthor | undefined;
  },
): () => void {
  const channel = supabase
    .channel(`room-comments:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "room_comments",
        filter: `room_id=eq.${roomId}`,
      },
      async (payload) => {
        const row = payload.new as any;

        // Lookup author
        const author =
          (row.author_id
            ? options?.resolveAuthor?.(row.author_id)
            : undefined) ||
          (row.author_id
            ? await lookupRoomCommentAuthor(row.author_id)
            : undefined);

        onNewComment({
          id: row.id,
          roomId: row.room_id,
          authorId: row.author_id,
          body: row.body,
          parentId: row.parent_id,
          rootId: row.root_id,
          depth: row.depth,
          mentions: row.mentions || [],
          createdAt: row.created_at,
          author,
        });
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ── Thread builder ───────────────────────────────────────────────────

/** Build threaded comment tree from flat list. Max 2 levels. */
export function buildCommentThreads(comments: RoomComment[]): RoomComment[] {
  const rootComments: RoomComment[] = [];
  const repliesByRootId = new Map<number, RoomComment[]>();

  for (const comment of comments) {
    if (comment.depth === 0) {
      rootComments.push({ ...comment, replies: [] });
    } else {
      const rootId = comment.rootId ?? comment.parentId;
      if (rootId != null) {
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
