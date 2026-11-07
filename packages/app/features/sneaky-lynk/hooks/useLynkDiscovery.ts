import { useLynkCreateScope } from "./useLynkCreateScope";
import { discoveryRoomState } from "../discovery-room-state";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { sneakyLynkApi } from "../api/supabase";
import { useLynkHistoryStore, type LynkRecord } from "../stores/lynk-history-store";

/** Account-scoped discovery. A failed/partial list is not evidence a room ended. */
export function useLynkDiscovery(enabled = true) {
  const user = useAuthStore((state) => state.user);
  const localRooms = useLynkHistoryStore((state) => state.rooms);
  const identity = user as { id?: string | number; authId?: string; auth_id?: string } | null;
  const accountKey = String(identity?.authId || identity?.auth_id || identity?.id || "");
  const selfIds = [identity?.id, identity?.authId, identity?.auth_id].filter((id) => id != null).map(String);
  const captureOwner = useLynkCreateScope(() => {});
  const query = useQuery({
    queryKey: ["sneaky-lynk", "rooms", accountKey],
    queryFn: async () => {
      const isCurrent = captureOwner(user);
      const rooms = await sneakyLynkApi.getLiveRooms({ isCurrent });
      if (!isCurrent()) throw new Error("Discovery account changed");
      return rooms;
    },
    enabled: enabled && !!accountKey,
    staleTime: 10_000,
    refetchInterval: enabled ? 20_000 : false,
    retry: 1,
  });
  const remoteRooms = query.data ?? [];
  const remoteIds = new Set(remoteRooms.map((room) => room.id));
  // Local records are device-persisted. Never show a previous account's rooms.
  const ownHistory = localRooms.filter((room) => room.source === "sneaky_lynk" &&
    selfIds.includes(String(room.host.id)) && !remoteIds.has(room.id));
  const rooms: LynkRecord[] = [...remoteRooms, ...ownHistory].sort((a, b) =>
    Number(discoveryRoomState(a).ended) - Number(discoveryRoomState(b).ended) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return { rooms, isLoading: query.isLoading, isFetching: query.isFetching, isError: query.isError,
    refetch: () => query.refetch() };
}
