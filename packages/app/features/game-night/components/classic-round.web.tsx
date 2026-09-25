"use client";

/**
 * Classic mode round flow: submitting -> judging -> round_results (+voided).
 * The judge gets the anonymous reveal list and the winner pick; everyone else
 * gets the submissions counter and, once revealed, the same projection.
 */

import { judgePick } from "../rooms-api";
import { Avatar } from "./avatar.web";
import { CommandError, useCommand } from "./use-command";
import { nameFor, type GameNightState } from "./game-types";
import { Hand } from "./hand.web";

export function ClassicRound({
  state,
  code,
  onChanged,
  controlledSelected,
  onToggleCard,
}: {
  state: GameNightState;
  code: string;
  onChanged: () => void;
  controlledSelected?: string[];
  onToggleCard?: (cardId: string) => void;
}) {
  const round = state.round;
  if (!round) return null;

  const isJudge = round.judge_user_id === state.me.user_id;
  const isPlayer = state.me.role === "player";
  const judgeCmd = useCommand();

  if (round.phase === "voided") {
    return (
      <p className="rounded-xl border border-white/15 bg-white/5 p-4 text-center text-sm text-white/60">
        Round skipped.
      </p>
    );
  }

  if (round.phase === "round_results") {
    const winnerId = round.winner_user_id ?? null;
    return (
      <section aria-label="Round results" className="w-full">
        <h3 className="text-sm font-medium uppercase tracking-widest text-white/50">
          Round {round.round_no} results
        </h3>
        <ul className="mt-3 space-y-2">
          {round.reveal.map((r) => {
            const won = r.is_winner || r.user_id === winnerId;
            return (
              <li
                key={r.submission_id}
                className={`rounded-xl border p-4 ${
                  won
                    ? "border-[#8A40CF]/60 bg-[#8A40CF]/15"
                    : "border-white/10 bg-white/4"
                }`}
              >
                <div className="space-y-1">
                  {r.texts.map((t, i) => (
                    <p key={i} className="font-medium text-white">
                      {t}
                    </p>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-2 text-xs text-white/55">
                  {won ? (
                    <span className="font-semibold text-[#C9A2F0]">
                      Winner · {r.name ?? nameFor(state, r.user_id)}
                    </span>
                  ) : (
                    (r.name ?? nameFor(state, r.user_id))
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // submitting / judging
  return (
    <section aria-label="Round in progress" className="w-full">
      <p className="text-sm text-white/60" aria-live="polite">
        {round.submissions_in} of {round.submissions_expected} answers in
        {round.judge_user_id
          ? ` · ${nameFor(state, round.judge_user_id)} is judging`
          : ""}
      </p>

      {round.phase === "judging" || round.reveal.length > 0 ? (
        isJudge ? (
          <div className="mt-5">
            <h3 className="text-sm font-medium uppercase tracking-widest text-[#C9A2F0]">
              You are the judge — pick the winner
            </h3>
            <ul className="mt-3 space-y-2">
              {round.reveal.map((r) => (
                <li key={r.submission_id}>
                  <button
                    type="button"
                    disabled={judgeCmd.pending}
                    onClick={() =>
                      judgeCmd.run(async () => {
                        await judgePick(
                          code,
                          r.submission_id,
                          crypto.randomUUID(),
                        );
                        onChanged();
                      })
                    }
                    className="w-full rounded-xl border border-white/15 bg-white/4 p-4 text-left transition-colors hover:border-[#8A40CF]/70 hover:bg-[#8A40CF]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A2F0] disabled:opacity-50"
                  >
                    <span className="space-y-1">
                      {r.texts.map((t, i) => (
                        <span key={i} className="block font-medium text-white">
                          {t}
                        </span>
                      ))}
                    </span>
                    <span className="mt-2 block text-xs font-semibold text-[#C9A2F0]">
                      Pick winner
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <CommandError message={judgeCmd.error} />
          </div>
        ) : (
          <div className="mt-5">
            <h3 className="text-sm font-medium uppercase tracking-widest text-white/50">
              On the table
            </h3>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {round.reveal.map((r) => (
                <li
                  key={r.submission_id}
                  className="rounded-xl border border-white/10 bg-white/4 p-4"
                >
                  {r.texts.map((t, i) => (
                    <p key={i} className="font-medium text-white">
                      {t}
                    </p>
                  ))}
                  {r.name ? (
                    <p className="mt-2 flex items-center gap-2 text-xs text-white/55">
                      {r.name}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-white/50">
              {isPlayer
                ? "Waiting for the judge."
                : "The judge is reading them now."}
            </p>
          </div>
        )
      ) : isPlayer && !isJudge ? (
        <div className="mt-5">
          <Hand
            state={state}
            code={code}
            onSubmitted={onChanged}
            controlledSelected={controlledSelected}
            onToggleCard={onToggleCard}
          />
        </div>
      ) : isJudge ? (
        <p className="mt-5 rounded-xl border border-[#8A40CF]/40 bg-[#8A40CF]/10 p-4 text-sm text-[#C9A2F0]">
          You are judging this round — answers are still coming in.
        </p>
      ) : (
        <p className="mt-5 rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-white/60">
          Players are writing their answers.
        </p>
      )}
    </section>
  );
}
