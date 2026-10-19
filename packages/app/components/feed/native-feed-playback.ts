/** Small, testable player boundary shared by inline feed videos. */
export interface FeedPlayer {
  muted: boolean;
  audioMixingMode: string;
  play(): void;
  pause(): void;
}

// Claiming sound silences the previous player synchronously, before the new
// player is unmuted. React effect ordering cannot create two audible streams.
export function createFeedAudioCoordinator() {
  let owner: FeedPlayer | null = null;
  return {
    claim(player: FeedPlayer) {
      if (owner && owner !== player) {
        try {
          owner.muted = true;
          owner.audioMixingMode = "mixWithOthers";
        } catch {
          /* The native player may already have been released. */
        }
      }
      owner = player;
    },
    release(player: FeedPlayer) {
      if (owner === player) owner = null;
    },
  };
}

export const feedAudio = createFeedAudioCoordinator();

export function syncFeedPlayer(
  player: FeedPlayer,
  playing: boolean,
  muted: boolean,
) {
  if (!playing) {
    player.pause();
    player.muted = true;
    player.audioMixingMode = "mixWithOthers";
    feedAudio.release(player);
    return;
  }
  if (!muted) feedAudio.claim(player);
  else feedAudio.release(player);
  player.muted = muted;
  player.audioMixingMode = muted ? "mixWithOthers" : "duckOthers";
  player.play();
}

export function isFeedCellVisible(
  y: number,
  height: number,
  top: number,
  bottom: number,
) {
  if (height <= 0 || bottom <= top) return false;
  const visible = Math.max(0, Math.min(y + height, bottom) - Math.max(y, top));
  return visible >= Math.min(height, bottom - top) * 0.5;
}
