"use client";

/**
 * Game Night — room (WEB).
 *
 * The code still leads: someone has to be able to read it aloud and send the
 * link. On top of that sits the full game — seats and ready before the
 * match, the prompt/hand/judging loop during it, scores and rematch after.
 *
 * Game truth comes from `useGameNightState` (the server projection, which is
 * deliberately role-aware — watchers never see hands). The presence roster
 * stays for "who is connected right now", which is a different fact from
 * membership.
 *
 * Web laws: semantic HTML + Tailwind, no <View>/<Text>. State is Zustand.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "solito/navigation";
import { Link } from "solito/link";
import {
  Gamepad2,
  Check,
  Copy,
  LogOut,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useGameNightStore } from "../store";
import { useRoomPresence } from "../use-room-presence";
import { normalizeRoomCode, isCompleteRoomCode } from "../room-code";
import { useGameNightState } from "../use-game-state";
import { useRoomYDoc } from "../use-room-ydoc";
import { leaveRoom, endRoom, judgePick, duelPick } from "../rooms-api";
import { SeatGrid } from "../components/seat-grid.web";
import { ClassicRound } from "../components/classic-round.web";
import { DuelRound } from "../components/duel-round.web";
import { MatchEnd } from "../components/match-end.web";
import { Scoreboard } from "../components/scoreboard.web";
import { RoomChat } from "../components/room-chat.web";
import { Countdown, PromptCard } from "../components/prompt-card.web";
import { CommandError, useCommand } from "../components/use-command";
import { TableRenderer } from "../components/table";
import type { GameTableProps, TableMember } from "../components/table/types";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true, // server render assumes online; the client corrects on mount
  );
}

export function GameNightRoomScreen() {
  const params = useParams<{ id?: string | string[] }>();
  const router = useRouter();
  const raw = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const code = raw ? normalizeRoomCode(raw) : "";
  const valid = isCompleteRoomCode(code);

  const user = useAuthStore((s) => s.user);
  const players = useGameNightStore((s) => s.players);
  const copied = useGameNightStore((s) => s.copied);
  const setCopied = useGameNightStore((s) => s.setCopied);
  const online = useIsOnline();

  const { state, status, error, refresh } = useGameNightState(
    valid ? code : undefined,
  );

  useRoomPresence(
    valid ? code : null,
    user
      ? {
          id: user.id,
          name: user.name || user.username || null,
          avatar: user.avatar ?? null,
          joinedAt: 0,
        }
      : null,
  );

  // Polls/realtime do the heavy lifting; refocusing the tab is the one moment
  // a stale projection is guaranteed to be noticed, so refresh there too.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied, setCopied]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/game-night/room/${code}`,
      );
      setCopied(true);
    } catch {
      // Clipboard can be denied outright. The code is on screen — the person
      // still has everything they need, say nothing and let them read it out.
    }
  }, [code, setCopied]);

  const leave = useCallback(async () => {
    try {
      await leaveRoom(code);
    } catch {
      // Leaving is a navigation too: even if the write fails, do not trap
      // the person on a dead screen.
    }
    router.push("/game-night");
  }, [code, router]);

  // ---- Yjs doc (read-only projection mirror) ----
  const yDoc = useRoomYDoc(
    state?.room.id ?? null,
    valid ? code : null,
    state?.server_time,
  );

  useEffect(() => {
    if (yDoc.error) console.warn("[game-night] ydoc sync error:", yDoc.error);
  }, [yDoc.error]);

  // ---- Shared card-selection state (Hand + TableRenderer) ----
  const [tableSelected, setTableSelected] = useState<string[]>([]);
  const pick = state?.round?.prompt?.pick ?? 1;

  const toggleCard = useCallback(
    (cardId: string) => {
      setTableSelected((prev) => {
        if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
        if (prev.length >= pick) return prev;
        return [...prev, cardId];
      });
    },
    [pick],
  );

  // Reset selection when the round changes.
  const roundId = state?.round?.id;
  useEffect(() => {
    setTableSelected([]);
  }, [roundId]);

  // ---- Table command wrappers (judge pick, duel pick) ----
  const tableCmd = useCommand();

  const handlePickWinner = useCallback(
    (submissionId: number) => {
      void tableCmd.run(async () => {
        await judgePick(code, submissionId, crypto.randomUUID());
        refresh();
      });
    },
    [code, refresh, tableCmd],
  );

  const handleDuelPick = useCallback(
    (cardId: string) => {
      void tableCmd.run(async () => {
        await duelPick(code, cardId, crypto.randomUUID());
        refresh();
      });
    },
    [code, refresh, tableCmd],
  );

  if (!valid) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#06070d] px-6 text-center text-white">
        <div className="max-w-sm">
          <h1 className="text-2xl font-semibold">That room code is not valid</h1>
          <p className="mt-2 text-white/60">
            Codes are six characters. Check the one you were given.
          </p>
          <Link
            href="/game-night"
            className="mt-6 inline-block rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white hover:bg-[#7A35BC]"
          >
            Back to Game Night
          </Link>
        </div>
      </main>
    );
  }

  if (status === "not_found") {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#06070d] px-6 text-center text-white">
        <div className="max-w-sm">
          <h1 className="text-2xl font-semibold">No room with that code</h1>
          <p className="mt-2 text-white/60">
            It may have ended, or the code is off by a character.
          </p>
          <Link
            href="/game-night"
            className="mt-6 inline-block rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white hover:bg-[#7A35BC]"
          >
            Back to Game Night
          </Link>
        </div>
      </main>
    );
  }

  const match = state?.match ?? null;
  const round = state?.round ?? null;
  const playing = state?.room.status === "playing";
  const matchOver = match && match.status !== "active";
  const memberCount = state?.members.length ?? players.length;
  const watcherMode = state?.me.role === "watcher";

  return (
    <main className="min-h-dvh bg-[#06070d] px-6 py-8 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#8A40CF]/40 bg-[#8A40CF]/10 px-3 py-1 text-xs font-medium tracking-wide text-[#C9A2F0]">
            <Gamepad2 aria-hidden className="h-3.5 w-3.5" />
            Game Night
          </span>
          <p className="font-mono text-2xl font-semibold tracking-[0.18em]">
            {code}
          </p>
          <button
            type="button"
            onClick={copyLink}
            aria-label="Copy join link"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:bg-white/10"
          >
            {copied ? (
              <Check aria-hidden className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <Copy aria-hidden className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy link"}
          </button>
          <p aria-live="polite" className="sr-only">
            {copied ? "Join link copied to clipboard" : ""}
          </p>
          <span className="text-sm text-white/50">
            {memberCount} {memberCount === 1 ? "person" : "people"} here
          </span>
          <span className="flex-1" />
          {round?.deadline_at && match?.status === "active" ? (
            <Countdown deadlineAt={round.deadline_at} />
          ) : null}
          <button
            type="button"
            onClick={() => void leave()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-sm font-semibold text-white/75 transition-colors hover:bg-white/10"
          >
            <LogOut aria-hidden className="h-4 w-4" />
            Leave
          </button>
        </header>

        {!online ? (
          <div
            role="status"
            className="mt-6 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 p-4 text-sm"
          >
            <WifiOff aria-hidden className="h-4 w-4" />
            You are offline — the table will catch up when you reconnect.
          </div>
        ) : null}

        {status === "error" ? (
          <div
            role="alert"
            className="mt-6 flex items-center gap-2 rounded-xl border border-[#F0A2A2]/40 bg-[#F0A2A2]/10 p-4 text-sm"
          >
            <AlertTriangle aria-hidden className="h-4 w-4 text-[#F0A2A2]" />
            Could not reach the room{error ? `: ${error}` : ""}.
            <button
              type="button"
              onClick={() => void refresh()}
              className="ml-2 font-semibold text-[#C9A2F0] underline"
            >
              Retry
            </button>
          </div>
        ) : null}

        {yDoc.error ? (
          <div
            role="status"
            className="mt-2 flex items-center gap-2 text-xs text-white/40"
          >
            <AlertTriangle aria-hidden className="h-3 w-3" />
            Live sync unavailable
          </div>
        ) : yDoc.synced ? (
          <div
            role="status"
            className="mt-2 flex items-center gap-2 text-xs text-white/30"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Synced
          </div>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-8">
            {status === "loading" || status === "idle" ? (
              <div aria-busy="true" className="space-y-3">
                <div className="h-40 animate-pulse rounded-2xl bg-white/5" />
                <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
              </div>
            ) : !state ? null : state.room.status === "ended" ? (
              <EndedRoom />
            ) : (
              <>
                {/* 3-D table scene: visible only during an active match. */}
                {playing && round && !matchOver && round.prompt ? (
                  <section aria-label="Table scene">
                    <TableRenderer
                      state={deriveTableState(round.phase, match?.mode)}
                      prompt={{
                        text: round.prompt.text,
                        pick: round.prompt.pick,
                      }}
                      myHand={state.me.hand}
                      selected={tableSelected}
                      submissionsIn={round.submissions_in}
                      submissionsExpected={round.submissions_expected}
                      reveal={
                        round.reveal.length > 0
                          ? round.reveal.map((r) => ({
                              submission_id: r.submission_id,
                              texts: r.texts,
                              is_winner: r.is_winner,
                            }))
                          : null
                      }
                      members={buildTableMembers(state.members)}
                      myUserId={state.me.user_id}
                      judgeUserId={round.judge_user_id ?? undefined}
                      onSelectCard={toggleCard}
                      onPickWinner={handlePickWinner}
                      onDuelPick={
                        match?.mode === "duel" ? handleDuelPick : undefined
                      }
                      duelOptions={round.duel_options}
                    />
                  </section>
                ) : null}

                {/* Prompt anchors the table whenever a round is live. */}
                {round?.prompt ? (
                  <section aria-label="Prompt">
                    <div className="flex flex-wrap items-center gap-3">
                      <PromptCard
                        text={round.prompt.text}
                        pick={round.prompt.pick}
                        label={
                          match?.mode === "duel"
                            ? `Duel · round ${round.round_no}`
                            : `Round ${round.round_no}`
                        }
                      />
                    </div>
                  </section>
                ) : null}

                {matchOver ? (
                  <MatchEnd state={state} code={code} onChanged={refresh} />
                ) : playing && round ? (
                  match?.mode === "duel" ? (
                    <DuelRound state={state} code={code} onChanged={refresh} />
                  ) : (
                    <ClassicRound
                      state={state}
                      code={code}
                      onChanged={() => {
                        setTableSelected([]);
                        refresh();
                      }}
                      controlledSelected={tableSelected}
                      onToggleCard={toggleCard}
                    />
                  )
                ) : (
                  <SeatGrid state={state} code={code} onChanged={refresh} />
                )}

                {watcherMode && playing ? (
                  <p className="rounded-xl border border-white/15 bg-white/5 p-3 text-sm text-white/55">
                    Watching this match — you can chat, react, and see
                    everything on the table.
                  </p>
                ) : null}

                {match ? (
                  <Scoreboard
                    state={state}
                    highlightUserId={round?.winner_user_id}
                  />
                ) : null}

                {state.me.is_host ? (
                  <HostControls code={code} onChanged={refresh} />
                ) : null}
              </>
            )}
          </div>

          {state ? <RoomChat state={state} /> : null}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Table-renderer helpers (pure, no hooks)
