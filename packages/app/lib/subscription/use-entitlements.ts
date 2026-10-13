/** One entitlement read path for Stripe, RevenueCat, and legacy Sneaky plans. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import type { Entitlements } from "./types";
import {
  fetchSubscriptionRecords,
  subscriptionAuthId,
  entitlementReadSnapshot,
  nextEntitlementBoundary,
  type RailedSubscriptionRecord,
} from "./subscription-records";
export type { MembershipRail, RailedSubscriptionRecord } from "./subscription-records";

export const ENTITLEMENTS_QUERY_KEY = ["entitlements"] as const;

export interface UseEntitlementsResult {
  entitlements: Entitlements;
  records: RailedSubscriptionRecord[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useEntitlements(): UseEntitlementsResult {
  const userId = useAuthStore((s) => subscriptionAuthId(s.user));
  const authStatus = useAuthStore((s) => s.authStatus);
  const enabled = authStatus === "authenticated" && !!userId;
  const query = useQuery({
    queryKey: [...ENTITLEMENTS_QUERY_KEY, userId],
    enabled,
    staleTime: 0,
    // Renewals and cancellations must reconcile in an already-open room too.
    refetchInterval: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: () => fetchSubscriptionRecords(supabase, userId as string),
  });
  const [now, setNow] = useState(() => Date.now());
  const boundary = nextEntitlementBoundary(query.data ?? [], Date.now());
  useEffect(() => {
    if (!enabled || boundary === null) return;
    // setTimeout overflows beyond ~24 days. Reevaluate long periods safely.
    const timer = setTimeout(() => {
      setNow(Date.now());
      void query.refetch();
    }, Math.min(Math.max(boundary - Date.now(), 0) + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [enabled, boundary, now, query.refetch]);

  const isLoading = authStatus === "loading" || (enabled && query.isPending);
  const identityError = authStatus === "authenticated" && !userId;
  const isError = identityError || (enabled && query.isError);
  const snapshot = entitlementReadSnapshot(query.data,
    isError ? "error" : isLoading ? "loading" : enabled ? "ready" : "signed_out",
    new Date(),
  );
  return {
    ...snapshot,
    isLoading,
    isError,
    error: identityError ? new Error("Could not verify subscription identity.") : query.error,
    refetch: () => void query.refetch(),
  };
}
