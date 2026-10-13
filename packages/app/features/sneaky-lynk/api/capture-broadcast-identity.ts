import { broadcastSenderId } from "./comment-anonymity.ts";

/** Public capture/presence identity. Never put an anonymous auth id on a channel. */
export function captureBroadcastIdentity(
  user: { id: string; username?: string; attributable: boolean },
  sessionToken: string,
): { actorId: string; actorUsername: string } {
  return {
    actorId: broadcastSenderId({ id: user.id, isAnonymous: !user.attributable }, sessionToken),
    actorUsername: user.attributable ? user.username || "Someone" : "Someone",
  };
}
