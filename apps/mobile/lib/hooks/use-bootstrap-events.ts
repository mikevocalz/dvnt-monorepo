/**
 * Bootstrap Events Hook
 *
 * When `perf_bootstrap_events` flag is ON, fetches events + viewer RSVP state
 * in a single request and hydrates the TanStack Query cache.
 *
 * Eliminates: getEvents + host lookups + RSVP attendee lookups waterfall.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { bootstrapApi, type BootstrapEventsResponse } from "@/lib/api/bootstrap";
import { eventKeys } from "@/lib/hooks/use-events";
import { useScreenTrace } from "@/lib/perf/screen-trace";

function hydrateFromEventsBootstrap(
  queryClient: ReturnType<typeof useQueryClient>,
  data: BootstrapEventsResponse,
) {
  // Seed the events list cache
  queryClient.setQueryData(eventKeys.list(), data.events);

  console.log(
    `[BootstrapEvents] Hydrated cache: ${data.events.length} events`,
  );
}

export function useBootstrapEvents() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";
  const hasRun = useRef(false);
  const trace = useScreenTrace("Events");

  const enabled = isFeatureEnabled("perf_bootstrap_events");

  useEffect(() => {
    if (!enabled || !userId || hasRun.current) return;
    hasRun.current = true;

    // Check if we already have fresh events data
    const existing = queryClient.getQueryData(eventKeys.list());
    if (existing) {
      trace.markCacheHit();
      trace.markUsable();
      return;
    }

    bootstrapApi.events({ userId }).then((data) => {
      if (!data) return;
      hydrateFromEventsBootstrap(queryClient, data);
      trace.markUsable();
    });
  }, [enabled, userId, queryClient, trace]);

  return { enabled };
}
