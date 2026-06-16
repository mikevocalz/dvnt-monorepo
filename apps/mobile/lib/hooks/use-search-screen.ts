/**
 * Search Screen Hooks — ZERO WATERFALL
 *
 * Two consolidated queries (one for discover, one for search results).
 * Each fetches ALL section data in a single Promise.all → no trickle-in.
 *
 * Rules:
 * - ONE query per screen mode (discover vs search)
 * - Skeleton until query resolves → all sections render together
 * - Debounced search query in queryKey
 * - keepPreviousData only after first success
 */

import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/users";
import { postsApi } from "@/lib/api/posts";
import { searchApi } from "@/lib/api/search";
import type { Post } from "@/lib/types";

const SEARCH_QUERY_VERSION = "v2";

function filterSafePosts(posts: Post[]) {
  return posts.filter((post) => !post.isNSFW);
}

// ── Discover mode (empty query) — single batch ─────────────────────
export interface DiscoverDTO {
  users: {
    id: string;
    username: string;
    name: string;
    avatar: string;
    verified: boolean;
    bio: string;
    postsCount: number;
  }[];
  posts: Post[];
}

export function useDiscoverData(options?: { enabled?: boolean }) {
  return useQuery<DiscoverDTO>({
    queryKey: ["search", SEARCH_QUERY_VERSION, "discover"],
    queryFn: async () => {
      const [users, posts] = await Promise.all([
        usersApi.getNewestUsers(15),
        postsApi.getExplorePosts(40),
      ]);
      return { users, posts: filterSafePosts(posts) };
    },
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

// ── Search mode (has query) — single batch ──────────────────────────
export interface SearchResultsDTO {
  posts: { docs: any[]; totalDocs: number };
  users: { docs: any[]; totalDocs: number };
  isHashtag: boolean;
}

export function useSearchResults(
  debouncedQuery: string,
  options?: { enabled?: boolean },
) {
  return useQuery<SearchResultsDTO>({
    queryKey: ["search", SEARCH_QUERY_VERSION, "results", debouncedQuery],
    queryFn: async () => {
      const isHashtag = debouncedQuery.startsWith("#");
      const [posts, users] = await Promise.all([
        searchApi.searchPosts(debouncedQuery),
        isHashtag
          ? Promise.resolve({ docs: [], totalDocs: 0 })
          : searchApi.searchUsers(debouncedQuery, 20),
      ]);
      const safePosts = filterSafePosts(posts.docs);
      return {
        posts: {
          ...posts,
          docs: safePosts,
          totalDocs: safePosts.length,
        },
        users,
        isHashtag,
      };
    },
    enabled:
      (options?.enabled ?? true) &&
      !!debouncedQuery &&
      debouncedQuery.length >= 2,
  });
}
