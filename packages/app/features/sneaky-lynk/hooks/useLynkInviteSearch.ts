import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@dvnt/app/lib/api/users";
import type { LynkInvitee } from "../stores/create-store";

/** Cancellable debounce + keyed results: an older search cannot replace a newer one. */
export function useLynkInviteSearch({ query, enabled, selfIds, invitees }: {
  query: string;
  enabled: boolean;
  selfIds: string[];
  invitees: LynkInvitee[];
}) {
  const term = query.trim();
  const canSearch = enabled && term.length >= 2;
  const search = useQuery({
    queryKey: ["sneaky-lynk", "invite-search", selfIds.join(":"), term],
    enabled: canSearch,
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("Search cancelled"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 300);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      const result = await usersApi.searchUsers(term, 8, { throwOnError: true });
      if (signal.aborted) throw new Error("Search cancelled");
      return result.docs;
    },
  });
  const results: LynkInvitee[] = canSearch
    ? (search.data ?? []).filter((user) =>
        user.authId &&
        !selfIds.includes(String(user.id)) &&
        !selfIds.includes(String(user.authId)) &&
        !invitees.some((invitee) => invitee.authId === user.authId),
      )
    : [];
  return {
    results,
    isSearching: canSearch && search.isFetching,
    isError: canSearch && search.isError,
    isEmpty: canSearch && search.isSuccess && !search.isFetching && results.length === 0,
    retry: () => { void search.refetch(); },
  };
}
