"use client";

/**
 * Authoritative Yjs document for a Game Night room.
 *
 * The server owns the doc. This hook only pulls state-vector diffs via the
 * `game-night-sync` edge function and applies them locally.
 *
 * A per-room refcounted registry keeps one Y.Doc per room_id for the lifetime
 * of the tab, so StrictMode double-mounts and remounts reuse the live document
 * instead of creating duplicate state. On last release the doc is destroyed so
 * a returning user never sees stale data from a previous room or account.
 */

import { useCallback, useEffect, useState } from "react";
import * as Y from "yjs";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import {
  acquireRoomYDoc,
  base64ToBytes,
  bytesToBase64,
  notifyRoomYDocListeners,
  releaseRoomYDoc,
  type RoomYDocEntry,
} from "./room-ydoc";

export interface UseRoomYDocResult {
  doc: Y.Doc | null;
  state: unknown;
  synced: boolean;
  error: string | null;
  sync: () => void;
}

async function syncEntry(entry: RoomYDocEntry, roomCode: string) {
  const stateVector = Y.encodeStateVector(entry.doc);
  const stateVectorB64 = bytesToBase64(stateVector);
  const { data, error } = await invokeEdge<{
    update_b64: string;
    canonical_hash: string;
  }>("game-night-sync", {
    room_code: roomCode,
    state_vector_b64: stateVectorB64,
  });

  if (error) {
    entry.synced = false;
    entry.error = error.message;
    notifyRoomYDocListeners(entry);
    return;
  }

  if (!data) {
    entry.synced = false;
    entry.error = "No response from server";
    notifyRoomYDocListeners(entry);
    return;
  }

  entry.synced = true;
  entry.error = null;

  try {
    const update = base64ToBytes(data.update_b64);
    // Yjs de-duplicates and orders updates internally; we never sequence them.
    Y.applyUpdate(entry.doc, update);
  } catch (e) {
    entry.error = "Invalid update from server";
  }
  notifyRoomYDocListeners(entry);
}

export function useRoomYDoc(
  roomId: number | null | undefined,
  roomCode: string | null | undefined,
  refresh?: number | string,
): UseRoomYDocResult {
  const [entry, setEntry] = useState<RoomYDocEntry | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!roomId) {
      setEntry(null);
      return;
    }

    const id = String(roomId);
    const e = acquireRoomYDoc(id);
    setEntry(e);

    // Observe the authoritative state map directly; Yjs fires this whenever an
    // applied update changes it.
    const stateMap = e.doc.getMap("state");
    const observer = () => bump((n) => n + 1);
    stateMap.observe(observer);

    // The listener set is for sync/error status changes that do not mutate the
    // doc itself.
    const statusListener = () => bump((n) => n + 1);
    e.listeners.add(statusListener);

    if (roomCode) {
      void syncEntry(e, roomCode);
    }

    return () => {
      stateMap.unobserve(observer);
      e.listeners.delete(statusListener);
      releaseRoomYDoc(id);
    };
  }, [roomId, roomCode]);

  // 5-second catch-up while mounted.
  useEffect(() => {
    if (!entry || !roomCode) return;
    const timer = window.setInterval(() => {
      void syncEntry(entry, roomCode);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [entry, roomCode]);

  // Explicit refresh trigger wired to projection bumps.
  useEffect(() => {
    if (!entry || !roomCode) return;
    void syncEntry(entry, roomCode);
  }, [refresh, entry, roomCode]);

  const sync = useCallback(() => {
    if (entry && roomCode) {
      void syncEntry(entry, roomCode);
    }
  }, [entry, roomCode]);

  return {
    doc: entry?.doc ?? null,
    state: entry ? entry.doc.getMap("state").get("json") : null,
    synced: entry?.synced ?? false,
    error: entry?.error ?? null,
    sync,
  };
}
