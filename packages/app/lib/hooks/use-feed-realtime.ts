/**
 * useFeedRealtime — live feed refresh without pull-to-refresh.
 *
 * Subscribes to INSERT/DELETE on the `posts` table and debounce-invalidates the
 * infinite feed query so new posts appear (and deleted ones drop) on their own.
 *
 * We INVALIDATE (re-run the feed RPC) rather than inject the raw row, so every
 * server-side rule — NSFW filtering, blocks, follow graph, ranking — is still
 * applied; a post that the feed wouldn't normally show never sneaks in.
 *
 * Mounted by the web feed screen (no pull-to-refresh on web). Native keeps its
 * existing pull-to-refresh, so this stays a web-only enhancement.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { postKeys } from "@dvnt/app/lib/hooks/use-posts";

export function useFeedRealtime(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // Collapse bursts (many posts landing at once) into a single refetch, and
    // never refetch more than ~once every 1.5s.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidateSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: postKeys.feedInfinite() });
      }, 1500);
    };

    const channel = supabase
      .channel(`feed-rt:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        invalidateSoon,
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        invalidateSoon,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
