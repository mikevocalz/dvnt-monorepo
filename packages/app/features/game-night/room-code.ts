/**
 * Room codes for Game Night.
 *
 * The code IS the room id — there is no rooms table yet, because a lobby's
 * roster is inherently ephemeral and Supabase Realtime presence already carries
 * it. A table becomes necessary when card state has to survive a refresh, which
 * is the next slice, and the code is designed to survive into it as the id.
 *
 * The alphabet omits O/0, I/1 and S/5. Codes are read ALOUD across a room, so
 * the pairs people mishear are worth more than the extra bits they cost.
 * 29 chars ^ 6 = 594 million, against a game that has two people in it.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Uppercases and strips anything not in the alphabet, so paste-with-spaces works. */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isCompleteRoomCode(input: string): boolean {
  return normalizeRoomCode(input).length === ROOM_CODE_LENGTH;
}
