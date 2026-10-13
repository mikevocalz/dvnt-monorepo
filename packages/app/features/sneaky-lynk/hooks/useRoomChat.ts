import { useCallback, useEffect, useRef, useState } from "react";
import type { SneakyUser } from "../types";
import { postRoomComment, subscribeToRoomComments, type Mention, type RoomComment } from "../api/comments";
import { mergeCommentSnapshot, reconcilePostedComment } from "../api/comment-sync";

/** Room chat starts only after admission; each identity owns its own timeline. */
export function useRoomChat({ roomId, currentUser, enabled = true }: {
  roomId: string;
  currentUser: SneakyUser;
  enabled?: boolean;
}) {
  const key = enabled && roomId && currentUser.id ? JSON.stringify([roomId, currentUser.id]) : "";
  const [state, setState] = useState<{ key: string; comments: RoomComment[]; loading: boolean; error: string | null }>({ key: "", comments: [], loading: false, error: null });
  const generation = useRef(0);
  const owner = useRef(key);
  owner.current = key;
  const sequence = useRef(0);
  const userRef = useRef(currentUser);
  userRef.current = currentUser;

  useEffect(() => {
    const epoch = ++generation.current;
    setState({ key, comments: [], loading: !!key, error: null });
    if (!key) return;
    const unsubscribe = subscribeToRoomComments(roomId, () => {}, {
      onSync: (snapshot) => {
        if (generation.current !== epoch || owner.current !== key) return;
        setState((prev) => ({ key, comments: mergeCommentSnapshot(prev.key === key ? prev.comments : [], snapshot), loading: false, error: null }));
      },
      onError: () => {
        if (generation.current !== epoch || owner.current !== key) return;
        setState((prev) => ({ ...prev, loading: false, error: "Chat couldn't reconnect. We'll keep trying." }));
      },
    });
    return () => { ++generation.current; unsubscribe(); };
  }, [key, roomId]);

  const send = useCallback(async (body: string, reply?: { parentId?: number | null; rootId?: number | null; depth?: number; mentions?: Mention[] }): Promise<boolean> => {
    const trimmed = body.trim();
    if (!key || owner.current !== key || !trimmed) return false;
    const epoch = generation.current;
    const author = userRef.current;
    const optimisticId = -(++sequence.current);
    const pending: RoomComment = {
      id: optimisticId, roomId, authorId: author.id, body: trimmed,
      parentId: reply?.parentId ?? null, rootId: reply?.rootId ?? null, depth: reply?.depth ?? 0,
      mentions: reply?.mentions ?? [], createdAt: new Date().toISOString(),
      author: { ...author, avatar: author.isAnonymous ? "" : author.avatar }, isOptimistic: true,
    };
    setState((prev) => ({ key, comments: [...(prev.key === key ? prev.comments : []), pending], loading: false, error: null }));
    let saved: RoomComment | null = null;
    try {
      saved = await postRoomComment({ roomId, authorId: author.id, body: trimmed, ...reply, author: pending.author });
    } catch { /* Preserve the draft and show a retryable failure below. */ }
    if (generation.current !== epoch || owner.current !== key) return false;
    setState((prev) => ({ ...prev,
      comments: saved ? reconcilePostedComment(prev.comments, optimisticId, saved) : prev.comments.filter((c) => c.id !== optimisticId),
      error: saved ? null : "Message wasn't sent. Please try again.",
    }));
    return !!saved;
  }, [key, roomId]);

  const visible = state.key === key;
  return { comments: visible ? state.comments : [], loading: !!key && (!visible || state.loading), error: visible ? state.error : null, send };
}
