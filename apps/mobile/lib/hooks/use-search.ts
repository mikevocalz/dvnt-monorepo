/**
 * Search Hook
 *
 * Provides React Query hooks for searching posts and users
 * Uses Supabase directly
 */

import { useQuery } from "@tanstack/react-query";
import { searchApi } from "@/lib/api/search";
import { GC_TIMES } from "@/lib/perf/stale-time-config";

export function useSearchPosts(query: string) {
  return useQuery({
    queryKey: ["search", "posts", query],
    queryFn: () => searchApi.searchPosts(query),
    enabled: !!query && query.length >= 1,
    staleTime: 2 * 60 * 1000, // 2min — same query re-typed gets instant result
    gcTime: GC_TIMES.short,
  });
}

export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: ["search", "users", query],
    queryFn: () => searchApi.searchUsers(query, 20),
    enabled: !!query && query.length >= 1,
    staleTime: 2 * 60 * 1000,
    gcTime: GC_TIMES.short,
  });
}
