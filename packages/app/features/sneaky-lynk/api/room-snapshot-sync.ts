import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Realtime is an invalidation signal, not an ordered stream of hydrated rows.
 * A slow roster/profile read must never put a departed member or deleted
 * comment back. Coalesce changes, discard invalidated reads, and fetch again.
 */
export function createRoomSnapshotSync<T>(options: {
  load: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onError?: (error: unknown) => void;
  retryMs?: number;
  pollMs?: number;
}) {
  let stopped = false;
  let running = false;
  let dirty = false;
  let revision = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const requestedRevision = revision;
        try {
          const snapshot = await options.load();
          if (!stopped && requestedRevision === revision) {
            options.onSnapshot(snapshot);
          }
        } catch (error) {
          if (!stopped && requestedRevision === revision) {
            options.onError?.(error);
            // A transient read failure is not an empty room. Keep the last
            // good snapshot and retry even if no more DB events arrive.
            if (!stopped) retry = setTimeout(invalidate, options.retryMs ?? 2_000);
          }
        }
      }
    } finally {
      running = false;
    }
  }

  function invalidate() {
    if (stopped) return;
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    revision += 1;
    dirty = true;
    void drain();
  }

  // Some networks permit REST but block websockets entirely. A bounded
  // authoritative refresh also recovers events silently missed by realtime.
  const poll = setInterval(invalidate, options.pollMs ?? 15_000);

  return {
    invalidate,
    stop() {
      stopped = true;
      dirty = false;
      clearInterval(poll);
      if (retry !== undefined) clearTimeout(retry);
    },
  };
}

/** DELETE may contain only the primary key, so it cannot use room_id filters. */
export function bindRoomSnapshotChanges(
  channel: RealtimeChannel,
  table: "video_room_members" | "room_comments",
  roomId: string,
  invalidate: () => void,
): RealtimeChannel {
  for (const event of ["INSERT", "UPDATE"] as const) {
    channel.on("postgres_changes", {
      event,
      schema: "public",
      table,
      filter: `room_id=eq.${roomId}`,
    }, invalidate);
  }
  return channel.on("postgres_changes", {
    event: "DELETE",
    schema: "public",
    table,
  }, (payload) => {
    const oldRoomId = (payload.old as { room_id?: string | number })?.room_id;
    // The optional room hint saves a read, but an id-only deletion must still
    // invalidate. The replacement snapshot is always fetched under RLS.
    if (oldRoomId == null || String(oldRoomId) === roomId) invalidate();
  });
}
