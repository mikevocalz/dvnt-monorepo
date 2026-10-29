import type { BroadcastInfo } from "react-native-moq";

/** Paths can be reused after reconnecting; a new native session is a new owner. */
export function nativePlaybackKey(broadcast: BroadcastInfo): string {
  return JSON.stringify([broadcast.sessionId, broadcast.path]);
}
