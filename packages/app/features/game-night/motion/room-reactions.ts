export const ROOM_REACTIONS = ["❤️", "😂", "🔥", "💀", "👀", "💯"] as const;

export type RoomReactionEmoji = (typeof ROOM_REACTIONS)[number];
export type RoomReactionKind =
  | "love"
  | "laugh"
  | "fire"
  | "dead"
  | "eyes"
  | "hundred";

const KIND_BY_EMOJI: Record<RoomReactionEmoji, RoomReactionKind> = {
  "❤️": "love",
  "😂": "laugh",
  "🔥": "fire",
  "💀": "dead",
  "👀": "eyes",
  "💯": "hundred",
};

const KIND_VALUE: Record<RoomReactionKind, number> = {
  love: 0,
  laugh: 1,
  fire: 2,
  dead: 3,
  eyes: 4,
  hundred: 5,
};

export interface RoomReactionEvent {
  id: string;
  roomId: number;
  userId: string;
  emoji: RoomReactionEmoji;
  kind: RoomReactionKind;
  kindValue: number;
  isMine: boolean;
  lane: number;
  intensity: number;
  createdAt: number;
}

type Listener = (event: RoomReactionEvent) => void;
const listeners = new Set<Listener>();

export function isRoomReactionEmoji(value: string): value is RoomReactionEmoji {
  return (ROOM_REACTIONS as readonly string[]).includes(value);
}

function stableLane(id: string, laneCount = 3): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % Math.max(1, laneCount);
}

export function createRoomReactionEvent({
  id,
  roomId,
  userId,
  emoji,
  isMine,
  createdAt = Date.now(),
  intensity = 1,
}: {
  id: string;
  roomId: number;
  userId: string;
  emoji: RoomReactionEmoji;
  isMine: boolean;
  createdAt?: number;
  intensity?: number;
}): RoomReactionEvent {
  const kind = KIND_BY_EMOJI[emoji];
  return {
    id,
    roomId,
    userId,
    emoji,
    kind,
    kindValue: KIND_VALUE[kind],
    isMine,
    lane: stableLane(id),
    intensity: Math.min(3, Math.max(1, intensity)),
    createdAt,
  };
}

export function emitRoomReaction(event: RoomReactionEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeRoomReactions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
