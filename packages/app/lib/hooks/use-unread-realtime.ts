import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { freshChannel, bindMessageChanges } from "@dvnt/app/lib/supabase/realtime";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { messageKeys } from "@dvnt/app/lib/messages/query-keys";
import { notificationKeys } from "@dvnt/app/lib/notifications/query-keys";

type Kind = "activity" | "messages";
type Observer = { references: number; dispose: () => void };
const observers = new WeakMap<QueryClient, Map<string, Observer>>();

/** Share a channel when both chrome and a screen observe the same unread query. */
export function observeUnreadChanges(
  queryClient: QueryClient,
  viewerId: string,
  kind: Kind,
): () => void {
  if (!/^[1-9]\d*$/.test(viewerId)) return () => {};
  let clientObservers = observers.get(queryClient);
  if (!clientObservers) {
    clientObservers = new Map();
    observers.set(queryClient, clientObservers);
  }
  const key = `${kind}:${viewerId}`;
  let observer = clientObservers.get(key);
  if (!observer) {
    let active = true;
    let queued = false;
    const refresh = () => {
      if (!active || queued || String(useAuthStore.getState().user?.id || "") !== viewerId) return;
      queued = true;
      // Coalesce duplicate deliveries, never increment counts based on a payload.
      queueMicrotask(() => {
        queued = false;
        if (!active || String(useAuthStore.getState().user?.id || "") !== viewerId) return;
        void queryClient.invalidateQueries({
          queryKey: kind === "activity"
            ? notificationKeys.badges(viewerId)
            : messageKeys.unreadCount(viewerId),
          exact: true,
          refetchType: "active",
        });
      });
    };
    const channel = freshChannel(`unread-${key}`);
    if (kind === "activity") {
      channel.on("postgres_changes", {
        event: "*", schema: "public", table: "notifications",
        filter: `recipient_id=eq.${viewerId}`,
      }, refresh);
    } else {
      bindMessageChanges(channel, viewerId, refresh);
      channel.on("postgres_changes", {
        event: "*", schema: "public", table: "follows",
        filter: `follower_id=eq.${viewerId}`,
      }, refresh);
      for (const column of ["blocker_id", "blocked_id"]) {
        channel.on("postgres_changes", {
          event: "*", schema: "public", table: "blocks",
          filter: `${column}=eq.${viewerId}`,
        }, refresh);
      }
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });
    observer = {
      references: 0,
      dispose: () => { active = false; void supabase.removeChannel(channel); },
    };
    clientObservers.set(key, observer);
  }
  observer.references += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    observer.references -= 1;
    if (observer.references === 0) {
      observer.dispose();
      clientObservers.delete(key);
    }
  };
}

export function useUnreadRealtime(viewerId: string | undefined, kind: Kind) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!viewerId) return;
    return observeUnreadChanges(queryClient, viewerId, kind);
  }, [queryClient, viewerId, kind]);
}
