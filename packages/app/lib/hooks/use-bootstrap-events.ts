import { sanitizeEventAttendance } from "@dvnt/app/lib/events/event-attendee-visibility";
import { getSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { storedEventType } from "@dvnt/app/lib/events/event-type";
/**
 * Bootstrap Events Hook
 *
 * When `perf_bootstrap_events` flag is ON, fetches events + viewer RSVP state
 * in a single request and hydrates the TanStack Query cache.
 *
 * Eliminates: getEvents + host lookups + RSVP attendee lookups waterfall.
 */

import { useEffect, useRef } from "react";
import { useQueryClient, isCancelledError } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { isFeatureEnabled } from "@dvnt/app/lib/feature-flags";
import { bootstrapApi, type BootstrapEventsResponse } from "@dvnt/app/lib/api/bootstrap";
import { eventKeys } from "@dvnt/app/lib/hooks/use-events";
import { useScreenTrace } from "@dvnt/app/lib/perf/screen-trace";

function bootstrapEventsForCache(data: BootstrapEventsResponse) {
  return data.events.map(event => sanitizeEventAttendance({ ...event, category: storedEventType(event) }));
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

    const session = getSessionLifecycle();
    // Own the request through QueryClient so realtime privacy changes and
    // account-boundary cancellation can discard even the initial response.
    void queryClient.fetchQuery({
      queryKey: eventKeys.list(),
      retry: false,
      queryFn: async () => {
        const data = await bootstrapApi.events({ userId });
        const current = getSessionLifecycle();
        if (!current.ready || current.epoch !== session.epoch ||
          String(useAuthStore.getState().user?.id ?? "") !== String(userId)) {
          throw new Error("Event bootstrap account changed");
        }
        if (!data) throw new Error("Event bootstrap unavailable");
        return bootstrapEventsForCache(data);
      },
    }).then(() => {
      if (getSessionLifecycle().epoch === session.epoch) trace.markUsable();
    }).catch((error) => {
      if (!isCancelledError(error)) console.warn("[BootstrapEvents] Request discarded:", error);
    });
  }, [enabled, userId, queryClient, trace]);

  return { enabled };
}
