"use client";

/** Score list shared by round results, the match header, and match end. */

import type { GameNightState } from "./game-types";
import { nameFor } from "./game-types";
import { Avatar } from "./avatar.web";

export function Scoreboard({
  state,
  highlightUserId,
}: {
  state: GameNightState;
  highlightUserId?: string | null;
}) {
  const match = state.match;
  if (!match) return null;

  const players = state.members
    .filter((m) => m.role === "player")
    .map((m) => ({ member: m, score: match.scores[m.user_id] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <section aria-label="Scores">
      <h3 className="text-xs font-medium uppercase tracking-widest text-white/50">
        Scores · first to {match.target_score}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {players.map(({ member, score }) => {
          const highlighted = member.user_id === highlightUserId;
          return (
            <li
              key={member.user_id}
              className={`flex items-center gap-3 rounded-xl border p-2.5 ${
                highlighted
                  ? "border-[#8A40CF]/60 bg-[#8A40CF]/15"
                  : "border-white/10 bg-white/4"
              }`}
            >
              <Avatar name={member.name} src={member.avatar} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                {nameFor(state, member.user_id)}
                {member.user_id === state.me.user_id ? (
                  <span className="text-white/40"> (you)</span>
                ) : null}
              </span>
              <span
                className={`text-sm font-bold tabular-nums ${
                  highlighted ? "text-[#C9A2F0]" : "text-white/80"
                }`}
              >
                {score}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
