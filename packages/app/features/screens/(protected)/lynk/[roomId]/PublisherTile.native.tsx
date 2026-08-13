/**
 * One native MoQ publisher tile — renders a discovered broadcast through
 * `<VideoView>` (native QUIC + hardware decode). The Lynk native screen mounts
 * one per live publisher (host + cohost + speakers).
 *
 * WS-3: replaces `LivestreamTile.native.tsx`, which drove one Fishjam WHEP
 * `useLivestreamViewer()` per publisher and needed a `<FishjamProvider>`
 * ancestor. Playback is started here and stopped on unmount so a tile that
 * scrolls away stops pulling media.
 */

import { useEffect } from "react";
import { View, Text } from "react-native";
import { VideoView, useVideoPlayer } from "react-native-moq";
import type { BroadcastInfo } from "react-native-moq";

export function PublisherTile({
  broadcast,
  label,
}: {
  broadcast: BroadcastInfo;
  label?: string;
}) {
  // `broadcast.player` is the raw handle; `useVideoPlayer` is the React-bound
  // view of the same native player and is what `<VideoView>` accepts.
  const player = useVideoPlayer(broadcast);

  useEffect(() => {
    player.play();
    return () => player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast.path]);

  return (
    <View className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <VideoView player={player} style={{ flex: 1 }} />
      {label ? (
        <View className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1">
          <Text className="text-xs font-semibold text-white">{label}</Text>
        </View>
      ) : null}
    </View>
  );
}
