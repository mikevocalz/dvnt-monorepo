/**
 * Default Query Options
 *
 * Centralized staleTime/gcTime/retry defaults per screen category.
 * Import these into your query hooks instead of hardcoding values.
 */

import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";

/**
 * Default options for "ScreenDTO" primary queries.
 * These are the single query powering above-the-fold for each screen.
 */
export const screenDTODefaults = {
  feed: {
    staleTime: STALE_TIMES.feed,
    gcTime: GC_TIMES.standard,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  events: {
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.standard,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  profile: {
    staleTime: STALE_TIMES.profileOther,
    gcTime: GC_TIMES.standard,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  profileSelf: {
    staleTime: STALE_TIMES.profileSelf,
    gcTime: GC_TIMES.long,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  activity: {
    staleTime: STALE_TIMES.activities,
    gcTime: GC_TIMES.standard,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  messages: {
    staleTime: STALE_TIMES.conversations,
    gcTime: GC_TIMES.standard,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  search: {
    staleTime: 2 * 60 * 1000,
    gcTime: GC_TIMES.short,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
  tickets: {
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.standard,
    refetchOnMount: true,
    notifyOnChangeProps: ["data", "error", "isLoading"] as const,
  },
} as const;

/**
 * Retry policy — don't retry auth failures, retry network errors.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const msg = (error as Error)?.message || "";
  if (msg.includes("unauthorized") || msg.includes("forbidden")) return false;
  if (msg.includes("Not authenticated")) return false;
  return true;
}
