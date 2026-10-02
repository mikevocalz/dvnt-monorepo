import * as Y from "yjs";

export interface RoomYDocEntry {
  doc: Y.Doc;
  refs: number;
  listeners: Set<() => void>;
  synced: boolean;
  error: string | null;
  /** Guard against overlapping syncEntry calls (interval + refresh + mount). */
  syncing?: boolean;
  /** A sync arrived while one was in flight — run one trailing sync after. */
  syncAgain?: boolean;
  /** Set when the final ref released and the doc was destroyed. An in-flight
      syncEntry must not apply updates or notify a dead entry. */
  dead?: boolean;
}

const registry = new Map<string, RoomYDocEntry>();

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    result += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(result);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function acquireRoomYDoc(roomId: string): RoomYDocEntry {
  let entry = registry.get(roomId);
  if (!entry) {
    entry = {
      doc: new Y.Doc(),
      refs: 0,
      listeners: new Set(),
      synced: false,
      error: null,
    };
    registry.set(roomId, entry);
  }
  entry.refs++;
  return entry;
}

export function releaseRoomYDoc(roomId: string): void {
  const entry = registry.get(roomId);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    registry.delete(roomId);
    entry.dead = true;
    entry.doc.destroy();
  }
}

export function getRoomYDocEntry(roomId: string): RoomYDocEntry | undefined {
  return registry.get(roomId);
}

export function notifyRoomYDocListeners(entry: RoomYDocEntry): void {
  for (const listener of entry.listeners) {
    listener();
  }
}
