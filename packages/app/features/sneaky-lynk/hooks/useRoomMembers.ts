import { useEffect, useRef, useState } from "react";
import { videoApi } from "../../video/api";
import type { RoomMember } from "../../video/types";

const EMPTY_MEMBERS: RoomMember[] = [];

/** A roster belongs to an admitted room/account, never the previous screen. */
export function useRoomMembers(roomId: string, userId: string | undefined, enabled: boolean) {
  const key = enabled && userId ? JSON.stringify([roomId, userId]) : "";
  const [state, setState] = useState<{ key: string; members: RoomMember[]; error: boolean; ready: boolean }>({ key: "", members: [], error: false, ready: false });
  const installedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!key) return;
    installedKey.current = key;
    setState({ key, members: [], ready: false, error: false });
    let active = true;
    const unsubscribe = videoApi.subscribeToMembers(roomId, () => {}, {
      onSync: (members) => { if (active) setState({ key, members, error: false, ready: true }); },
      onError: () => { if (active) setState((s) => ({ key, members: s.key === key ? s.members : [], ready: s.key === key && s.ready, error: true })); },
    });
    return () => { active = false; installedKey.current = null; unsubscribe(); };
  }, [key, roomId]);
  const current = !!key && installedKey.current === key && state.key === key;
  return { members: current ? state.members : EMPTY_MEMBERS, error: current && state.error, ready: current && state.ready };
}
