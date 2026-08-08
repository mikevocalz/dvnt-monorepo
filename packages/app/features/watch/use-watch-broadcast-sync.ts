/**
 * Keeps the Apple Watch in sync with the host broadcasts the signed-in member
 * has received. Companion to `useWatchTicketSync` — mount once, high in the
 * authed tree (no-op off iOS).
 *
 * It reuses the EXISTING activity feed (`useActivitiesQuery`) as the source of
 * truth — no new network, no new server code — and pushes a fresh broadcast
 * envelope to the watch whenever the set materially changes (a new broadcast, or
 * a read-state flip). Audience scoping already happened server-side in the
 * `event-broadcast-message` edge function, so anything in the member's feed is a
 * message they were legitimately in the audience for. See docs/watch-broadcast-fit.md.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useActivitiesQuery } from "@dvnt/app/lib/hooks/use-activities-query";
import {
  buildBroadcastEnvelope,
  broadcastSignature,
  type WatchBroadcastEnvelope,
} from "./watch-broadcast-payload";
import {
  registerWatchRequestHandler,
  syncBroadcastsToWatch,
} from "./watch-bridge";

export function useWatchBroadcastSync(): void {
  const { data } = useActivitiesQuery();
  const lastSig = useRef<string | null>(null);
  const lastEnv = useRef<WatchBroadcastEnvelope | null>(null);

  // Answer the watch's on-demand "requestBroadcasts" with the freshest envelope.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    return registerWatchRequestHandler({ broadcasts: () => lastEnv.current });
  }, []);

  // Push whenever the meaningful contents change.
  useEffect(() => {
    if (Platform.OS !== "ios" || !data) return;
    const env = buildBroadcastEnvelope(data);
    const sig = broadcastSignature(env);
    lastEnv.current = env;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncBroadcastsToWatch(env);
  }, [data]);
}
