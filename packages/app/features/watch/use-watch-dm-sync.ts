/**
 * Keeps the Apple Watch in sync with the member's conversations, and performs
 * the send when they answer from the wrist. Companion to `useWatchTicketSync` —
 * mount once, high in the authed tree (no-op off iOS).
 *
 * It reuses the EXISTING `useConversations` query as the source of truth — no
 * new network, no new server code. The wrist never holds DVNT auth: it sends
 * words back over WCSession and the phone calls the same `messagesApi.sendMessage`
 * the chat screen uses, so read state, optimistic ordering and cache
 * invalidation all behave exactly as if the member had typed it here.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useConversations } from "@dvnt/app/lib/hooks/use-messages";
import { messageKeys } from "@dvnt/app/lib/messages/query-keys";
import {
  buildDMEnvelope,
  dmSignature,
  type WatchDMEnvelope,
} from "./watch-dm-payload";
import {
  registerWatchDMReplyHandler,
  registerWatchRequestHandler,
  syncDMsToWatch,
} from "./watch-bridge";

export function useWatchDMSync(): void {
  const { data } = useConversations();
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const lastSig = useRef<string | null>(null);
  const lastEnv = useRef<WatchDMEnvelope | null>(null);

  // Answer the watch's on-demand "requestDMs" with the freshest envelope.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    return registerWatchRequestHandler({ dms: () => lastEnv.current });
  }, []);

  // Send what the wearer typed. The reply is validated against the ids we
  // actually pushed (see `validateDMReply`) before it reaches the network.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    return registerWatchDMReplyHandler(
      () => lastEnv.current?.dms.map((d) => d.id) ?? [],
      ({ conversationId, text }) => {
        void messagesApi
          .sendMessage({ conversationId, content: text })
          .then(() => {
            // Pull the conversation list forward so the phone reflects the
            // wrist's message without waiting on the next poll. The open
            // thread itself is refreshed by the existing realtime merge.
            void queryClient.invalidateQueries({
              queryKey: messageKeys.conversations(viewerId ?? undefined),
            });
          })
          .catch((err) => {
            // Nothing to retry against — the wrist has already dismissed its
            // composer. Surfacing it in the log beats a silent drop.
            console.warn("[watch-dm] reply send failed", err);
          });
      },
    );
  }, [queryClient, viewerId]);

  // Push whenever the meaningful contents change.
  useEffect(() => {
    if (Platform.OS !== "ios" || !data) return;
    const env = buildDMEnvelope(data);
    const sig = dmSignature(env);
    lastEnv.current = env;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncDMsToWatch(env);
  }, [data]);
}
