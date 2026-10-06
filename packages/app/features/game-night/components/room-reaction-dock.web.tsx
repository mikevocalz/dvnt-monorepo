"use client";

import { useState } from "react";
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
}: {
  code: string;
  roomId: number;
  userId: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      aria-label="React to the room"
      className="flex w-fit items-center gap-1 rounded-2xl border border-white/10 bg-[#090a11]/82 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,.34)] backdrop-blur-xl"
    >
      {ROOM_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React ${emoji}`}
          onClick={() => {
            const id = crypto.randomUUID();
            setFailed(false);
            emitRoomReaction(
              createRoomReactionEvent({
                id: `local-${id}`,
                roomId,
                userId,
                emoji,
                isMine: true,
              }),
            );
            void sendRoomMessage(code, "reaction", { reaction: emoji }).catch(
              () => setFailed(true),
            );
          }}
          className="grid h-10 w-10 place-items-center rounded-xl text-xl transition hover:-translate-y-0.5 hover:bg-white/10 active:translate-y-px motion-reduce:transform-none"
        >
          {emoji}
        </button>
      ))}
      {failed ? (
        <span className="sr-only" role="status">
          Reaction could not be sent.
        </span>
      ) : null}
    </div>
  );
}
