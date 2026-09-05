/**
 * Pure reducer behind `useSpeakingPresence`. No React and no Supabase, so the
 * merge rules are testable without a channel.
 *
 * MoQ's web player (`@moq/watch`) exposes no analyser for a remote publisher —
 * decoded audio goes straight to the output — so a remote speaking ring cannot
 * be computed locally the way the local one is. Each client therefore detects
 * its OWN voice activity and broadcasts the boolean; every other client just
 * merges what it receives. That is what these events are.
 */

/** One client telling the room whether it is currently speaking. */
export interface SpeakingEvent {
  userId: string;
  speaking: boolean;
}

export type SpeakingMap = Readonly<Record<string, boolean>>;

/**
 * Merge one event into the map. Returns the SAME object when nothing changed —
 * a room of six people flips these several times a second, and a fresh object
 * per event would re-render every tile on every syllable.
 *
 * `selfUserId` is dropped: the local ring comes from `useSpeakingDetection`
 * directly, and echoing our own broadcast back would make it lag the room by a
 * round-trip.
 */
export function applySpeakingEvent(
  prev: SpeakingMap,
  event: SpeakingEvent,
  selfUserId?: string,
): SpeakingMap {
  const { userId, speaking } = event;
  if (!userId || userId === selfUserId) return prev;
  if (!!prev[userId] === speaking) return prev;
  const next = { ...prev, [userId]: speaking };
  // Only truthy entries are ever read, so a `false` is a delete — otherwise the
  // map grows one permanent key per person who ever spoke in a long room.
  if (!speaking) delete next[userId];
  return next;
}
