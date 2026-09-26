"use client";

/**
 * Duel mode: one subject, six options, everyone else predicts what the
 * subject picked. Subject and predictor get the same option grid with a
 * different sentence over it.
 */

import { duelPick } from "../rooms-api";
import { CommandError, useCommand } from "./use-command";
import { nameFor, type GameNightState } from "./game-types";

export function DuelRound({
  state,
  code,
  onChanged,
}: {
  state: GameNightState;
  code: string;
  onChanged: () => void;
}) {
  const round = state.round;
  if (!round) return null;

  const subjectId = round.duel_subject_user_id;
  const isSubject = subjectId === state.me.user_id;
  const subjectName = nameFor(state, subjectId);
  const options = round.duel_options ?? [];
  const cmd = useCommand();

  if (round.phase === "voided") {
    return (
      <p className="rounded-xl border border-white/15 bg-white/5 p-4 text-center text-sm text-white/60">
        Round skipped.
      </p>
    );
  }

  if (round.phase === "duel_results") {
    // The projection gives both locks only here: {subject, prediction,
    // subject_user_id, predictor_user_id}.
    const picks =
      round.duel_choices && "subject" in round.duel_choices
        ? round.duel_choices
        : null;
    const subjectText =
      options.find((o) => o.card_id === picks?.subject)?.text ?? "a card";
    const predictionText =
      options.find((o) => o.card_id === picks?.prediction)?.text ?? "a card";
    const correct =
      picks?.subject != null && picks.subject === picks.prediction;
    const predictorName = nameFor(state, picks?.predictor_user_id);
    return (
      <section aria-label="Duel results" className="w-full">
        <h3 className="text-sm font-medium uppercase tracking-widest text-white/50">
          Duel results
        </h3>
        <ul className="mt-3 space-y-1.5">
          <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/4 p-3 text-sm text-white/80">
            <span className="font-medium">{subjectName} picked</span>
            <span>{subjectText}</span>
          </li>
          <li
            className={`flex items-center justify-between rounded-xl border p-3 text-sm ${
              correct
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : "border-white/10 bg-white/4 text-white/70"
            }`}
          >
            <span className="font-medium">{predictorName} predicted</span>
            <span>
              {predictionText} {correct ? "— right" : "— wrong"}
            </span>
          </li>
        </ul>
      </section>
    );
  }

  // duel_lock: the caller's own lock is exposed as {mine, kind}.
  const myPick =
    round.duel_choices && "mine" in round.duel_choices
      ? round.duel_choices.mine
      : null;
  const isPlayer = state.me.role === "player";
  const locked = isPlayer && myPick != null;

  return (
    <section aria-label="Duel round" className="w-full">
      <h3 className="text-sm font-medium uppercase tracking-widest text-[#C9A2F0]">
        {isSubject
          ? "Pick your favorite"
          : isPlayer
            ? `Pick what ${subjectName} chose`
            : `${subjectName} is picking`}
      </h3>
      {isPlayer && !locked ? (
        <p className="mt-1 text-xs text-white/60">
          {isSubject
            ? "Tap one card — on the table or below. It locks in immediately."
            : "Tap one card — on the table or below. Your prediction locks in immediately."}
        </p>
      ) : null}
      {locked ? (
        <p className="mt-3 rounded-xl border border-[#8A40CF]/40 bg-[#8A40CF]/10 p-4 text-sm font-medium text-[#C9A2F0]">
          Locked in:{" "}
          {options.find((o) => o.card_id === myPick)?.text ?? "your pick"}
        </p>
      ) : isPlayer ? (
        <>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {options.map((o) => (
              <li key={o.card_id}>
                <button
                  type="button"
                  disabled={cmd.pending}
                  onClick={() =>
                    cmd.run(async () => {
                      await duelPick(code, o.card_id, crypto.randomUUID());
                      onChanged();
                    })
                  }
                  className="relative h-full min-h-24 w-full overflow-hidden rounded-xl bg-white p-3 pb-5 text-left text-sm font-semibold text-[#141414] shadow-[0_6px_20px_rgba(40,60,129,0.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(40,60,129,0.3)] focus-visible:outline-2 focus-visible:outline-[#d9a419] disabled:opacity-50"
                >
                  <span aria-hidden className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.2em] text-[#283C81]">
                    Keep It 100
                  </span>
                  {o.text}
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-2 bg-[#283C81]" />
                </button>
              </li>
            ))}
          </ul>
          <CommandError message={cmd.error} />
        </>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o) => (
            <li
              key={o.card_id}
              className="relative overflow-hidden rounded-xl bg-white p-3 pb-5 text-sm font-semibold text-[#141414] shadow-[0_6px_20px_rgba(40,60,129,0.18)]"
            >
              <span aria-hidden className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.2em] text-[#283C81]">
                Keep It 100
              </span>
              {o.text}
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-2 bg-[#283C81]" />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-white/50" aria-live="polite">
        {round.submissions_in} of {round.submissions_expected} picks in
      </p>
    </section>
  );
}
