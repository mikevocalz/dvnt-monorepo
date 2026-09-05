"use client";

/**
 * Web half of screen-view analytics.
 *
 * Same recorder and the same route keys as native, so "top pages" is one
 * table across both rails rather than two vocabularies that have to be
 * reconciled at read time. Renders nothing.
 */

import { usePathname } from "next/navigation";
import { useScreenViewTracking } from "@dvnt/app/lib/analytics/useScreenViewTracking";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function ScreenViewTracker() {
  const pathname = usePathname();
  const userId = useAuthStore((s) => s.user?.id);
  useScreenViewTracking(pathname ?? undefined, userId);
  return null;
}
