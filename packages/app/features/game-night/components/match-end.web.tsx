"use client";

/** Match completed/abandoned: result stage, final scores, leaderboard, rematch. */

import { Crown, Trophy } from "lucide-react";
import { startMatch } from "../rooms-api";
import { Scoreboard } from "./scoreboard.web";
import { GameNightLeaderboard } from "./leaderboard";
import { GameNightButton } from "./game-night-button.web";
import { CommandError, useCommand } from "./use-command";
import { nameFor, type GameNightState } from "./game-types";
import { GAME_NIGHT_RIVE_HUD } from "../motion/rive-hud-contract";

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
  const isMe = winner === state.me.user_id;
  const heading = match.tied
    ? "Dead heat"
    : winner
      ? isMe
        ? "You won"
        : `${nameFor(state, winner)} won`
      : match.status === "abandoned"
        ? "Match abandoned"
        : "Match over";

  return (
    <section
      aria-label="Match result"
      data-rive-artboard={GAME_NIGHT_RIVE_HUD.artboards.result}
      data-rive-state-machine={GAME_NIGHT_RIVE_HUD.stateMachine}
      data-rive-celebrate={Boolean(winner)}
      data-rive-is-winner={isMe}
      className="w-full"
    >
      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0e15] shadow-[0_36px_110px_rgba(0,0,0,.42)]">
        <div className="relative overflow-hidden px-6 py-8 text-center sm:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-90"
            style={{
              background:
                "radial-gradient(circle at 50% -10%, rgba(138,64,207,.58), transparent 46%), radial-gradient(circle at 82% 18%, rgba(217,164,25,.18), transparent 32%)",
            }}
          />
          <div className="relative">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#D9A419]/35 bg-[#D9A419]/10 shadow-[0_12px_38px_rgba(217,164,25,.16)]">
              {winner ? (
                <Crown aria-hidden className="h-7 w-7 text-[#FFD865]" />
              ) : (
                <Trophy aria-hidden className="h-7 w-7 text-[#C9A2F0]" />
              )}
            </span>
            <p className="mt-4 text-[10px] font-black uppercase tracking-[0.24em] text-[#C9A2F0]">
              Final result
            </p>
            <h2 className="mt-1 text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">
              {heading}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm font-medium text-white/55">
              {match.tied
                ? "Nobody gets the easy victory lap. Run it back."
                : winner
                  ? "Final scores are locked. The table is ready for another round."
                  : "The room closed before a winner was declared."}
            </p>
          </div>
        </div>

        <div className="grid gap-0 border-t border-white/8 lg:grid-cols-[1.08fr_.92fr]">
          <div className="p-5 sm:p-6 lg:border-r lg:border-white/8">
            <Scoreboard state={state} highlightUserId={winner} />

            {state.me.is_host ? (
              <div className="mt-5">
                <GameNightButton
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
                  {cmd.pending ? "Starting…" : "Play again"}
                </GameNightButton>
                <CommandError message={cmd.error} />
              </div>
            ) : (
              <p className="mt-5 rounded-2xl border border-white/10 bg-white/4 p-4 text-sm font-semibold text-white/55">
                Waiting for the host to run it back.
              </p>
            )}
          </div>

          <div className="bg-black/16 p-5 sm:p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A2F0]">
              All-time
            </p>
            <h3 className="mt-1 text-xl font-black tracking-tight text-white">
              Leaderboard
            </h3>
            <div className="mt-4">
              <GameNightLeaderboard mode={match.mode === "duel" ? "duel" : "classic"} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
