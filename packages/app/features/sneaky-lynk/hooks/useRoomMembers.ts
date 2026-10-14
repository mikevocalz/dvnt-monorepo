import { useEffect, useState } from "react";
import { videoApi } from "../../video/api";
import type { RoomMember } from "../../video/types";

const EMPTY_MEMBERS: RoomMember[] = [];

/** A roster belongs to an admitted room/account, never the previous screen. */
export function useRoomMembers(roomId: string, userId: string | undefined, enabled: boolean) {
  const key = enabled && userId ? JSON.stringify([roomId, userId]) : "";
  const [state, setState] = useState<{ key: string; members: RoomMember[]; error: boolean }>({ key: "", members: [], error: false });
  useEffect(() => {
    if (!key) return;
    let active = true;
    const unsubscribe = videoApi.subscribeToMembers(roomId, () => {}, {
      onSync: (members) => { if (active) setState({ key, members, error: false }); },
      onError: () => { if (active) setState((s) => ({ key, members: s.key === key ? s.members : [], error: true })); },
    });
    return () => { active = false; unsubscribe(); };
  }, [key, roomId]);
  return { members: state.key === key ? state.members : EMPTY_MEMBERS, error: state.key === key && state.error };
}
