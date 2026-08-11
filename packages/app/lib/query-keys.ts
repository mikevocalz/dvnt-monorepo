/**
 * Cross-feature TanStack Query keys, in one dependency-free module.
 *
 * These used to live inside the hook files that own them, which meant
 * `use-posts` had to import `use-profile` just to invalidate a profile and
 * `use-profile` had to import `use-posts` to invalidate a post — a require
 * cycle in both directions, and Metro warned about it on every boot. A key is
 * data, not behaviour: it belongs somewhere neither hook has to reach into.
 *
 * Import keys from HERE in new code. The owning hooks re-export their own key
 * object so the existing call sites keep working.
 *
 * Nothing in this file may import anything at RUNTIME. The one `import type`
 * below is erased by the compiler, so it cannot form a cycle.
 */

// Type-only: erased at build time, so this does not reintroduce the cycle.
import type { EventFilters } from "@dvnt/app/lib/hooks/use-events";

export const postKeys = {
  all: ["posts"] as const,
  feed: () => [...postKeys.all, "feed"] as const,
  feedInfinite: () => [...postKeys.all, "feed", "infinite"] as const,
  profilePosts: (userId: string) => ["profilePosts", userId] as const,
  profile: (userId: string) => postKeys.profilePosts(userId),
  detail: (id: string) => [...postKeys.all, "detail", id] as const,
};

export const profileKeys = {
  all: ["profile"] as const,
  byId: (userId: string) => ["profile", userId] as const,
  byUsername: (username: string) => ["profile", "username", username] as const,
};

export const activityKeys = {
  all: ["activities"] as const,
  list: (viewerId: string) => ["activities", viewerId] as const,
  liked: (viewerId: string) => ["activities", viewerId, "liked"] as const,
};

export const postLikersKeys = {
  all: ["postLikers"] as const,
  forPost: (postId: string) => ["postLikers", postId] as const,
};

export const likeStateKeys = {
  all: ["likeState"] as const,
  forPost: (viewerId: string, postId: string) =>
    ["likeState", viewerId, postId] as const,
};

export const commentKeys = {
  all: ["comments"] as const,
  byPost: (postId: string) => [...commentKeys.all, "post", postId] as const,
  thread: (postId: string, rootCommentId: string) =>
    [...commentKeys.all, "thread", postId, rootCommentId] as const,
};

export const eventKeys = {
  all: ["events"] as const,
  list: (filters?: EventFilters) =>
    [...eventKeys.all, "list", filters ?? {}] as const,
  upcoming: () => [...eventKeys.all, "upcoming"] as const,
  past: () => [...eventKeys.all, "past"] as const,
  detail: (id: string) => [...eventKeys.all, "detail", id] as const,
  byCategory: (category: string) =>
    [...eventKeys.all, "category", category] as const,
  liked: (userId: number) => [...eventKeys.all, "liked", userId] as const,
  search: (q: string) => [...eventKeys.all, "search", q] as const,
  forYou: () => [...eventKeys.all, "forYou"] as const,
};
