"use client";

/**
 * Classic mode round flow: submitting -> judging -> round_results (+voided).
 * The judge gets the anonymous reveal list and the winner pick; everyone else
 * gets the submissions counter and, once revealed, the same projection.
 */

import { judgePick } from "../rooms-api";
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
                className={`relative overflow-hidden rounded-xl p-4 pb-6 shadow-[0_6px_20px_rgba(40,60,129,0.18)] ${
                  won ? "bg-white ring-2 ring-[#d9a419]" : "bg-white"
                }`}
              >
                <p aria-hidden className="mb-1.5 text-[8px] font-bold uppercase tracking-[0.2em] text-[#283C81]">
                  Keep It 100
                </p>
                <div className="space-y-1">
                  {r.texts.map((t, i) => (
                    <p key={i} className="font-semibold text-[#141414]">
                      {t}
                    </p>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-2 text-xs text-[#283C81]/80">
                  {won ? (
                    <span className="font-bold text-[#8a6d00]">
                      Winner · {r.name ?? nameFor(state, r.user_id)}
                    </span>
                  ) : (
                    (r.name ?? nameFor(state, r.user_id))
                  )}
                </p>
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-2 bg-[#283C81]" />
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
                    className="relative w-full overflow-hidden rounded-xl bg-white p-4 pb-6 text-left shadow-[0_6px_20px_rgba(40,60,129,0.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(40,60,129,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a419] disabled:opacity-50"
                  >
                    <span aria-hidden className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.2em] text-[#283C81]">
                      Keep It 100
                    </span>
                    <span className="space-y-1">
                      {r.texts.map((t, i) => (
                        <span key={i} className="block font-semibold text-[#141414]">
                          {t}
                        </span>
                      ))}
                    </span>
                    <span className="mt-2 block text-xs font-semibold text-[#283C81]">
                      Pick winner
                    </span>
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-2 bg-[#283C81]" />
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
                  className="relative overflow-hidden rounded-xl bg-white p-4 pb-6 shadow-[0_6px_20px_rgba(40,60,129,0.18)]"
                >
                  <p aria-hidden className="mb-1.5 text-[8px] font-bold uppercase tracking-[0.2em] text-[#283C81]">
                    Keep It 100
                  </p>
                  {r.texts.map((t, i) => (
                    <p key={i} className="font-semibold text-[#141414]">
                      {t}
                    </p>
                  ))}
                  {r.name ? (
                    <p className="mt-2 flex items-center gap-2 text-xs text-[#283C81]/80">
                      {r.name}
                    </p>
                  ) : null}
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-2 bg-[#283C81]" />
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