// ---------------------------------------------------------------------------

function deriveTableState(
  phase: string | undefined,
  mode: string | undefined,
): GameTableProps["state"] {
  if (mode === "duel") return "duel";
  switch (phase) {
    case "judging":
      return "judging";
    case "round_results":
    case "duel_results":
      return "results";
    case "submitting":
    case "dealing":
    case "duel_lock":
      return "submitting";
    default:
      return "lobby";
  }
}

function buildTableMembers(
  members: { user_id: string; name: string | null; seat_no: number | null; avatar: string | null }[],
): TableMember[] {
  return members
    .filter((m): m is typeof m & { seat_no: number } => m.seat_no != null)
    .map((m, i) => ({
      user_id: m.user_id,
      name: m.name ?? `Player ${i + 1}`,
      avatar: m.avatar ?? "",
      seat_no: m.seat_no,
    }));
}

// ---------------------------------------------------------------------------

function EndedRoom() {
  return (
    <section className="rounded-2xl border border-white/15 bg-white/5 p-6 text-center">
      <h2 className="text-xl font-semibold text-white">This room has ended</h2>
      <p className="mt-2 text-sm text-white/55">
        Thanks for playing. Start a new table when you are ready for another.
      </p>
      <Link
        href="/game-night"
        className="mt-4 inline-block rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white hover:bg-[#7A35BC]"
      >
        Back to Game Night
      </Link>
    </section>
  );
}

function HostControls({
  code,
  onChanged,
}: {
  code: string;
  onChanged: () => void;
}) {
  const cmd = useCommand();
  return (
    <section aria-label="Host controls">
      <button
        type="button"
        disabled={cmd.pending}
        onClick={() =>
          cmd.run(async () => {
            await endRoom(code);
            onChanged();
          })
        }
        className="rounded-xl border border-[#F0A2A2]/40 px-4 py-2 text-sm font-semibold text-[#F0A2A2] transition-colors hover:bg-[#F0A2A2]/10 disabled:opacity-40"
      >
        {cmd.pending ? "Ending…" : "End room"}
      </button>
      <CommandError message={cmd.error} />
    </section>
  );
}

export default GameNightRoomScreen;
