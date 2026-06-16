/**
 * Bootstrap API Client
 *
 * Single-request data loaders for each core screen.
 * Falls back gracefully to individual queries on failure.
 *
 * Feature-flagged via perf_bootstrap_* flags.
 */

import { supabase } from "../supabase/client";
import type { TextPostSlide, TextPostThemeKey } from "@/lib/types";

export interface BootstrapFeedResponse {
  posts: BootstrapPost[];
  stories: BootstrapStory[];
  viewer: BootstrapViewer;
  nextCursor: number | null;
  hasMore: boolean;
  _meta?: { elapsed: number; postCount: number; storyCount: number };
}

export interface BootstrapPost {
  id: string;
  caption: string;
  kind?: "media" | "text";
  textTheme?: TextPostThemeKey | null;
  textSlides?: TextPostSlide[];
  createdAt: string;
  isNSFW: boolean;
  location: string | null;
  likes: number;
  commentsCount: number;
  viewerHasLiked: boolean;
  viewerHasBookmarked: boolean;
  author: {
    id?: string;
    username: string;
    firstName: string;
    avatar: string;
    verified: boolean;
  };
  media: { type: string; url: string; mimeType?: string; livePhotoVideoUrl?: string }[];
}

export interface BootstrapStory {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string;
  latestThumbnail: string;
  itemCount: number;
}

export interface BootstrapViewer {
  id: string;
  username: string;
  avatarUrl: string;
  unreadMessages: number;
  unreadMessagesAuthoritative?: boolean;
  unreadNotifications: number;
}

export interface BootstrapProfileResponse {
  profile: {
    id: string;
    authId: string;
    username: string;
    firstName: string;
    bio: string;
    website: string;
    location: string;
    avatarUrl: string;
    followersCount: number;
    followingCount: number;
    postsCount: number;
    verified: boolean;
    viewerIsFollowing: boolean;
    viewerIsFollowedBy: boolean;
  };
  posts: {
    id: string;
    kind?: "media" | "text";
    textTheme?: TextPostThemeKey | null;
    caption?: string;
    textSlideCount?: number;
    media?: { type: string; url: string }[];
    thumbnailUrl: string;
    type: string;
    likesCount: number;
    isNSFW?: boolean;
  }[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface BootstrapNotificationsResponse {
  activities: {
    id: string;
    type: string;
    createdAt: string;
    isRead: boolean;
    actor: {
      id: string;
      username: string;
      avatarUrl: string;
      viewerFollows?: boolean;
    };
    entityType?: string;
    entityId?: string;
    post?: { id: string; thumbnailUrl: string };
    event?: { id: string; title: string };
    commentText?: string;
    postId?: string;
    commentId?: string;
  }[];
  unreadCount: number;
  viewerFollowing: Record<string, boolean>;
}

export interface BootstrapMessagesResponse {
  conversations: {
    id: string;
    user: {
      id: string;
      authId: string;
      name: string;
      username: string;
      avatar: string;
    };
    lastMessage: string;
    timestamp: string;
    unread: boolean;
    isGroup: boolean;
  }[];
  unreadInbox: number;
  unreadSpam: number;
  unreadAuthoritative?: boolean;
  _meta?: { elapsed: number; count: number };
}

export interface BootstrapEventsResponse {
  events: {
    id: string;
    title: string;
    description: string;
    date: string;
    month: string;
    fullDate?: string;
    time: string;
    location: string;
    image: string;
    images: any[];
    youtubeVideoUrl: string | null;
    price: number;
    likes: number;
    attendees: { image: string; initials: string }[] | number;
    totalAttendees: number;
    host: { username: string; avatar: string };
  }[];
  viewerRsvps: Record<string, string>;
  _meta?: { elapsed: number; count: number };
}

export const bootstrapApi = {
  /**
   * Feed bootstrap — all above-the-fold data in one request.
   */
  async feed(params: {
    userId: string;
    cursor?: number;
    limit?: number;
    includeNSFW?: boolean;
  }): Promise<BootstrapFeedResponse | null> {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke(
        "bootstrap-feed",
        {
          body: {
            user_id: params.userId,
            cursor: params.cursor || 0,
            limit: params.limit || 20,
            include_nsfw: params.includeNSFW === true,
          },
        },
      );

      if (error) throw error;

      const elapsed = Date.now() - t0;
      console.log(
        `[Bootstrap] Feed loaded in ${elapsed}ms — ${data?.posts?.length || 0} posts, ${data?.stories?.length || 0} stories`,
      );

      return data as BootstrapFeedResponse;
    } catch (err) {
      console.error("[Bootstrap] Feed error:", err);
      return null;
    }
  },

  /**
   * Profile bootstrap — profile header + first page of posts.
   */
  async profile(params: {
    userId: string;
    viewerId?: string;
    includeNSFW?: boolean;
  }): Promise<BootstrapProfileResponse | null> {
    try {
      const { data, error } = await supabase.functions.invoke(
        "bootstrap-profile",
        {
          body: {
            user_id: params.userId,
            viewer_id: params.viewerId,
            include_nsfw: params.includeNSFW === true,
          },
        },
      );

      if (error) throw error;
      return data as BootstrapProfileResponse;
    } catch (err) {
      console.warn(
        "[Bootstrap] Profile error (non-fatal, falls back to individual queries):",
        err,
      );
      return null;
    }
  },

  /**
   * Notifications bootstrap — activities + follow state + unread count.
   */
  async notifications(params: {
    userId: string;
    limit?: number;
  }): Promise<BootstrapNotificationsResponse | null> {
    try {
      const { data, error } = await supabase.functions.invoke(
        "bootstrap-notifications",
        {
          body: {
            user_id: params.userId,
            limit: params.limit || 50,
          },
        },
      );

      if (error) throw error;
      return data as BootstrapNotificationsResponse;
    } catch (err) {
      console.error("[Bootstrap] Notifications error:", err);
      return null;
    }
  },

  /**
   * Messages bootstrap — conversations + unread counts in one request.
   */
  async messages(params: {
    userId: string;
    filter?: "primary" | "requests";
    limit?: number;
  }): Promise<BootstrapMessagesResponse | null> {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke(
        "bootstrap-messages",
        {
          body: {
            user_id: params.userId,
            filter: params.filter || "primary",
            limit: params.limit || 30,
          },
        },
      );

      if (error) throw error;

      const elapsed = Date.now() - t0;
      console.log(
        `[Bootstrap] Messages loaded in ${elapsed}ms — ${data?.conversations?.length || 0} conversations`,
      );

      return data as BootstrapMessagesResponse;
    } catch (err) {
      console.error("[Bootstrap] Messages error:", err);
      return null;
    }
  },

  /**
   * Events bootstrap — events + RSVP state in one request.
   */
  async events(params: {
    userId: string;
    limit?: number;
  }): Promise<BootstrapEventsResponse | null> {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke(
        "bootstrap-events",
        {
          body: {
            user_id: params.userId,
            limit: params.limit || 20,
          },
        },
      );

      if (error) throw error;

      const elapsed = Date.now() - t0;
      console.log(
        `[Bootstrap] Events loaded in ${elapsed}ms — ${data?.events?.length || 0} events`,
      );

      return data as BootstrapEventsResponse;
    } catch (err) {
      console.error("[Bootstrap] Events error:", err);
      return null;
    }
  },
};
