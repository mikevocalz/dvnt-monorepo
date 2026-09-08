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
    // A tier changes at most monthly; re-asking on every profile visit is
    // wasted traffic for a value that is decorative.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<PlanKey | null> => {
      const { data } = await supabase
        .from("user_badge_tiers")
        .select("plan_key")
        .eq("username", username as string)
        .maybeSingle();
      return ((data as any)?.plan_key as PlanKey) ?? null;
    },
  });
  return { planKey: query.data ?? null, isLoading: query.isLoading };
}
