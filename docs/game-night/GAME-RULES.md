# Game Night — player-facing rules and deck identity

This document is the copy source for Game Night help UI. It records what the
server actually does. If the engine changes, update this document and the
player-facing rules in the same PR.

## Which card pack is this?

There are **two separate layers** in the current build:

1. **Visual card treatment:** **Keep It 100: The Cookout** (repo theme name:
   **Blue 100 — The Cookout**). The white/navy card anatomy and Cookout back
   art come from that visual reference.
2. **Playable prompt/answer content:** **DVNT Game Night launch deck v1**,
   which is original DVNT nightlife content seeded in the database:
   **40 prompt cards + 160 answer cards**.

The current digital game does **not** use the printed Cookout multiple-choice /
follow-up-question rules as its match engine. Do not tell players that it does.

## Before a match

- A room can have up to **4 seated players**.
- Additional members enter as **watchers**. Watchers can watch, chat and react
  but cannot play cards or score.
- The host is ready by default. Every other seated player must tap Ready.
- The host starts the match.
- The mode is automatic:
  - **2 seated players → Duel**
  - **3–4 seated players → Classic**

## Classic — 3 or 4 players

- Every player starts with a **7-card hand**.
- One player is the **judge**. The judge rotates each round and does not submit
  an answer that round.
- A prompt appears and says whether it needs **1 card or 2 cards**.
- Every non-judge player chooses the required number of answer cards.
- Submission window: **45 seconds**.
- Answers stay hidden until all expected answers are in or time expires.
- The judge gets **60 seconds** to choose their favorite revealed submission.
- The chosen player gets **1 point**.
- Default win condition: **first to 5 points**.
- If nobody submits, or the judge does not choose before the deadline, the
  round is void and nobody scores.

## Duel — exactly 2 players

- The **subject** alternates each round.
- Both players see the same **6 answer options**.
- The subject secretly picks their favorite.
- The other player is the **predictor** and secretly guesses which option the
  subject picked.
- Lock window: **30 seconds**.
- A correct prediction gives the predictor **1 point**.
- A wrong prediction gives **no point**.
- Default format: each player is the subject **5 times** (10 rounds total).
- If the score is tied after those paired rounds, the game continues until the
  tie is broken.
- If the subject never locks a choice, the round is void. If the predictor
  fails to lock, it counts as an incorrect prediction.

## Timing between rounds

Result/void screens remain up for about **10 seconds**, then the server opens
the next round automatically.

## Card/deck behavior

- Classic hands refill toward 7 cards between rounds.
- Played answer cards go to discard and can be reshuffled if the answer deck
  runs out.
- Prompt exhaustion ends the current match rather than silently inventing new
  prompts.
- Game state and scoring are server-authoritative. UI animation never decides
  a winner or adds points.
