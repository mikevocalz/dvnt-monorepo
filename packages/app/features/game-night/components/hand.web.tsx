"use client";

/**
 * The player's hand. Cards are real <button>s so they are keyboard operable;
 * selection order is tracked because multi-pick prompts submit an ordered
 * array of card ids.
 */

import { useMemo, useState } from "react";
import { submitCards } from "../rooms-api";
import { CommandError, useCommand } from "./use-command";
import type { GameNightState } from "./game-types";

export function Hand({
  state,
  code,
  onSubmitted,
  controlledSelected,
  onToggleCard,
}: {
  state: GameNightState;
  code: string;
  onSubmitted: () => void;
  /** When provided, the parent owns selection state (for the table scene). */
  controlledSelected?: string[];
  onToggleCard?: (cardId: string) => void;
}) {
  const pick = state.round?.prompt?.pick ?? 1;
  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const selected = controlledSelected ?? localSelected;
  const cmd = useCommand();

  const submitted = Boolean(state.round?.my_submission);

  const toggle = (cardId: string) => {
    if (onToggleCard) {
      onToggleCard(cardId);
      return;
    }
    setLocalSelected((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      if (prev.length >= pick) return prev;
      return [...prev, cardId];
    });
  };

  const play = () =>
    cmd.run(async () => {
      await submitCards(code, selected, crypto.randomUUID());
      if (!controlledSelected) setLocalSelected([]);
      onSubmitted();
    });

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (submitted) {
    return (
      <section aria-label="Your hand" className="w-full">
        <p className="rounded-xl border border-[#8A40CF]/40 bg-[#8A40CF]/10 p-4 text-center text-sm font-medium text-[#C9A2F0]">
          Cards in. Waiting on the table.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Your hand" className="w-full">
      <h3 className="text-xs font-medium uppercase tracking-widest text-white/50">
        Your hand · select {pick} card{pick > 1 ? "s" : ""} to play
      </h3>
      <p aria-live="polite" className="mt-1 text-xs text-white/60">
        {selected.length === 0
          ? "Tap a card — on the table below or in this list — to select it."
          : `${selected.length} of ${pick} selected`}
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {state.me.hand.map((card) => {
          const isSel = selectedSet.has(card.card_id);
          const order = selected.indexOf(card.card_id);
          return (
            <li key={card.card_id}>
              <button
                type="button"
                aria-pressed={isSel}
                onClick={() => toggle(card.card_id)}
                className={`relative h-full min-h-28 w-full overflow-hidden rounded-xl bg-white p-3 pb-5 text-left text-sm font-semibold text-[#141414] shadow-[0_6px_20px_rgba(40,60,129,0.18)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9a419] ${
                  isSel
                    ? "-translate-y-1 ring-2 ring-[#d9a419]"
                    : "hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(40,60,129,0.3)]"
                }`}
              >
                <span aria-hidden className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.2em] text-[#283C81]">
                  Keep It 100
                </span>
                {card.text}
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-2 bg-[#283C81]" />
                {isSel && pick > 1 ? (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[#d9a419] text-[10px] font-bold text-white">
                    {order + 1}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <button
          type="button"
          disabled={selected.length !== pick || cmd.pending}
          onClick={play}
          className="w-full rounded-xl bg-[#8A40CF] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#7A35BC] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {cmd.pending
            ? "Playing…"
            : `Play card${pick > 1 ? "s" : ""} (${selected.length}/${pick})`}
        </button>
        <CommandError message={cmd.error} />
      </div>
    </section>
  );
}
