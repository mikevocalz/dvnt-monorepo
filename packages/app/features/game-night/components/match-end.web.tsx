"use client";

/** Match completed/abandoned: cinematic result panel, scores and rematch. */

import { RotateCcw, Sparkles, Trophy } from "lucide-react";
import { startMatch } from "../rooms-api";
import { GAME_NIGHT_RIVE_HUD } from "../motion/rive-hud-contract";
import { Scoreboard } from "./scoreboard.web";
import { GameNightLeaderboard } from "./leaderboard";
import { GameNightButton } from "./game-night-button.web";
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
  const winnerScore = winner ? (match.scores[winner] ?? 0) : 0;
  const isMe = winner === state.me.user_id;
  const heading = match.tied
    ? "It’s a tie"
    : winner
      ? isMe
        ? "You win!"
        : `${nameFor(state, winner)} wins`
      : match.status === "abandoned"
        ? "Match abandoned"
        : "Match over";

  return (
    <section
      aria-label="Match result"
      data-rive-artboard={GAME_NIGHT_RIVE_HUD.artboards.result}
      data-rive-state-machine={GAME_NIGHT_RIVE_HUD.stateMachine}
      data-rive-is-winner={isMe}
      className="w-full overflow-hidden rounded-[32px] border border-white/10 bg-[#0B0B12] shadow-[0_32px_100px_rgba(0,0,0,.4)]"
    >
      <div className="relative overflow-hidden border-b border-white/10 px-5 py-7 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              "radial-gradient(circle at 18% 0%, rgba(138,64,207,.5), transparent 45%), radial-gradient(circle at 90% 40%, rgba(217,164,25,.16), transparent 38%)",
          }}
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/65 backdrop-blur-md">
              {isMe ? (
                <Sparkles aria-hidden className="h-3.5 w-3.5 text-[#FFD865]" />
              ) : (
                <Trophy aria-hidden className="h-3.5 w-3.5 text-[#C9A2F0]" />
              )}
              Match complete
            </span>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.05em] text-white sm:text-5xl">
              {heading}
            </h2>
            {winner ? (
              <p className="mt-2 text-sm font-semibold text-white/55">
                Final score · first to {match.target_score}
              </p>
            ) : null}
          </div>

          {winner ? (
            <div className="min-w-36 rounded-2xl border border-[#D9A419]/30 bg-[#D9A419]/10 px-5 py-4 sm:text-right">
              <span className="block text-4xl font-black tabular-nums tracking-[-0.06em] text-[#FFD865]">
                {winnerScore}
              </span>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FFD865]/55">
                points
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-7 p-5 sm:p-8 xl:grid-cols-[1.05fr_.95fr]">
        <div>
          <Scoreboard state={state} highlightUserId={winner} />

          {state.me.is_host ? (
            <div className="mt-5">
              <GameNightButton
                type="button"
                kind="primary"
                disabled={cmd.pending}
                onClick={() =>
                  cmd.run(async () => {
                    await startMatch(code, crypto.randomUUID());
                    onChanged();
                  })
                }
                className="w-full sm:w-auto"
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCcw aria-hidden className="h-4 w-4" />
                  {cmd.pending ? "Starting…" : "Play again"}
                </span>
              </GameNightButton>
              <CommandError message={cmd.error} />
            </div>
          ) : (
            <p className="mt-4 text-sm font-semibold text-white/45">
              Waiting for the host to start the next game.
            </p>
          )}
        </div>

        <div>
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A2F0]">
            All-time standings
          </p>
          <GameNightLeaderboard mode={match.mode === "duel" ? "duel" : "classic"} />
        </div>
      </div>
    </section>
  );
}
