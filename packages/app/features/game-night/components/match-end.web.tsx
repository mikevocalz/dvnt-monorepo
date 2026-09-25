"use client";

/** Match completed/abandoned: winner banner, final scores, host rematch. */

import { Trophy } from "lucide-react";
import { startMatch } from "../rooms-api";
import { Scoreboard } from "./scoreboard.web";
import { GameNightLeaderboard } from "./leaderboard";
import { CommandError, useCommand } from "./use-command";
import { nameFor, type GameNightState } from "./game-types";

export function MatchEnd({
  state,
  code,
  onChanged,
}: {
  state: GameNightState;
  code: string;
  onChanged: () => void;
}) {
  const match = state.match;
  const cmd = useCommand();
  if (!match) return null;

  const winner = match.winner_user_id;
  const heading = match.tied
    ? "It's a tie"
    : winner
      ? `${nameFor(state, winner)} wins${winner === state.me.user_id ? " — you take it" : ""}`
      : match.status === "abandoned"
        ? "Match abandoned"
        : "Match over";

  return (
    <section aria-label="Match result" className="w-full">
      <div className="rounded-2xl border border-[#8A40CF]/50 bg-[#8A40CF]/15 p-6 text-center">
        <Trophy aria-hidden className="mx-auto h-8 w-8 text-[#C9A2F0]" />
        <h2 className="mt-2 text-2xl font-bold text-white">{heading}</h2>
      </div>

      <div className="mt-5">
        <Scoreboard state={state} highlightUserId={winner} />
      </div>

      <h3 className="mt-8 text-sm font-medium uppercase tracking-widest text-[#C9A2F0]">
        All-time top players
      </h3>
      <div className="mt-3">
        <GameNightLeaderboard mode={match.mode === "duel" ? "duel" : "classic"} />
      </div>

      {state.me.is_host ? (
        <div className="mt-5">
          <button
            type="button"
            disabled={cmd.pending}
            onClick={() =>
              cmd.run(async () => {
                await startMatch(code, crypto.randomUUID());
                onChanged();
              })
            }
            className="rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7A35BC] disabled:opacity-40"
          >
            {cmd.pending ? "Starting…" : "Rematch"}
          </button>
          <CommandError message={cmd.error} />
        </div>
      ) : null}
    </section>
  );
}
