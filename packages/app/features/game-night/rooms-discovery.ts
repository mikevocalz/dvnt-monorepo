import type { WatchableRoom } from "./rooms-api.ts";
import { entryMode } from "./seats.ts";

export function roomMatchesHandle(room: WatchableRoom, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const names = [
    room.hostName,
    ...room.seatAvatars.map((seat) => seat.name),
  ].filter((name): name is string => Boolean(name));
  return names.some((name) => name.toLocaleLowerCase().includes(needle));
}

export function partitionRooms(rooms: WatchableRoom[]) {
  return {
    watch: rooms.filter((room) => room.status === "playing"),
    join: rooms.filter((room) => entryMode(room.playerCount) === "play"),
  };
}
