/**
 * Seat maths for a Game Night table.
 *
 * Four seats, because the table has four. Everyone past the fourth watches —
 * so capacity is not an error state, it is the difference between two ways of
 * being in the room. The list has to say which one you would get BEFORE you
 * click, which is why the card draws seats rather than printing a number.
 */

export const MAX_PLAYERS = 4;

export interface SeatView {
  /** Index 0-3, stable so avatars do not reshuffle between polls. */
  index: number;
  player: { id: string; name: string | null; avatar: string | null } | null;
  isHost: boolean;
}

export function seatsFor(
  players: readonly { id: string; name: string | null; avatar: string | null }[],
  hostId: string,
): SeatView[] {
  // The host holds seat 0 so the eye always finds them in the same place down
  // a long list; everyone else keeps arrival order.
  const ordered = [...players].sort((a, b) =>
    a.id === hostId ? -1 : b.id === hostId ? 1 : 0,
  );
  return Array.from({ length: MAX_PLAYERS }, (_, index) => {
    const player = ordered[index] ?? null;
    return { index, player, isHost: player?.id === hostId };
  });
}

export function isFull(playerCount: number): boolean {
  return playerCount >= MAX_PLAYERS;
}

/**
 * What this room offers the person reading the list. Two outcomes, never
 * "unavailable" — a full table is still worth opening, it just means watching.
 */
export function entryMode(playerCount: number): "play" | "watch" {
  return isFull(playerCount) ? "watch" : "play";
}

export function seatsLeft(playerCount: number): number {
  return Math.max(0, MAX_PLAYERS - playerCount);
}
