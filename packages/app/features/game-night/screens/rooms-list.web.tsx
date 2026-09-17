"use client";

/**
 * Game Night — live rooms (WEB).
 *
 * A browsable list of tables in progress. Four seats per table; everyone past
 * the fourth watches. The card DRAWS its four seats rather than printing
 * "2/4", because the only question a reader has is "can I sit down, or am I
 * watching" — and a row of filled and empty seats answers that before they have
 * read a word.
 *
 * Capacity is never rendered as an error. A full table still opens; it just
 * opens into watching. There is no disabled row in this list.
 *
 * Idioms are the repo's, not new ones:
 *  - `useGsapScope` (landing/hooks/useGsap) registers ScrollTrigger once,
 *    scopes tweens to the returned ref, reverts on unmount, and short-circuits
 *    under prefers-reduced-motion.
 *  - TanStack Virtual with dynamic `measureElement`, matching
 *    settings/host-disputes.web.tsx.
 *  - Card surface `rounded-2xl border border-white/10 bg-white/4`.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Gamepad2, Eye, Plus, AlertTriangle } from "lucide-react";
import {
  useGsapScope,
  prefersReducedMotion,
} from "@dvnt/app/features/screens/landing/hooks/useGsap";
import { generateRoomCode } from "../room-code";
import { seatsFor, entryMode, seatsLeft, MAX_PLAYERS } from "../seats";
import { listWatchableRooms, type WatchableRoom } from "../rooms-api";
import { useRoomsListStore } from "../rooms-list-store";

/** Initial guess only — measureElement corrects it once rendered. */
const ROW_ESTIMATE = 132;

