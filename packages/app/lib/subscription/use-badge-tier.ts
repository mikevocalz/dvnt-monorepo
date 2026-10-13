/**
 * The badge tier to show for SOMEONE ELSE.
 *
 * `useEntitlements` answers "what can I do?" and only ever reads the signed-in
 * user's own row — `membership_subscriptions` is own-rows-only by policy, and
 * should stay that way: it carries billing state that is nobody else's
 * business. But a badge is meant to be seen, so the public half lives in the
 * `user_badge_tiers` view, which exposes who + which tier and nothing else.
 *
 * Deliberately returns a PlanKey and not an Entitlements object: a caller must
 * not be able to reach an access decision through this. Access checks read
 * `useEntitlements`; this only decides which mark to draw.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import type { PlanKey } from "./types";

export function useBadgeTier(username: string | null | undefined) {
  const query = useQuery({
    queryKey: ["badgeTier", username],
    enabled: !!username,
    // Grants can be revoked at any time; keep an open profile in sync.
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: async (): Promise<PlanKey | null> => {
      const { data, error } = await supabase
        .from("user_badge_tiers")
        .select("plan_key")
        .eq("username", username as string)
        .maybeSingle();
      if (error) throw error;
      return ((data as any)?.plan_key as PlanKey) ?? null;
    },
  });
  return { planKey: query.isError ? null : query.data ?? null, isLoading: query.isLoading };
}
