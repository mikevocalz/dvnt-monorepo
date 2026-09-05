import { useWatchSettingsStore } from "./watch-settings-store";
import { useWatchSessionStore } from "./watch-session-store";
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
  const enabled = useWatchSettingsStore((s) => s.enabled && s.tickets);
  const lastSig = useRef<string | null>(null);
  const lastEnv = useRef<WatchTicketEnvelope | null>(null);
  const owner = useRef(viewerId);
  useEffect(() => { owner.current = viewerId; lastEnv.current = null; lastSig.current = null; }, [viewerId]);

  // Answer the watch's on-demand "requestTickets" with the freshest envelope.
  useEffect(() => {
    if (Platform.OS === "web") return;
    return registerWatchRequestHandler({ tickets: () => owner.current === useAuthStore.getState().user?.id ? lastEnv.current : null });
  }, []);

  // Push whenever the meaningful contents change.
  useEffect(() => {
    if (!enabled) { lastSig.current = null; return; }
    if (Platform.OS === "web" || !data || !viewerId) return;
    const env = buildWatchEnvelope(data.filter((ticket) => ticket.user_id === viewerId), {
      // Withhold rather than send Free while the query is in flight: a paying
      // VIP must never see their perks blink off on the wrist mid-refresh.
      entitlements: entitlementsLoading ? undefined : entitlements,
      viewerId,
    });
    env.protocol = 2;
    env.accountGen = useWatchSessionStore.getState().selectAccount(viewerId);
    const sig = envelopeSignature(env);
    lastEnv.current = env;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncTicketsToWatch(env);
  }, [data, entitlements, entitlementsLoading, viewerId, enabled]);
}
