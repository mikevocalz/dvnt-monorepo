/**
 * User Hook
 *
 * Provides React Query hook for fetching user profile data by username
 * Uses Supabase directly
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/users";
import { STALE_TIMES } from "@/lib/perf/stale-time-config";

function findCachedUserSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  username: string,
) {
  const direct = queryClient.getQueryData(["users", "username", username]);
  if (direct) return direct;

  const authFallbacks = queryClient.getQueriesData<any>({
    queryKey: ["auth-user"],
  });
  for (const [, data] of authFallbacks) {
    if (data?.username === username) {
      return data;
    }
  }

  const userLists = queryClient.getQueriesData<any>({ queryKey: ["users"] });
  for (const [, data] of userLists) {
    if (!data) continue;

    if (Array.isArray(data)) {
      const match = data.find((item: any) => item?.username === username);
      if (match) return match;
      continue;
    }

    if (Array.isArray(data?.users)) {
      const match = data.users.find((item: any) => item?.username === username);
      if (match) return match;
      continue;
    }

    if (Array.isArray(data?.pages)) {
      for (const page of data.pages) {
        const users = Array.isArray(page?.users) ? page.users : [];
        const match = users.find((item: any) => item?.username === username);
        if (match) return match;
      }
    }
  }

  return undefined;
}

export function useUser(username: string | null | undefined) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["users", "username", username],
    queryFn: () => usersApi.getProfileByUsername(username!),
    enabled: !!username,
    placeholderData:
      username && username.length > 0
        ? () => findCachedUserSnapshot(queryClient, username)
        : undefined,
    staleTime: STALE_TIMES.profileOther,
    refetchOnMount: "always",
  });
}
