import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { sendRoomMessage } from "../rooms-api";
import {
  createRoomReactionEvent,
  emitRoomReaction,
  ROOM_REACTIONS,
} from "../motion/room-reactions";

export function RoomReactionDock({
  code,
  roomId,
  userId,
  seatIndex,
}: {
  code: string;
  roomId: number;
  userId: string;
  seatIndex?: number | null;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <View
      accessibilityLabel="React to the room"
      className="flex-row gap-1 rounded-2xl border border-white/10 bg-black/70 p-1.5"
    >
      {ROOM_REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          accessibilityRole="button"
          accessibilityLabel={`React ${emoji}`}
          className="h-10 w-10 items-center justify-center rounded-xl active:bg-white/10"
          onPress={() => {
            const id = String(Date.now()) + Math.random().toString(16).slice(2);
            setFailed(false);
            emitRoomReaction(
              createRoomReactionEvent({
                id: `local-native-${id}`,
                roomId,
                userId,
                emoji,
                isMine: true,
                seatIndex: seatIndex ?? -1,
              }),
            );
            void sendRoomMessage(code, "reaction", { reaction: emoji }).catch(
              () => setFailed(true),
            );
          }}
        >
          <Text className="text-xl">{emoji}</Text>
        </Pressable>
      ))}
      {failed ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
        >
          Reaction could not be sent.
        </Text>
      ) : null}
    </View>
  );
}
