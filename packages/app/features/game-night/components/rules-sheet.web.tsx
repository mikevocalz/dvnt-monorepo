"use client";

import { BottomSheet } from "../../../components/bottom-sheet.web";
import {
  classicWinText,
  duelFormatText,
  GAME_NIGHT_DECK_FACTS,
} from "../game-rules";

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
  targetScore = 5,
  duelPairedRounds = 5,
}: {
  open: boolean;
  onClose: () => void;
  targetScore?: number;
  duelPairedRounds?: number;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="How to play"
      maxWidthClass="max-w-xl"
    >
      <Section title="Pick a mode by player count">
        <p>
          Game Night chooses the mode automatically when the host starts:
          <strong className="text-white"> 2 seated players = Duel</strong>;
          <strong className="text-white"> 3–4 seated players = Classic</strong>.
        </p>
        <p>
          The table has four seats. Anyone beyond four joins as a watcher and
          can watch, chat and react without playing cards or scoring.
        </p>
      </Section>

      <Section title="Classic · 3–4 players">
        <p>
          Everyone has a 7-card hand. One player is the judge, and the judge
          rotates each round.
        </p>
        <p>
          A prompt tells non-judges to play either 1 or 2 answer cards. You have
          45 seconds. Answers stay hidden until everyone has submitted or time
          expires.
        </p>
        <p>
          The judge then has 60 seconds to choose their favorite revealed
          answer. That player gets 1 point. {classicWinText(targetScore)}
        </p>
        <p>
          If nobody submits, or the judge times out, the round is skipped and
          nobody scores.
        </p>
      </Section>

      <Section title="Duel · exactly 2 players">
        <p>
          One player is the subject and the other is the predictor. The subject
          alternates every round.
        </p>
        <p>
          Both players see the same 6 answer options. The subject secretly picks
          a favorite; the predictor secretly guesses which option the subject
          chose. Both get 30 seconds to lock in.
        </p>
        <p>
          A correct prediction gives the predictor 1 point. A wrong prediction
          gives no point. {duelFormatText(duelPairedRounds)}
        </p>
      </Section>

      <Section title="About the cards">
        <p>
          The current card look is{" "}
          <strong className="text-white">{GAME_NIGHT_DECK_FACTS.visualTheme}</strong>
          {" "}({GAME_NIGHT_DECK_FACTS.internalThemeName}).
        </p>
        <p>
          The playable text is DVNT&apos;s own nightlife deck:{" "}
          <strong className="text-white">
            {GAME_NIGHT_DECK_FACTS.promptCount} prompts +{" "}
            {GAME_NIGHT_DECK_FACTS.answerCount} answer cards
          </strong>.
          The printed Cookout multiple-choice/follow-up house rules are not the
          rules this digital match engine uses.
        </p>
      </Section>

      <Section title="Good to know">
        <p>
          Results stay up briefly, then the next round opens automatically.
          Classic hands refill between rounds. Watchers never receive private
          hands or secret Duel picks.
        </p>
      </Section>
    </BottomSheet>
  );
}
