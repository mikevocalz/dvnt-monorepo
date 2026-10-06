"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  subscribeRoomReactions,
  type RoomReactionEvent,
} from "../motion/room-reactions";
import { GAME_NIGHT_RIVE_HUD } from "../motion/rive-hud-contract";

const MAX_VISIBLE = 7;
const TTL_MS = 1700;

/**
 * Accessible fallback for the Room Reactions Rive artboard.
 *
 * The event stream and data-rive bindings are production code. Once
 * game-night-hud.riv contains the authored Room Reactions artboard, this
 * component's visual layer can switch to the Rive runtime without touching
 * chat transport, reaction semantics, or the table screen.
 */
export function RoomReactionOverlay({ roomId }: { roomId: number }) {
  const [events, setEvents] = useState<RoomReactionEvent[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    return subscribeRoomReactions((event) => {
      if (event.roomId !== roomId) return;

      setEvents((current) => [...current, event].slice(-MAX_VISIBLE));
      const timer = window.setTimeout(() => {
        setEvents((current) => current.filter((item) => item.id !== event.id));
        timers.current.delete(event.id);
      }, TTL_MS);
      timers.current.set(event.id, timer);
    });
  }, [roomId]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return (
    <div
      aria-hidden
      data-rive-artboard={GAME_NIGHT_RIVE_HUD.artboards.roomReactions}
      data-rive-state-machine={GAME_NIGHT_RIVE_HUD.roomReactionStateMachine}
      className="pointer-events-none absolute inset-y-0 right-1 z-30 w-24 overflow-hidden sm:right-3 sm:w-28"
    >
      <style>{`
        @keyframes dvnt-room-reaction-rise {
          0% { opacity: 0; transform: translate3d(0, 20px, 0) scale(.7) rotate(-6deg); }
          18% { opacity: 1; transform: translate3d(0, 0, 0) scale(1.12) rotate(4deg); }
          72% { opacity: .95; }
          100% { opacity: 0; transform: translate3d(var(--drift), -190px, 0) scale(.92) rotate(var(--spin)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dvnt-room-reaction { animation: none !important; opacity: .9; }
        }
      `}</style>
      {events.map((event, index) => {
        const laneX = event.lane * 22;
        const drift = event.lane === 0 ? "-12px" : event.lane === 2 ? "12px" : "0px";
        const spin = event.lane === 0 ? "-8deg" : event.lane === 2 ? "8deg" : "2deg";
        return (
          <span
            key={event.id}
            data-rive-reaction-kind={event.kindValue}
            data-rive-is-self={event.isMine}
            data-rive-lane={event.lane}
            data-rive-seat-index={event.seatIndex}
            data-rive-intensity={event.intensity}
            className="dvnt-room-reaction absolute bottom-5 grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-[#0b0c13]/76 text-3xl shadow-[0_12px_32px_rgba(0,0,0,.28)] backdrop-blur-md"
            style={
              {
                right: laneX,
                animation: `dvnt-room-reaction-rise ${TTL_MS}ms cubic-bezier(.16,.8,.24,1) both`,
                animationDelay: `${index * 35}ms`,
                "--drift": drift,
                "--spin": spin,
              } as CSSProperties
            }
          >
            {event.emoji}
          </span>
        );
      })}
    </div>
  );
}
