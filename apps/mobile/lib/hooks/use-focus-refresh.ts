/**
 * useFocusRefresh — Stale-check-then-refetch on screen focus
 *
 * Replaces the raw useFocusEffect + manual stale check pattern.
 * On focus: checks if the query data is older than `staleThresholdMs`.
 * If stale, silently refetches in the background (no loading state change).
 *
 * This is the canonical pattern for tab screens that stay mounted.
 * It prevents both:
 *   - Stale data when returning to a tab
 *   - Thrashing on rapid tab switches (< staleThreshold)
 *
 * @example
 * ```tsx
 * const { data, refetch } = useActivitiesQuery();
 * useFocusRefresh({
 *   queryKey: activityKeys.list(viewerId),
 *   refetch,
 *   staleThresholdMs: 60_000, // only refetch if data > 60s old
 * });
 * ```
 */

import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";

interface UseFocusRefreshOptions {
  /** TanStack Query key to check staleness against */
  queryKey: QueryKey;
  /** Refetch function from the query hook */
  refetch: () => any;
  /** Minimum age (ms) before data is considered stale enough to refetch. Default: 60s */
  staleThresholdMs?: number;
  /** Whether to run the focus check. Set false to disable. Default: true */
  enabled?: boolean;
  /** Optional additional work to do on focus (e.g. fetchFollowingState) */
  onFocus?: () => void;
}

export function useFocusRefresh({
  queryKey,
  refetch,
  staleThresholdMs = 60_000,
  enabled = true,
  onFocus,
}: UseFocusRefreshOptions) {
  const queryClient = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;

      const state = queryClient.getQueryState(queryKey);
      const dataAge = state?.dataUpdatedAt
        ? Date.now() - state.dataUpdatedAt
        : Infinity;

      if (__DEV__) {
        console.log(
          `[useFocusRefresh] Focus: ${JSON.stringify(queryKey).slice(0, 60)} — age ${Math.round(dataAge / 1000)}s, threshold ${Math.round(staleThresholdMs / 1000)}s`,
        );
      }

      if (dataAge > staleThresholdMs) {
        refetch();
      }

      onFocus?.();
    }, [queryClient, queryKey, refetch, staleThresholdMs, enabled, onFocus]),
  );
}
