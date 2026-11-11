import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { promotersApi } from "@dvnt/app/lib/api/promoters";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { promoterConnectPresentation } from "../payments/promoter-payout-status";

export function usePromoterPayout(eventId: number) {
  const viewerId = useAuthStore((s) => s.user?.id ?? "anon");
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  const enabled = authenticated && Number.isSafeInteger(eventId) && eventId > 0;
  const meQuery = useQuery({
    queryKey: ["promoter-self", viewerId, eventId],
    queryFn: () => promotersApi.me(eventId),
    enabled,
    staleTime: 15_000,
    retry: 1,
  });
  const connectQuery = useQuery({
    queryKey: ["promoter-connect-status", viewerId, eventId],
    queryFn: () => promotersApi.connectStatus(eventId),
    enabled: enabled && meQuery.data?.isPromoter === true,
    staleTime: 15_000,
    retry: 1,
  });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    await Promise.all([
      meQuery.refetch(),
      ...(meQuery.data?.isPromoter ? [connectQuery.refetch()] : []),
    ]);
  }, [enabled, meQuery.refetch, connectQuery.refetch, meQuery.data?.isPromoter]);
  return {
    meQuery, connectQuery, refresh, viewerId, authenticated,
    setup: promoterConnectPresentation(connectQuery.data, connectQuery.isError),
    refreshing: meQuery.isFetching || connectQuery.isFetching,
  };
}
