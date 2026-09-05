/**
 * Participant identity for the MoQ transport.
 *
 * Fishjam carried identity in-band (peer metadata), so participants fell out of
 * the SDK. MoQ carries none: a publisher is a path, `lynk/<roomId>/<peerId>`.
 * Identity therefore comes from the Supabase roster (`video_room_members`) and
 * is joined to live media on `peerId`.
 *
 * LOCKSTEP: `peerIdForMember` must mirror `peerIdFor` in
 * `apps/mobile/supabase/functions/lynk-moq-token/index.ts` exactly — the server
 * mints the publish path from its copy, so a drift here silently renders every
 * remote tile as an unknown participant. Change both in the same PR.
 */

import type { MemberRole, Participant, RoomMember } from "./types";

/** Minimal shape of a discovered MoQ publisher (matches `LynkPublisher`). */
export interface PublisherLike {
  peerId: string;
  /** Native only — the `BroadcastInfo` its tile renders. */
  broadcast?: unknown;
  /** Track presence drives the camera/mic indicators. */
  hasVideo?: boolean;
  hasAudio?: boolean;
}

/** Path-safe peer id derived from a member. Mirrors the edge function. */
export function peerIdForMember(
  userId: string,
  anonLabel?: string | null,
): string {
  if (anonLabel) {
    const n = anonLabel.match(/(\d+)/)?.[1] ?? "0";
    return `anon-${n}`;
  }
  return userId.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Join the roster to live publishers. Every active member is listed (a listener
 * with no camera is still in the room); `broadcast` is set only for the ones
 * actually on air, which is what makes a tile render media instead of an avatar.
 *
 * The local user is excluded — the screen renders its own preview from the
 * capture track, not from a subscription to itself.
 */
export function mergeParticipants(input: {
  members: RoomMember[];
  publishers: PublisherLike[];
  localUserId?: string;
}): Participant[] {
  const { members, publishers, localUserId } = input;
  const byPeerId = new Map(publishers.map((p) => [p.peerId, p]));

  return members
    .filter((m) => m.status === "active" && m.userId !== localUserId)
    .map((m) => {
      const peerId = peerIdForMember(m.userId, m.anonLabel);
      const pub = byPeerId.get(peerId);
      return {
        odId: peerId,
        oderId: peerId,
        userId: m.userId,
        username: m.username,
        displayName: m.displayName || m.username,
        avatar: m.avatar,
        role: (m.role || "participant") as MemberRole,
        isLocal: false,
        // A member is only "on camera" when a live broadcast carries video.
        isCameraOn: !!pub?.hasVideo,
        isMicOn: !!pub?.hasAudio,
        // ponytail: MoQ screen share is a separate out-of-process broadcast
        // (`useScreenBroadcast`); nothing in the room publishes one yet, so this
        // is constant-false until that lands rather than faked from the camera.
        isScreenSharing: false,
        broadcast: pub?.broadcast,
        isAnonymous: m.isAnonymous ?? false,
        anonLabel: m.anonLabel ?? null,
        isHandRaised: !!m.handRaised,
      } satisfies Participant;
    });
}
