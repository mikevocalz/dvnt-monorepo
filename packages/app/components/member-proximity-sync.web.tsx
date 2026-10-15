"use client";

import { useSyncMemberProximityPresence } from "@dvnt/app/lib/hooks/use-member-proximity";

/**
 * Isolated client-only proximity publisher.
 *
 * Keeping this out of the protected web layout's initial chunk avoids loading
 * React Query, the proximity API client, verification hooks, and location-store
 * plumbing before the shell becomes interactive. The server-side proximity
 * contract remains authoritative; this component only mirrors an explicit,
 * time-bounded member visibility grant after mount.
 */
export function MemberProximitySync() {
  useSyncMemberProximityPresence();
  return null;
}
