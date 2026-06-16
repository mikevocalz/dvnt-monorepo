/**
 * Central Query Key Registry
 *
 * EVERY TanStack Query key in the app MUST be defined here.
 * Keys are arrays of stable primitives — no raw objects.
 *
 * Naming: qk.<screen>.<variant>(params)
 *
 * Rules:
 * - All inputs that affect results MUST be in the key
 * - Use stableStringify for objects (filters, sort, etc.)
 * - Keys are readonly tuples for type safety
 */

import { stableStringify } from "./canonicalize";

export const qk = {
  // ── Feed ──────────────────────────────────────────────────────
  feed: {
    infinite: () => ["feed", "infinite"] as const,
    legacy: () => ["feed", "legacy"] as const,
  },

  // ── Posts ─────────────────────────────────────────────────────
  posts: {
    all: () => ["posts"] as const,
    detail: (postId: string) => ["posts", "detail", postId] as const,
    byIds: (ids: string[]) => ["posts", "byIds", ids.sort().join(",")] as const,
    profile: (userId: string) => ["profilePosts", userId] as const,
  },

  // ── Likes ─────────────────────────────────────────────────────
  likes: {
    syncedPosts: () => ["likedPosts"] as const,
    likeState: (viewerId: string, postId: string) =>
      ["likeState", viewerId, postId] as const,
    postLikers: (postId: string) => ["postLikers", postId] as const,
  },

  // ── Comments ──────────────────────────────────────────────────
  comments: {
    thread: (postId: string) => ["comments", "thread", postId] as const,
    likers: (commentId: string) => ["comments", "likers", commentId] as const,
  },

  // ── Events ────────────────────────────────────────────────────
  events: {
    all: () => ["events"] as const,
    list: (filters?: Record<string, unknown>) =>
      ["events", "list", filters ? stableStringify(filters) : "none"] as const,
    detail: (eventId: string) => ["events", "detail", eventId] as const,
    forYou: () => ["events", "forYou"] as const,
    search: (query: string) => ["events", "search", query] as const,
    upcoming: () => ["events", "upcoming"] as const,
    past: () => ["events", "past"] as const,
    mine: () => ["events", "mine"] as const,
    liked: (userId: number) => ["events", "liked", userId] as const,
    spotlight: () => ["events", "spotlight"] as const,
    promoted: () => ["events", "promoted"] as const,
  },

  // ── Profile ───────────────────────────────────────────────────
  profile: {
    byId: (userId: string) => ["profile", "byId", userId] as const,
    byUsername: (username: string) =>
      ["profile", "byUsername", username] as const,
    authUser: () => ["authUser"] as const,
  },

  // ── Messages ──────────────────────────────────────────────────
  messages: {
    filtered: (filter: "primary" | "requests", userId: string) =>
      ["messages", "filtered", filter, userId] as const,
    all: (userId: string) => ["messages", "all", userId] as const,
    unreadCount: (userId: string) =>
      ["messages", "unreadCount", userId] as const,
  },

  // ── Activity / Notifications ──────────────────────────────────
  activity: {
    list: (viewerId: string) => ["activities", viewerId] as const,
    liked: (viewerId: string) => ["activities", viewerId, "liked"] as const,
    unreadCount: (viewerId: string) =>
      ["activities", "unread", viewerId] as const,
  },

  // ── Tickets ───────────────────────────────────────────────────
  tickets: {
    mine: () => ["tickets", "mine"] as const,
    forEvent: (eventId: string) => ["tickets", "event", eventId] as const,
    byEventAndCategory: (eventId: string, category: string) =>
      ["tickets", "event", eventId, "category", category] as const,
  },

  // ── Cart ──────────────────────────────────────────────────────
  cart: {
    detail: (viewerId: string, cartId: string) =>
      ["cart", viewerId, cartId] as const,
    lineItems: (viewerId: string, cartId: string) =>
      ["cart", viewerId, cartId, "line-items"] as const,
    status: (viewerId: string, cartId: string) =>
      ["cart", viewerId, cartId, "status"] as const,
  },

  // ── Follow ────────────────────────────────────────────────────
  follow: {
    state: (viewerId: string, targetUserId: string) =>
      ["followState", viewerId, targetUserId] as const,
    followers: (userId: string) => ["followers", userId] as const,
    following: (userId: string) => ["following", userId] as const,
  },

  // ── Bookmarks ─────────────────────────────────────────────────
  bookmarks: {
    list: () => ["bookmarks"] as const,
  },

  // ── Stories ───────────────────────────────────────────────────
  stories: {
    feed: () => ["stories"] as const,
    viewers: (storyId: string) => ["stories", "viewers", storyId] as const,
  },

  // ── Search ────────────────────────────────────────────────────
  search: {
    results: (query: string, tab: string) => ["search", query, tab] as const,
  },
} as const;