export function GameNightRoomsScreen() {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rooms = useRoomsListStore((s) => s.rooms);
  const status = useRoomsListStore((s) => s.status);
  const setRooms = useRoomsListStore((s) => s.setRooms);
  const setStatus = useRoomsListStore((s) => s.setStatus);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await listWatchableRooms();
        if (!cancelled) {
          setRooms(next);
          setStatus("ready");
        }
      } catch {
        // A failed read is not an empty lobby. Different sentence, different UI.
        if (!cancelled) setStatus("error");
      }
    };
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    void load();
    // Rooms open and fill while someone is reading the list. Polling rather
    // than a realtime subscription: this is a projection across ALL rooms, and
    // presence would mean joining every room's channel to watch it change.
    const id = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [setRooms, setStatus]);

  const virtualizer = useVirtualizer({
    count: rooms.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  const startRoom = useCallback(() => {
    router.push(`/game-night/room/${generateRoomCode()}`);
  }, [router]);

  return (
    <main className="min-h-dvh bg-[#06070d] text-white">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <Header onStart={startRoom} count={rooms.length} />

        {status === "error" ? (
          <Notice
            icon={<AlertTriangle aria-hidden className="h-4 w-4" />}
            title="Could not load the rooms"
            body="This is a connection problem, not an empty lobby. It will retry on its own."
          />
        ) : status === "loading" ? (
          <RoomSkeletons />
        ) : rooms.length === 0 ? (
          <EmptyLobby />
        ) : (
          <div
            ref={parentRef}
            className="mt-6 overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 220px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const room = rooms[item.index];
                if (!room) return null;
                return (
                  <div
                    key={room.roomCode}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <RoomCard room={room} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Header({ onStart, count }: { onStart: () => void; count: number }) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#8A40CF]/40 bg-[#8A40CF]/10 px-3 py-1 text-xs font-medium tracking-wide text-[#C9A2F0]">
          <Gamepad2 aria-hidden className="h-3.5 w-3.5" />
          Game Night
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Tables in play
        </h1>
        <p aria-live="polite" className="mt-1 text-sm text-white/55">
          {count === 0
            ? "Nothing running right now."
            : `${count} ${count === 1 ? "table" : "tables"} going. Four seats each — after that you watch.`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-2 rounded-xl bg-[#8A40CF] px-4 py-2.5 font-semibold text-white transition-colors hover:bg-[#7A35BC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0]"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Start a table
        </button>
        {/* A private table never appears in this list, so the code route has to
            stay reachable from it — otherwise someone holding a code has
            nowhere to type it. */}
        <a
          href="/game-night/join"
          className="text-xs text-white/50 underline-offset-4 hover:text-white/80 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0]"
        >
          Have a code?
        </a>
      </div>
    </header>
  );
}

function RoomCard({ room }: { room: WatchableRoom }) {
  const mode = entryMode(room.playerCount);
  const left = seatsLeft(room.playerCount);
  const seats = seatsFor(room.seatAvatars, room.seatAvatars[0]?.id ?? "");

  // The whole card is the link. One target, one action — no nested buttons to
  // trap a keyboard user inside a row.
  return (
    <a
      href={`/game-night/room/${room.roomCode}`}
      className="group block rounded-2xl border border-white/10 bg-white/4 p-4 transition-colors hover:border-[#8A40CF]/50 hover:bg-white/6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0]"
    >
      {/* Reserved for the table art. Sized now so dropping the graphic in
          later cannot reflow the row or invalidate measured heights. */}
      <div
        aria-hidden
        className="mb-3 h-1 rounded-full bg-gradient-to-r from-[#8A40CF]/70 via-[#8A40CF]/20 to-transparent"
      />

      <div className="flex items-center gap-4">
        <Seats seats={seats} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">
            {room.hostName ?? "Someone"}&rsquo;s table
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-white/55">
            <span className="font-mono tracking-[0.18em]">{room.roomCode}</span>
            {room.watcherCount > 0 ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Eye aria-hidden className="h-3 w-3" />
                  {room.watcherCount} watching
                </span>
              </>
            ) : null}
          </p>
        </div>

        <span
          className={
            mode === "play"
              ? "shrink-0 rounded-full bg-[#8A40CF]/20 px-3 py-1 text-[11px] font-bold text-[#C9A2F0]"
              : "shrink-0 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/70"
          }
        >
          {mode === "play"
            ? `${left} ${left === 1 ? "seat" : "seats"} open`
            : "Watch"}
        </span>
      </div>
    </a>
  );
}

function Seats({ seats }: { seats: ReturnType<typeof seatsFor> }) {
  return (
    <ul
      className="flex shrink-0 -space-x-2"
      aria-label={`${seats.filter((s) => s.player).length} of ${MAX_PLAYERS} seats taken`}
    >
      {seats.map((seat) => (
        <li key={seat.index}>
          {seat.player ? (
            seat.player.avatar ? (
              // Rounded SQUARES, never circles — the repo's avatar rule.
              <img
                src={seat.player.avatar}
                alt=""
                className="h-9 w-9 rounded-lg object-cover ring-2 ring-[#06070d]"
              />
            ) : (
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#8A40CF]/25 text-xs font-bold text-[#C9A2F0] ring-2 ring-[#06070d]">
                {(seat.player.name ?? "?").charAt(0).toUpperCase()}
              </span>
            )
          ) : (
            // An empty seat is drawn, not omitted. The gap is the information.
            <span className="block h-9 w-9 rounded-lg border border-dashed border-white/20 ring-2 ring-[#06070d]" />
          )}
        </li>
      ))}
    </ul>
  );
}

function RoomSkeletons() {
  return (
    <ul className="mt-6 space-y-3" aria-busy="true" aria-label="Loading tables">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/4 p-4"
        >
          <span className="flex -space-x-2">
            {[0, 1, 2, 3].map((s) => (
              <span
                key={s}
                className="h-9 w-9 animate-pulse rounded-lg bg-white/10 ring-2 ring-[#06070d]"
              />
            ))}
          </span>
          <span className="h-3 w-40 animate-pulse rounded bg-white/10" />
        </li>
      ))}
    </ul>
  );
}

function EmptyLobby() {
  // An empty screen is an invitation, and it carries the action rather than
  // describing one that lives elsewhere.
  const scope = useGsapScope((self, gsap) => {
    if (prefersReducedMotion()) return;
    gsap.from(self.querySelectorAll("[data-seat]"), {
      opacity: 0,
      y: 8,
      duration: 0.4,
      stagger: 0.07,
      ease: "power2.out",
    });
  }, []);

  return (
    <section
      ref={scope as React.RefObject<HTMLElement>}
      className="mt-10 rounded-2xl border border-dashed border-white/15 p-10 text-center"
    >
      {/* Spaced, not stacked. The overlap is an avatar convention and it needs
          a filled seat to read against; four dashed outlines overlapping merge
          into one box, which is the opposite of the point. */}
      <ul className="mb-5 flex justify-center gap-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            data-seat
            className="h-10 w-10 rounded-lg border border-dashed border-white/25 ring-2 ring-[#06070d]"
          />
        ))}
      </ul>
      <h2 className="text-lg font-semibold text-white">No tables running</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-white/55">
        Four people sit down, everyone else watches. Start one with the button
        above and read the code out.
      </p>
    </section>
  );
}

function Notice({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div role="status" className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-5">
      <p className="flex items-center gap-2 font-medium text-white">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-sm text-white/55">{body}</p>
    </div>
  );
}

export default GameNightRoomsScreen;
