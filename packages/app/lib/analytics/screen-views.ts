/**
 * Screen-view analytics — where people go, how long they stay, and which
 * events pull traffic.
 *
 * WHY THIS EXISTS RATHER THAN SENTRY:
 * Sentry never answered these questions. `@dvnt/observability`'s `flows/`
 * write BREADCRUMBS, and a breadcrumb only ships attached to an error — a
 * healthy session, which is the one you want to measure, records nothing.
 * The `analytics_events` table this writes to has been documented as the
 * source of truth in `observability/src/bridge.ts` since it was written; it
 * had simply never been created.
 *
 * Deliberately small: one insert per screen EXIT, carrying the route, what
 * the screen was about, and how long it was open. No session stitching, no
 * device graph, no third party.
 */

import { supabase } from "@dvnt/app/lib/supabase/client";
import { entityFromRoute, normalizeRoute } from "./route-keys";

export interface ScreenViewInput {
  pathname: string;
  durationMs: number;
  userId?: string | null;
  platform: string;
}

/**
 * Record one finished screen view.
 *
 * Never throws and never blocks navigation: analytics that can break the app
 * it measures is worse than no analytics. A dropped row is acceptable; a
 * dropped frame is not.
 */
export async function recordScreenView(input: ScreenViewInput): Promise<void> {
  // A view too short to read is a navigation artifact (a redirect, a back
  // swipe passing through), not a visit. Counting them makes every funnel
  // look healthier than it is.
  if (input.durationMs < 400) return;
  const route = normalizeRoute(input.pathname);
  const entity = entityFromRoute(input.pathname);
  try {
    await supabase.from("analytics_events").insert({
      event: "screen_view",
      route,
      entity_type: entity?.type ?? null,
      entity_id: entity?.id ?? null,
      duration_ms: Math.min(input.durationMs, 6 * 60 * 60 * 1000),
      user_id: input.userId ?? null,
      platform: input.platform,
    });
  } catch {
    // Swallowed on purpose — see the note above.
  }
}
