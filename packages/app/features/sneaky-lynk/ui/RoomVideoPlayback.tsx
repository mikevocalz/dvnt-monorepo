import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useVideoPlayer, type BroadcastInfo } from "react-native-moq";

import { nativePlaybackKey } from "./native-playback-key";

type Player = ReturnType<typeof useVideoPlayer>;
type Source = { isLocal: boolean; isCameraOn: boolean; broadcast?: unknown };
const PlaybackContext = createContext<ReadonlyMap<string, Player> | null>(null);

/** A room owns playback, while the hero/gallery own only the native views.
 * Promoting a guest moves their view between parents. That must not stop the
 * MoQ player (including audio) and start a new subscription on every role change.
 */
export function RoomVideoPlaybackProvider({
  participants,
  children,
}: {
  participants: Source[];
  children: React.ReactNode;
}) {
  const [players, setPlayers] = useState<ReadonlyMap<string, Player>>(
    () => new Map(),
  );
  const sources = useMemo(() => {
    const unique = new Map<string, BroadcastInfo>();
    for (const participant of participants) {
      if (
        participant.isLocal ||
        !participant.isCameraOn ||
        !participant.broadcast
      )
        continue;
      const broadcast = participant.broadcast as BroadcastInfo;
      if (broadcast.path) unique.set(nativePlaybackKey(broadcast), broadcast);
    }
    return [...unique.values()];
  }, [participants]);
  const register = useCallback((path: string, player: Player) => {
    setPlayers((current) => {
      if (current.get(path) === player) return current;
      const next = new Map(current);
      next.set(path, player);
      return next;
    });
    return () =>
      setPlayers((current) => {
        if (current.get(path) !== player) return current;
        const next = new Map(current);
        next.delete(path);
        return next;
      });
  }, []);
  return (
    <PlaybackContext.Provider value={players}>
      {sources.map((broadcast) => (
        <PlaybackOwner
          key={nativePlaybackKey(broadcast)}
          broadcast={broadcast}
          register={register}
        />
      ))}
      {children}
    </PlaybackContext.Provider>
  );
}

function PlaybackOwner({
  broadcast,
  register,
}: {
  broadcast: BroadcastInfo;
  register: (path: string, player: Player) => () => void;
}) {
  const player = useVideoPlayer(broadcast);
  const key = nativePlaybackKey(broadcast);
  useEffect(() => {
    player.play();
    const unregister = register(key, player);
    return () => {
      unregister();
      player.stop();
    };
    // SDK 0.3 exposes stable commands in a fresh stats wrapper on each render.
    // Views only need session/path; a new stats snapshot is not a new owner.
    // The keyed parent remounts this owner when session/path identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, register]);
  return null;
}

export function useRoomVideoPlayback() {
  return useContext(PlaybackContext);
}
