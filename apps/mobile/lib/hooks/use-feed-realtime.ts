/**
 * useFeedRealtime (native) — live feed refresh.
 *
 * Mirrors the web hook (packages/app/lib/hooks/use-feed-realtime.ts) but uses
 * the mobile Supabase client. Subscribes to INSERT/DELETE on `posts` and
 * debounce-invalidates the infinite feed so new posts appear (and deleted ones
 * drop) on their own — pull-to-refresh still works as a manual fallback.
 *
 * We INVALIDATE (re-run the feed RPC) rather than inject the raw row, so all
 * server-side rules (NSFW, blocks, follow graph, ranking) are still applied.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { postKeys } from "@/lib/hooks/use-posts";

export function useFeedRealtime(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

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
