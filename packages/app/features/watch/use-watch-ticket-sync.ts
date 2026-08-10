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
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import {
  buildWatchEnvelope,
  envelopeSignature,
  type WatchTicketEnvelope,
} from "./watch-payload";
import { registerWatchRequestHandler, syncTicketsToWatch } from "./watch-bridge";

export function useWatchTicketSync(): void {
  const { data } = useMyTickets();
  // I3: entitlements resolve from Supabase rows, never from a processor SDK.
  // The wrist gets that resolved object projected — it does no resolving itself.
  const { entitlements, isLoading: entitlementsLoading } = useEntitlements();
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
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
    const env = buildWatchEnvelope(data, {
      // Withhold rather than send Free while the query is in flight: a paying
      // VIP must never see their perks blink off on the wrist mid-refresh.
      entitlements: entitlementsLoading ? undefined : entitlements,
      viewerId,
    });
    const sig = envelopeSignature(env);
    lastEnv.current = env;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncTicketsToWatch(env);
  }, [data, entitlements, entitlementsLoading, viewerId]);
}
