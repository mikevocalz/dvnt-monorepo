import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchPublicEventIndex } from "../events/public-event-index";

/** One short-lived, anonymous index shared by story links, DMs and title routes. */
export function usePublicEventIndex(enabled: boolean, selectionKey?: string) {
  const query = useQuery({
    queryKey: ["events", "public-slug-index"],
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: () => fetchPublicEventIndex(
      process.env.EXPO_PUBLIC_SUPABASE_URL,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    ),
  });
  const previousSelection = useRef<string | undefined>(undefined);
  useEffect(() => {
    const selection = enabled ? selectionKey : undefined;
    if (selection === previousSelection.current) return;
    previousSelection.current = selection;
    // A different source/slug can reuse the same mounted query observer. Only
    // that navigation, not idle age expiry, requests a new shared index read.
    if (enabled && query.isStale) void query.refetch({ cancelRefetch: false });
  }, [enabled, selectionKey, query.isStale, query.refetch]);
  // Query success alone includes retained data during a stale background read.
  // A refresh or failure must never send a title route through that old index.
  return {
    ...query,
    routingIndex: query.isSuccess && !query.isStale && !query.isFetching && !query.isPaused
      ? query.data
      : undefined,
  };
}
