"use client";

/**
 * Game Night rules sheet (web). A BottomSheet popover any player can open
 * mid-match — Escape, scrim tap, drag-to-dismiss, or the ✕ closes it, so it
 * never blocks play.
 *
 * Copy is grounded in two sources only: the printed Cookout instructions card
 * ("Blue 100 - The Cookout Rs - Instructions.pdf") for the deck and its house
 * rules, and the implemented match mechanics for the app flow (classic judge
 * rounds, duel prediction rounds, first to target_score).
 */

import { BottomSheet } from "../../../components/bottom-sheet.web";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#C9A2F0]">
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-white/75">
        {children}
      </div>
    </section>
  );
}

export function RulesSheet({
  open,
  onClose,
  targetScore,
}: {
  open: boolean;
  onClose: () => void;
  /** From match.target_score — shown verbatim so the sheet never lies. */
  targetScore?: number;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="How to play" maxWidthClass="max-w-xl">
      <Section title="The deck — Keep It 100: The Cookout">
        <p>
          Pop culture and real talk across Dating, Sex &amp; Intimacy, Family,
          Politics &amp; Power, and Queer Inclusion. Every card is a
          multiple-choice prompt that ends with a personal follow-up.
        </p>
      </Section>

      <Section title="A round">
        <p>
          A prompt lands face-up on the table. Pick your best answer card
          before the timer runs out — some prompts ask for more than one. Picks
          stay face-down until everyone locks in.
        </p>
        <p>
          The judge reveals every answer and crowns the round winner. The
          winner keeps the card and takes the point.
        </p>
      </Section>

      <Section title="Duel rounds">
        <p>
          One player is the subject and picks their favorite of six options.
          Everyone else predicts what the subject chose — a correct prediction
          scores.
        </p>
      </Section>

      <Section title="Winning">
        <p>
          {targetScore
            ? `First to ${targetScore} points takes the match.`
            : "Most points when the match ends takes it."}{" "}
          The winner reads their kept cards aloud and answers the follow-ups —
          the floor opens for discussion with every Q&amp;A.
        </p>
      </Section>

      <Section title="House rules (printed card)">
        <p>
          Choose how long a round runs. Right answers keep the card; wrong
          answers take a shot — or your table&apos;s penalty. At the end, the
          winner picks someone to take a shot, then reads their cards aloud.
        </p>
      </Section>
    </BottomSheet>
  );
}
