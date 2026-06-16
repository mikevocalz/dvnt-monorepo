export interface RoomMemberStatRow {
  room_id: number;
  user_id: string;
  status: "active" | "left" | "kicked" | "banned" | string;
  joined_at?: string | null;
  left_at?: string | null;
}

export interface RoomPresenceStats {
  activeCount: number;
  historicalCount: number;
}

export interface RoomAudienceInput {
  id: number;
  status: "open" | "ended";
  participant_count?: number | null;
  created_at?: string | null;
}

const OPEN_MEMBER_FRESHNESS_MS = 12 * 60 * 60 * 1000;
const JUST_CREATED_GRACE_MS = 2 * 60 * 1000;

function getOrCreateSet<K>(map: Map<K, Set<string>>, key: K): Set<string> {
  const existing = map.get(key);
  if (existing) return existing;
  const next = new Set<string>();
  map.set(key, next);
  return next;
}

export function buildRoomParticipantStats(
  members: RoomMemberStatRow[],
  nowMs = Date.now(),
  freshnessMs = OPEN_MEMBER_FRESHNESS_MS,
): Record<number, RoomPresenceStats> {
  const activeByRoom = new Map<number, Set<string>>();
  const historicalByRoom = new Map<number, Set<string>>();

  for (const member of members) {
    const roomId = Number(member.room_id);
    if (!Number.isFinite(roomId)) continue;

    const userId = String(member.user_id || "").trim();
    if (!userId) continue;

    getOrCreateSet(historicalByRoom, roomId).add(userId);

    const joinedAtMs = member.joined_at ? Date.parse(member.joined_at) : NaN;
    const isFreshActive =
      member.status === "active" &&
      Number.isFinite(joinedAtMs) &&
      nowMs - joinedAtMs <= freshnessMs;

    if (isFreshActive) {
      getOrCreateSet(activeByRoom, roomId).add(userId);
    }
  }

  const stats: Record<number, RoomPresenceStats> = {};
  const roomIds = new Set<number>([
    ...Array.from(historicalByRoom.keys()),
    ...Array.from(activeByRoom.keys()),
  ]);

  for (const roomId of roomIds) {
    stats[roomId] = {
      activeCount: activeByRoom.get(roomId)?.size ?? 0,
      historicalCount: historicalByRoom.get(roomId)?.size ?? 0,
    };
  }

  return stats;
}

export function resolveRoomAudience(
  room: RoomAudienceInput,
  stats?: RoomPresenceStats,
  nowMs = Date.now(),
) {
  const persistedCount = Math.max(0, Number(room.participant_count || 0));
  const activeCount = stats?.activeCount ?? 0;
  const historicalCount = Math.max(stats?.historicalCount ?? 0, persistedCount);

  const createdAtMs = room.created_at ? Date.parse(room.created_at) : NaN;
  const justCreated =
    Number.isFinite(createdAtMs) && nowMs - createdAtMs <= JUST_CREATED_GRACE_MS;

  const listeners =
    room.status === "open"
      ? activeCount > 0
        ? activeCount
        : justCreated
          ? historicalCount
          : 0
      : historicalCount;

  return {
    listeners,
    isLive: room.status === "open" && listeners > 0,
    activeCount,
    historicalCount,
  };
}
