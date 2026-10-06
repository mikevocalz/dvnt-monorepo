"use client";

/** Live match score rail + authored Rive binding seam. */

import { Crown } from "lucide-react";
import type { GameNightState } from "./game-types";
import { nameFor } from "./game-types";
import { Avatar } from "./avatar.web";
import { rankScores } from "./scoreboard-model";
import {
  GAME_NIGHT_RIVE_HUD,
  scoreHudBindings,
} from "../motion/rive-hud-contract";

export function Scoreboard({
  state,
  highlightUserId,
}: {
  state: GameNightState;
  highlightUserId?: string | null;
}) {
  const match = state.match;
  if (!match) return null;

  const players = rankScores(
    state.members
      .filter((member) => member.role === "player")
      .map((member) => ({
        value: member,
        userId: member.user_id,
        score: match.scores[member.user_id] ?? 0,
      })),
    match.target_score,
  );

  return (
    <section
      aria-label="Scores"
      data-rive-artboard={GAME_NIGHT_RIVE_HUD.artboards.score}
      data-rive-state-machine={GAME_NIGHT_RIVE_HUD.stateMachine}
      className="overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018))] p-4 shadow-[0_24px_80px_rgba(0,0,0,.24)] sm:p-5"
    >
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A2F0]">
            Live score
          </p>
          <h3 className="mt-1 text-lg font-black tracking-tight text-white">
            First to {match.target_score}
          </h3>
        </div>
        <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-bold tabular-nums text-white/55">
          {players.length} players
        </span>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2">
        {players.map(({ value: member, score, rank, progress, isLeader }) => {
          const highlighted = member.user_id === highlightUserId;
          const isMe = member.user_id === state.me.user_id;
          const bindings = scoreHudBindings({
            score,
            targetScore: match.target_score,
            rank,
            playerCount: players.length,
            isLeader,
            isWinner: highlighted,
            isMe,
          });

          return (
            <li
              key={member.user_id}
              data-rive-score={bindings.score}
              data-rive-target-score={bindings.targetScore}
              data-rive-rank={bindings.rank}
              data-rive-is-leader={bindings.isLeader}
              data-rive-is-winner={bindings.isWinner}
              data-rive-is-me={bindings.isMe}
              className={`relative overflow-hidden rounded-2xl border p-3 transition-all duration-300 ${
                highlighted
                  ? "border-[#D9A419]/60 bg-[#D9A419]/10 shadow-[0_10px_34px_rgba(217,164,25,.12)]"
                  : isMe
                    ? "border-[#8A40CF]/60 bg-[#8A40CF]/14"
                    : "border-white/8 bg-black/18"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <Avatar name={member.name} src={member.avatar} size="sm" />
                  <span
                    className={`absolute -bottom-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full border border-[#08090f] px-1 text-[9px] font-black ${
                      rank === 1
                        ? "bg-[#D9A419] text-[#171008]"
                        : "bg-[#24172e] text-white/70"
                    }`}
                    aria-label={`rank ${rank}`}
                  >
                    {rank}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-black text-white">
                      {nameFor(state, member.user_id)}
                    </span>
                    {isMe ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#C9A2F0]">
                        you
                      </span>
                    ) : null}
                    {isLeader ? (
                      <Crown
                        aria-label="Leader"
                        className="h-3.5 w-3.5 shrink-0 text-[#D9A419]"
                      />
                    ) : null}
                  </div>
                  <div
                    aria-hidden
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"
                  >
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${
                        highlighted
                          ? "bg-[#D9A419]"
                          : "bg-[linear-gradient(90deg,#8A40CF,#C9A2F0)]"
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={`block text-2xl font-black tabular-nums tracking-[-0.04em] ${
                      highlighted ? "text-[#FFD865]" : "text-white"
                    }`}
                  >
                    {score}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-white/35">
                    points
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
