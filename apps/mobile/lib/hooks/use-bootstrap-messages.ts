/**
 * Bootstrap Messages Hook
 *
 * When `perf_bootstrap_messages` flag is ON, fetches conversations + unread
 * counts in a single request and hydrates the TanStack Query cache.
 *
 * Eliminates: getFilteredConversations + getUnreadCount + getSpamUnreadCount waterfall.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { bootstrapApi, type BootstrapMessagesResponse } from "@/lib/api/bootstrap";
import { messageKeys } from "@/lib/hooks/use-messages";
import { useUnreadCountsStore } from "@/lib/stores/unread-counts-store";
import { useScreenTrace } from "@/lib/perf/screen-trace";

function hydrateFromMessagesBootstrap(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  data: BootstrapMessagesResponse,
) {
  // Only trust bootstrap data when unread-sensitive message state is
  // authoritative. Otherwise let the direct conversations/unread queries own
  // the initial load so we don't hydrate stale thread unread flags.
  if (data.unreadAuthoritative) {
    // 1. Seed the filtered conversations cache (primary inbox)
    queryClient.setQueryData(
      [...messageKeys.all(userId), "filtered", "primary"],
      data.conversations,
    );

    // 2. Seed unread counts
    queryClient.setQueryData(messageKeys.unreadCount(userId), {
      inbox: data.unreadInbox,
      spam: data.unreadSpam,
    });

    // 3. Sync with unread counts store for badge rendering
    const store = useUnreadCountsStore.getState();
    store.setMessagesUnread(data.unreadInbox);
    store.setSpamUnread(data.unreadSpam);
  }

  console.log(
    `[BootstrapMessages] Hydrated cache: ${data.conversations.length} conversations, ` +
      `${data.unreadInbox} inbox unread, ${data.unreadSpam} spam unread, ` +
      `authoritative=${data.unreadAuthoritative === true}`,
  );
}

export function useBootstrapMessages() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";
  const hasRun = useRef(false);
  const trace = useScreenTrace("Messages");

  const enabled = isFeatureEnabled("perf_bootstrap_messages");

  useEffect(() => {
    if (!enabled || !userId || hasRun.current) return;
    hasRun.current = true;

    // Check if we already have fresh conversation data
    const existing = queryClient.getQueryData([
      ...messageKeys.all(userId),
      "filtered",
      "primary",
    ]);
    if (existing) {
      trace.markCacheHit();
      trace.markUsable();
      return;
    }

    bootstrapApi.messages({ userId }).then((data) => {
      if (!data) return;
      hydrateFromMessagesBootstrap(queryClient, userId, data);
      trace.markUsable();
    });
  }, [enabled, userId, queryClient, trace]);

  return { enabled };
}
