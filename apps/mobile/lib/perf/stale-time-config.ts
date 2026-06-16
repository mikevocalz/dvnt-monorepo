/**
 * Centralized staleTime Configuration
 *
 * Every query in the app should reference these constants instead of
 * hardcoding staleTime values. This makes tuning a single-file change.
 *
 * Philosophy:
 * - Aggressive caching for data that rarely changes (profiles, bookmarks)
 * - Short staleTime for data that must feel real-time (unread counts, presence)
 * - Medium staleTime for core lists (feed, conversations)
 * - SWR everywhere: render from cache first, revalidate silently
 */

export const STALE_TIMES = {
  /** Feed posts — moderate freshness, SWR on mount */
  feed: 2 * 60 * 1000, // 2 min

  /** Own profile — rarely changes, background refresh */
  profileSelf: 5 * 60 * 1000, // 5 min

  /** Other user profiles — background refresh on view */
  profileOther: 3 * 60 * 1000, // 3 min

  /** Conversation list — must feel fresh but not real-time */
  conversations: 30 * 1000, // 30 sec

  /** Unread message/notification counts — badge must update fast */
  unreadCounts: 15 * 1000, // 15 sec

  /** Activity/notifications list — new notifs via realtime, not poll */
  activities: 60 * 1000, // 1 min

  /** Events list — 0 so we always background-revalidate on mount.
   * Events can be cancelled or deleted by hosts at any time, and a
   * cached cancelled event surfacing in the UI is a polish bug we
   * shouldn't ship. Pairs with refetchOnMount: "always" on the events
   * useQuery calls so persisted MMKV cache is overwritten the moment
   * the screen mounts. */
  events: 0,

  /** Bookmarks — user-initiated changes only */
  bookmarks: 10 * 60 * 1000, // 10 min

  /** Stories — ephemeral, must be fresh */
  stories: 30 * 1000, // 30 sec

  /** Weather forecast — slow-changing data */
  weather: 30 * 60 * 1000, // 30 min

  /** Liked posts sync — user-driven, not urgent */
  likedPosts: 5 * 60 * 1000, // 5 min

  /** Profile posts grid — stable until user creates/deletes */
  profilePosts: 5 * 60 * 1000, // 5 min

  /** Follow state — needed for button rendering */
  followState: 2 * 60 * 1000, // 2 min

  /** Post detail — stable, invalidated on interaction */
  postDetail: 5 * 60 * 1000, // 5 min

  /** Post/event comments — serve from cache instantly, revalidate in background */
  comments: 60 * 1000, // 60 sec

  /** Post like state — must be responsive */
  likeState: 30 * 1000, // 30 sec

  /** Story viewer count — must poll frequently */
  storyViewers: 0, // always stale, relies on refetchInterval
} as const;

export const GC_TIMES = {
  /** Standard gc time for most queries */
  standard: 30 * 60 * 1000, // 30 min

  /** Short gc for ephemeral data (stories, presence) */
  short: 5 * 60 * 1000, // 5 min

  /** Long gc for stable data (bookmarks, weather) */
  long: 2 * 60 * 60 * 1000, // 2 hours
} as const;
