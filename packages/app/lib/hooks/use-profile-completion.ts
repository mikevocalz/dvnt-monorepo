import { useSyncExternalStore } from "react";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { fetchOwnIdentity } from "@dvnt/app/lib/profile/own-identity";
import { completionFromSources, type CompletionProfile } from "@dvnt/app/lib/profile/completion-sources";

export const profileCompletionKey = (id: string, authId?: string, epoch = getSessionLifecycle().epoch) =>
  ["profileCompletionPresence", id, authId ?? "", epoch] as const;

/** Cancel explicitly: invalidateQueries alone reuses a pending first read
 * (when no cached data exists), allowing pre-save presence to win afterward. */
export async function refreshProfileCompletionPresence(
  queryClient: QueryClient,
  user: { id: string; authId?: string },
) {
  const queryKey = profileCompletionKey(user.id, user.authId);
  await queryClient.cancelQueries({ queryKey, exact: true });
  await queryClient.invalidateQueries({ queryKey, exact: true });
}

/** The ring is advisory. Never display a deficit while its private owner-only
 * read is unavailable. This key is not included in either persisted-query
 * allowlist, and stores only presence flags, not private preference values. */
export function useProfileCompletion(profile?: CompletionProfile | null) {
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s._hasHydrated);
  const authenticated = useAuthStore((s) => s.isAuthenticated && s.authStatus === "authenticated");
  const lifecycle = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle);
  const matchesSession = !lifecycle.authId || lifecycle.authId === (user?.authId || user?.id);
  const ready = hydrated && authenticated && lifecycle.ready && matchesSession;
  const id = user?.id ?? "";
  const authId = user?.authId;
  const query = useQuery({
    queryKey: profileCompletionKey(id, authId, lifecycle.epoch),
    enabled: ready && !!id,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await fetchOwnIdentity(supabase, id);
      const currentLifecycle = getSessionLifecycle();
      const auth = useAuthStore.getState();
      const current = auth.user;
      if (
        signal.aborted ||
        currentLifecycle.epoch !== lifecycle.epoch ||
        !currentLifecycle.ready ||
        (currentLifecycle.authId && currentLifecycle.authId !== (current?.authId || current?.id)) ||
        !auth._hasHydrated ||
        !auth.isAuthenticated ||
        auth.authStatus !== "authenticated" ||
        current?.id !== id || current?.authId !== authId
      ) {
        throw new Error("Profile completion owner changed");
      }
      if (!result.ok) throw new Error("Profile completion unavailable");
      return {
        hasIdentity: result.identity.sexuality.some((value) => value.trim().length > 0),
        hasEventAudience: result.identity.eventAudience.trim().length > 0,
      };
    },
  });
  // isFetchedAfterMount prevents an old snapshot from flashing on entry.
  return completionFromSources(
    user,
    profile,
    ready && query.isFetchedAfterMount && !query.isError ? query.data : null,
  );
}
