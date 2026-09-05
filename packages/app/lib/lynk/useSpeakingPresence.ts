/**
 * useSpeakingPresence — who else in the Lynk room is talking.
 *
 * Fishjam carried voice activity in-band (`useVAD` was fed by backend
 * `vadNotification` messages). MoQ carries none, and `@moq/watch` exposes no
 * analyser on a remote publisher's decoded audio, so there is nothing local to
 * measure for someone else. The direction that DOES work is the one every
 * client already has: measure your own microphone (`useSpeakingDetection`) and
 * tell the room.
 *
 * Transport is the room's existing Supabase broadcast channel — the same
 * mechanism as `useRoomReactions`, so this adds no dependency, no server work
 * and no new failure mode. Sends are EDGE-TRIGGERED: one message when you start
 * talking and one when you stop, not one per frame.
 *
 * ponytail: a client that vanishes mid-word (tab killed, laptop lid) leaves its
 * last `true` behind, so its ring stays until the roster drops the member and
 * the tile goes with it. Add a TTL + heartbeat if that ever reads as stuck.
 */

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@dvnt/app/lib/supabase/client";
import {
  applySpeakingEvent,
  type SpeakingEvent,
  type SpeakingMap,
} from "./speaking-presence";

const EMPTY: SpeakingMap = {};

export interface UseSpeakingPresenceOptions {
  roomId: string | undefined;
  /** The local user — used to publish, and to ignore our own echo. */
  userId: string | undefined;
  /** Local voice activity, from `useSpeakingDetection`. */
  speaking: boolean;
}

/** Remote `userId → speaking`. Only truthy entries are present. */
export function useSpeakingPresence({
  roomId,
  userId,
  speaking,
}: UseSpeakingPresenceOptions): SpeakingMap {
  const [remote, setRemote] = useState<SpeakingMap>(EMPTY);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!roomId || !userId) return;
    const channel = supabase.channel(`lynk-speaking:${roomId}`);
    channel
      .on("broadcast", { event: "speaking" }, (message) => {
        const event = message.payload as SpeakingEvent | undefined;
        if (!event) return;
        setRemote((prev) => applySpeakingEvent(prev, event, userIdRef.current));
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      setRemote(EMPTY);
      supabase.removeChannel(channel);
    };
  }, [roomId, userId]);

  // Edge-triggered: `speaking` only changes when the hysteresis in
  // `decideSpeaking` says the state really flipped, so this effect is the whole
  // send path — no interval, no throttle.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !userId) return;
    void channel.send({
      type: "broadcast",
      event: "speaking",
      payload: { userId, speaking } satisfies SpeakingEvent,
    });
  }, [speaking, userId, roomId]);

  return remote;
}
