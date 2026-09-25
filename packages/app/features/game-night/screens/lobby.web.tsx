"use client";

/**
 * Game Night — lobby (WEB).
 *
 * Two doors, and nothing else: start a room, or join one someone read out to
 * you. There is no room list, because a party game is started by a person
 * telling another person a code, not by browsing.
 *
 * Web laws: semantic HTML + Tailwind, no <View>/<Text>. State is Zustand.
 * Navigation via solito. bg #06070d, accent brand purple #8A40CF.
 */

import { useCallback, useState } from "react";
import { useRouter } from "solito/navigation";
import { Gamepad2, ArrowRight } from "lucide-react";
import { useGameNightStore } from "../store";
import { createRoom, joinRoom as joinRoomByCode } from "../rooms-api";
import { GameNightLeaderboard } from "../components/leaderboard";
import {
  normalizeRoomCode,
  isCompleteRoomCode,
  ROOM_CODE_LENGTH,
} from "../room-code";

export function GameNightLobbyScreen() {
  const router = useRouter();
  const joinCode = useGameNightStore((s) => s.joinCode);
  const setJoinCode = useGameNightStore((s) => s.setJoinCode);

  const ready = isCompleteRoomCode(joinCode);

  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [joinPending, setJoinPending] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

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
        err instanceof Error ? err.message : "Couldn't start a room.",
      );
    } finally {
      setStartPending(false);
    }
  }, [router]);

  const joinRoom = useCallback(async () => {
    if (!ready) return;
    setJoinError(null);
    setJoinPending(true);
    try {
      const normalized = normalizeRoomCode(joinCode);
      const { roomCode } = await joinRoomByCode(normalized);
      router.push(`/game-night/room/${roomCode}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't join the room.";
      setJoinError(msg);
    } finally {
      setJoinPending(false);
    }
  }, [ready, joinCode, router]);

  return (
    <main className="min-h-dvh bg-[#06070d] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-md">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#8A40CF]/40 bg-[#8A40CF]/10 px-3 py-1 text-xs font-medium tracking-wide text-[#C9A2F0]">
          <Gamepad2 aria-hidden className="h-3.5 w-3.5" />
          Party card game
        </span>

        <h1 className="mt-5 text-4xl font-semibold tracking-tight">
          Game Night
        </h1>
        <p className="mt-2 text-white/60">
          Start a room and read the code to whoever you are playing with.
        </p>

        <button
          type="button"
          disabled={startPending}
          onClick={startRoom}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#8A40CF] px-5 py-3.5 font-semibold text-white transition-colors hover:bg-[#7A35BC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Start a room
          <ArrowRight aria-hidden className="h-4 w-4" />
        </button>
        {startError ? (
          <p className="mt-2 text-sm text-red-400">{startError}</p>
        ) : null}

        <div className="my-8 flex items-center gap-4 text-xs uppercase tracking-widest text-white/30">
          <span className="h-px flex-1 bg-white/10" />
          or
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            joinRoom();
          }}
        >
          <label
            htmlFor="game-night-code"
            className="block text-sm font-medium text-white/80"
          >
            Join with a code
          </label>
          <input
            id="game-night-code"
            value={joinCode}
            onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="ABC234"
            aria-describedby="game-night-code-hint"
            className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 font-mono text-2xl tracking-[0.35em] text-white placeholder:text-white/25 focus:border-[#8A40CF] focus:outline-none"
          />
          <p id="game-night-code-hint" className="mt-2 text-xs text-white/40">
            {ROOM_CODE_LENGTH} characters. Case does not matter.
          </p>

          <button
            type="submit"
            disabled={!ready || joinPending}
            className="mt-4 w-full rounded-xl border border-white/15 px-5 py-3.5 font-semibold text-white transition-colors enabled:hover:border-[#8A40CF] enabled:hover:bg-[#8A40CF]/10 disabled:cursor-not-allowed disabled:text-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0]"
          >
            Join room
          </button>
          {joinError ? (
            <p className="mt-2 text-sm text-red-400">{joinError}</p>
          ) : null}
        </form>

        <h2 className="mt-12 text-sm font-medium uppercase tracking-widest text-[#C9A2F0]">
          Top players
        </h2>
        <div className="mt-3">
          <GameNightLeaderboard mode="classic" />
        </div>
      </div>
    </main>
  );
}

export default GameNightLobbyScreen;
