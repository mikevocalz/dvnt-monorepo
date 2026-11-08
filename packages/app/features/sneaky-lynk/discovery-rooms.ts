import { bindDiscoveryRoom, discoveryRoomState } from "./discovery-room-state";
import type { LynkRecord } from "./stores/lynk-history-store";
import type { SneakyRoom } from "./types";

/** History never grants presence, ownership or admission. Missing rows do not mean ended. */
export function selectDiscoveryRooms(
  remote: SneakyRoom[], history: LynkRecord[], selfIds: string[], isCurrent: () => boolean,
): LynkRecord[] {
  if (!isCurrent()) return [];
  const seen = new Set(remote.map((room) => room.id));
  const rooms: LynkRecord[] = remote.map((room) => bindDiscoveryRoom(room, isCurrent)).filter((room) => {
    const state = discoveryRoomState(room);
    return state.live || room.status === "ended" || room.availability === "ended" || room.isOwner === true || room.isInvited === true;
  });
  for (const room of history) {
    if (room.source !== "sneaky_lynk" || !selfIds.includes(String(room.host.id)) || seen.has(room.id)) continue;
    rooms.push({ ...room, isLive: false, presenceKnown: false, isOwner: false, isInvited: false,
      availability: room.status === "ended" ? "ended" : "unknown", observedAt: undefined,
      presenceExpiresAt: undefined, requestStartedAt: undefined, requestStartedMonotonic: undefined });
  }
  return rooms.sort((a, b) => Number(discoveryRoomState(a).ended) - Number(discoveryRoomState(b).ended) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
