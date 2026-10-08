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
  seatIndex,
}: {
  code: string;
  roomId: number;
  userId: string;
  seatIndex?: number | null;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      aria-label="React to the room"
      className="flex max-w-full w-fit items-center gap-1 overflow-x-auto overscroll-x-contain rounded-2xl border border-white/10 bg-[#090a11]/88 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,.34)] backdrop-blur-xl"
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
                seatIndex: seatIndex ?? -1,
              }),
            );
            void sendRoomMessage(code, "reaction", { reaction: emoji }).catch(
              () => setFailed(true),
            );
          }}
          className="grid h-9 w-9 shrink-0 touch-manipulation place-items-center rounded-xl text-lg transition hover:-translate-y-0.5 hover:bg-white/10 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#C9A2F0] motion-reduce:transform-none sm:h-10 sm:w-10 sm:text-xl"
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
