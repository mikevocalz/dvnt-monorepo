export type GameNightMode = "classic" | "duel";

export function gameNightModeForPlayerCount(
  playerCount: number,
): GameNightMode | null {
  if (playerCount === 2) return "duel";
  if (playerCount >= 3 && playerCount <= 4) return "classic";
  return null;
}

export function classicWinText(targetScore = 5): string {
  return `First player to ${Math.max(1, targetScore)} points wins; if the deck runs out first, the highest score wins.`;
}

export function duelFormatText(pairedRounds = 5): string {
  const pairs = Math.max(1, pairedRounds);
  const scheduledRounds = pairs * 2;
  return `Each player is the subject ${pairs} times (${scheduledRounds} rounds total). If the score is tied after that, rounds continue until the tie is broken.`;
}

export const GAME_NIGHT_DECK_FACTS = {
  visualTheme: "Keep It 100: The Cookout",
  internalThemeName: "Blue 100 — The Cookout",
  playableDeck: "DVNT Game Night launch deck v1",
  promptCount: 40,
  answerCount: 160,
} as const;
