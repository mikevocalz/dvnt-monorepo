/**
 * Keeps the Apple Watch in sync with the signed-in member's tickets.
 *
 * Mount once, high in the authed tree (it's a no-op off iOS). It reuses the
 * existing `useMyTickets` poll (~5 s) as the source of truth — no new network —
 * and pushes a fresh envelope to the watch whenever the ticket set materially
 * changes (a new ticket, or a status flip like scanned/refunded).
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useMyTickets } from "@dvnt/app/lib/hooks/use-tickets";
import {
  buildWatchEnvelope,
  envelopeSignature,
  type WatchTicketEnvelope,
} from "./watch-payload";
import { registerWatchRequestHandler, syncTicketsToWatch } from "./watch-bridge";

export function useWatchTicketSync(): void {
  const { data } = useMyTickets();
  const lastSig = useRef<string | null>(null);
  const lastEnv = useRef<WatchTicketEnvelope | null>(null);

  // Answer the watch's on-demand "requestTickets" with the freshest envelope.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    return registerWatchRequestHandler({ tickets: () => lastEnv.current });
  }, []);

  // Push whenever the meaningful contents change.
  useEffect(() => {
    if (Platform.OS !== "ios" || !data) return;
    const env = buildWatchEnvelope(data);
    const sig = envelopeSignature(env);
    lastEnv.current = env;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncTicketsToWatch(env);
  }, [data]);
}
