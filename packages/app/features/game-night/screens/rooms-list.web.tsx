"use client";

/**
 * Game Night discovery — styled as a DVNT social surface, not an admin room list.
 *
 * The hierarchy deliberately mirrors the mobile reference:
 *  1. find a game / search by handle
 *  2. large horizontal live-game cards for watching
 *  3. open-seat cards for joining
 *
 * Rooms remain a single accessible link target. The visual table preview is
 * decorative; capacity, watcher count and CTA text are still real DOM text.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "solito/navigation";
import {
  AlertTriangle,
  Eye,
  Gamepad2,
  Plus,
  Search,
  Users,
} from "lucide-react";
import {
  useGsapScope,
  prefersReducedMotion,
} from "@dvnt/app/features/screens/landing/hooks/useGsap";
import {
  createRoom,
  listWatchableRooms,
  type WatchableRoom,
} from "../rooms-api";
import { entryMode, seatsFor, seatsLeft, MAX_PLAYERS } from "../seats";
import { partitionRooms, roomMatchesHandle } from "../rooms-discovery";
import { useRoomsListStore } from "../rooms-list-store";

export function GameNightRoomsScreen() {
  const router = useRouter();
  const rooms = useRoomsListStore((s) => s.rooms);
  const status = useRoomsListStore((s) => s.status);
  const setRooms = useRoomsListStore((s) => s.setRooms);
  const setStatus = useRoomsListStore((s) => s.setStatus);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      try {
        const next = await listWatchableRooms();
        if (!cancelled && mine === seq) {
          setRooms(next);
          setStatus("ready");
        }
      } catch {
        if (!cancelled && mine === seq) setStatus("error");
      }
    };
    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    void load();
    const id = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [setRooms, setStatus]);

  const visibleRooms = useMemo(
    () => rooms.filter((room) => roomMatchesHandle(room, query)),
    [rooms, query],
  );
  const { watch: watchRooms, join: joinRooms } = useMemo(
    () => partitionRooms(visibleRooms),
    [visibleRooms],
  );

  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const startRoom = useCallback(async () => {
    setStartError(null);
    setStartPending(true);
    try {
      const { roomCode } = await createRoom(
        globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
        true,
      );
      router.push(`/game-night/room/${roomCode}`);
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : "Couldn't start a table.",
      );
    } finally {
      setStartPending(false);
    }
  }, [router]);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#08090f] text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-72 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 24% 0%, rgba(138,64,207,.46), transparent 52%), radial-gradient(circle at 72% 8%, rgba(236,104,156,.25), transparent 42%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-6xl px-5 pb-14 pt-8 sm:px-8 sm:pt-12">
        <Header
          onStart={startRoom}
          pending={startPending}
          error={startError}
        />

        <section aria-labelledby="find-game" className="mt-10">
          <h1 id="find-game" className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">
            Find a Game
          </h1>
          <label className="mt-5 flex min-h-16 items-center gap-3 rounded-2xl border-2 border-white/20 bg-[#0d0e15]/90 px-5 shadow-[0_24px_80px_rgba(0,0,0,.25)] transition-colors focus-within:border-[#C9A2F0]/70">
            <Search aria-hidden className="h-6 w-6 shrink-0 text-white/80" />
            <span className="sr-only">Search games by handle</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search by handle"
              className="min-w-0 flex-1 bg-transparent py-4 text-lg font-semibold text-white outline-none placeholder:text-white/35"
            />
          </label>
        </section>

        {status === "error" ? (
          <Notice
            icon={<AlertTriangle aria-hidden className="h-4 w-4" />}
            title="Could not load the games"
            body="This is a connection problem, not an empty lobby. It will retry on its own."
          />
        ) : status === "loading" ? (
          <ShowcaseSkeletons />
        ) : rooms.length === 0 ? (
          <EmptyLobby />
        ) : visibleRooms.length === 0 ? (
          <section className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <h2 className="text-xl font-bold">No handles match “{query}”</h2>
            <p className="mt-2 text-sm text-white/55">
              Try another player name or clear the search to see every live table.
            </p>
          </section>
        ) : (
          <>
            <GameSection
              title="Games to Watch"
              rooms={watchRooms}
              empty="No live games to watch right now."
              variant="watch"
            />
            <GameSection
              title="Games to Join"
              rooms={joinRooms}
              empty="No open seats right now — you can still watch a live table."
              variant="join"
            />
          </>
        )}
      </div>
    </main>
  );
}

function Header({
  onStart,
  pending,
  error,
}: {
  onStart: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <a
        href="/feed"
        className="inline-flex h-11 items-center rounded-full border border-white/15 bg-white/8 px-4 text-sm font-bold text-white/80 backdrop-blur-xl transition hover:bg-white/12"
      >
        ← Back
      </a>
      <span className="inline-flex items-center gap-2 rounded-full border border-[#8A40CF]/40 bg-[#8A40CF]/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-[#D8BBF4]">
        <Gamepad2 aria-hidden className="h-4 w-4" />
        Game Night
      </span>
      <span className="flex-1" />
      <a
        href="/game-night/join"
        className="rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold text-white/70 transition hover:bg-white/8 hover:text-white"
      >
        Have a code?
      </a>
      <button
        type="button"
        disabled={pending}
        onClick={onStart}
        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Plus aria-hidden className="h-4 w-4" />
        {pending ? "Starting…" : "Start a game"}
      </button>
      {error ? (
        <p className="basis-full text-right text-xs text-[#F0A2A2]">{error}</p>
      ) : null}
    </header>
  );
}

function GameSection({
  title,
  rooms,
  empty,
  variant,
}: {
  title: string;
  rooms: WatchableRoom[];
  empty: string;
  variant: "watch" | "join";
}) {
  return (
    <section className="mt-10" aria-labelledby={`${variant}-heading`}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2
          id={`${variant}-heading`}
          className="text-3xl font-black tracking-[-0.03em]"
        >
          {title}
        </h2>
        {rooms.length > 0 ? (
          <span className="text-xs font-semibold text-white/40">
            {rooms.length} live
          </span>
        ) : null}
      </div>

      {rooms.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/4 p-5 text-sm font-semibold text-white/55">
          {empty}
        </p>
      ) : variant === "watch" ? (
        <div className="-mx-5 overflow-x-auto px-5 pb-3 sm:-mx-8 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex w-max snap-x snap-mandatory gap-4">
            {rooms.map((room) => (
              <li key={room.roomCode} className="w-[82vw] max-w-[380px] snap-start sm:w-[360px]">
                <RoomShowcaseCard room={room} mode="watch" />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.map((room) => (
            <li key={room.roomCode}>
              <RoomShowcaseCard room={room} mode="join" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoomShowcaseCard({
  room,
  mode,
}: {
  room: WatchableRoom;
  mode: "watch" | "join";
}) {
  const seats = seatsFor(room.seatAvatars, room.seatAvatars[0]?.id ?? "");
  const left = seatsLeft(room.playerCount);
  const canPlay = entryMode(room.playerCount) === "play";
  const action = mode === "join" && canPlay ? "Join" : "Watch";
  const players = room.seatAvatars
    .map((seat) => seat.name)
    .filter((name): name is string => Boolean(name));

  return (
    <a
      href={`/game-night/room/${room.roomCode}`}
      aria-label={`${action} ${room.hostName ?? "this"} game`}
      className="group block overflow-hidden rounded-[28px] border border-white/10 bg-[#10111a] shadow-[0_26px_80px_rgba(0,0,0,.35)] transition duration-300 hover:-translate-y-1 hover:border-[#C9A2F0]/45 hover:shadow-[0_32px_90px_rgba(80,31,123,.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C9A2F0]"
    >
      <div
        className="relative h-48 overflow-hidden"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, #344b39 0%, #213729 42%, #111c16 72%, #0a0f0c 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-[18%_8%] rounded-[38%] border-[7px] border-[#d3a94a]/35 bg-[#112719] shadow-[inset_0_0_45px_rgba(0,0,0,.55),0_18px_38px_rgba(0,0,0,.25)]"
        />
        <DecorativeCards />
        <span className="absolute right-3 top-3 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-black shadow-lg">
          Live Now
        </span>
        <span className="absolute bottom-3 left-3 rounded-lg border border-white/10 bg-black/45 px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.18em] text-white/70 backdrop-blur-md">
          {room.roomCode}
        </span>
      </div>

      <div className="bg-[linear-gradient(135deg,#641d80_0%,#32154f_55%,#151020_100%)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xl font-black tracking-tight">
              {room.hostName ?? "DVNT Player"}
            </p>
            <p className="mt-1 line-clamp-2 min-h-9 text-sm font-semibold leading-snug text-white/72">
              {players.length > 0 ? players.join(" · ") : "Waiting for players"}
            </p>
          </div>
          {room.watcherCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-bold text-white/70">
              <Eye aria-hidden className="h-3 w-3" />
              {room.watcherCount}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Seats seats={seats} />
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-white/55">
            <Users aria-hidden className="h-3.5 w-3.5" />
            {canPlay ? `${left} open` : "table full"}
          </span>
        </div>

        <div className="mt-4 grid h-12 place-items-center rounded-xl bg-white text-base font-black text-black transition group-hover:bg-[#F3E8FF]">
          {action}
        </div>
      </div>
    </a>
  );
}

function DecorativeCards() {
  const cards = [
    { left: "21%", top: "34%", rotate: -17, tone: "#f5f2e9" },
    { left: "40%", top: "24%", rotate: 7, tone: "#0f0d12" },
    { left: "57%", top: "35%", rotate: 19, tone: "#f5f2e9" },
  ];
  return (
    <>
      {cards.map((card, index) => (
        <span
          key={index}
          aria-hidden
          className="absolute h-24 w-16 rounded-lg border border-black/25 shadow-[0_12px_24px_rgba(0,0,0,.35)] transition-transform duration-500 group-hover:-translate-y-1"
          style={{
            left: card.left,
            top: card.top,
            background: card.tone,
            transform: `rotate(${card.rotate}deg)`,
          }}
        >
          <span
            className={`absolute left-2 top-2 text-[9px] font-black ${index === 1 ? "text-[#D4A642]" : "text-black"}`}
          >
            {index === 1 ? "DVNT" : index === 0 ? "Q♠" : "A♥"}
          </span>
        </span>
      ))}
    </>
  );
}

function Seats({ seats }: { seats: ReturnType<typeof seatsFor> }) {
  return (
    <ul
      className="flex shrink-0 -space-x-2"
      aria-label={`${seats.filter((seat) => seat.player).length} of ${MAX_PLAYERS} seats taken`}
    >
      {seats.map((seat) => (
        <li key={seat.index}>
          {seat.player?.avatar ? (
            <img
              src={seat.player.avatar}
              alt=""
              className="h-9 w-9 rounded-full object-cover ring-2 ring-[#32154f]"
            />
          ) : seat.player ? (
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#D8BBF4] text-xs font-black text-[#32154f] ring-2 ring-[#32154f]">
              {(seat.player.name ?? "?").charAt(0).toUpperCase()}
            </span>
          ) : (
            <span className="block h-9 w-9 rounded-full border border-dashed border-white/25 bg-black/10 ring-2 ring-[#32154f]" />
          )}
        </li>
      ))}
    </ul>
  );
}

function ShowcaseSkeletons() {
  return (
    <section className="mt-10" aria-busy="true" aria-label="Loading games">
      <div className="mb-4 h-8 w-48 animate-pulse rounded bg-white/10" />
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[390px] w-[82vw] max-w-[360px] shrink-0 animate-pulse rounded-[28px] border border-white/10 bg-white/5"
          />
        ))}
      </div>
    </section>
  );
}

function EmptyLobby() {
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
      className="mt-10 rounded-3xl border border-dashed border-white/15 bg-white/3 p-10 text-center"
    >
      <ul className="mb-5 flex justify-center gap-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            data-seat
            className="h-11 w-11 rounded-full border border-dashed border-white/25"
          />
        ))}
      </ul>
      <h2 className="text-xl font-black">No games are live</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm font-medium text-white/55">
        Start the first table. Four people can sit; everyone after that drops in as a spectator.
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
    <div role="status" className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-5">
      <p className="flex items-center gap-2 font-bold text-white">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-sm text-white/55">{body}</p>
    </div>
  );
}

export default GameNightRoomsScreen;
