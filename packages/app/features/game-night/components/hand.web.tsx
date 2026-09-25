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
}: {
  state: GameNightState;
  code: string;
  onSubmitted: () => void;
}) {
  const pick = state.round?.prompt?.pick ?? 1;
  const [selected, setSelected] = useState<string[]>([]);
  const cmd = useCommand();

  const submitted = Boolean(state.round?.my_submission);

  const toggle = (cardId: string) => {
    setSelected((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      if (prev.length >= pick) return prev;
      return [...prev, cardId];
    });
  };

  const play = () =>
    cmd.run(async () => {
      await submitCards(code, selected, crypto.randomUUID());
      setSelected([]);
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
        Your hand · pick {pick}
      </h3>
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
                className={`relative h-full min-h-28 w-full rounded-xl border p-3 text-left text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0] ${
                  isSel
                    ? "border-[#8A40CF] bg-white text-[#0c0e18] shadow-[0_0_0_2px_#8A40CF]"
                    : "border-white/15 bg-white/90 text-[#0c0e18] hover:border-[#8A40CF]/60"
                }`}
              >
                {card.text}
                {isSel && pick > 1 ? (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[#8A40CF] text-[10px] font-bold text-white">
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
