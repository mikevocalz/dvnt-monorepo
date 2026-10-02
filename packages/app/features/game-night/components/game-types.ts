/**
 * Facade over the rooms-api state types plus the small helpers the UI shares.
 * Components import from here so the API module stays the single source of
 * truth for the projection's shape.
 */

export type {
  GameNightState,
  GameNightRoom,
  GameNightMember,
  GameNightMatch,
  GameNightRound,
  GameNightMe,
  GameNightMessage,
  RevealEntry,
} from "../rooms-api";

import type { GameNightState, GameNightMember } from "../rooms-api";

export function memberName(
  m: GameNightMember | undefined,
  fallback = "Someone",
): string {
  return m?.name ?? fallback;
}

export function nameFor(
  state: GameNightState,
  userId: string | null | undefined,
): string {
  if (!userId) return "Someone";
  return memberName(
    state.members.find((m) => m.user_id === userId),
  );
}
