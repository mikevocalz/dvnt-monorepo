import { useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Transition from "react-native-screen-transitions";
import { ArrowLeft, Ticket, Sparkles } from "lucide-react-native";
import { Image } from "expo-image";
import { FeedPost } from "@dvnt/app/components/feed/feed-post";
import { FeedEventCard } from "@dvnt/app/components/feed/feed-event-card";
import { StoriesBar } from "@dvnt/app/components/stories/stories-bar";
import { ProfileMasonryGrid } from "@dvnt/app/components/profile/ProfileMasonryGrid";
import { useFeedPosts, postKeys } from "@dvnt/app/lib/hooks/use-posts";
import { useEvents, eventKeys, type Event } from "@dvnt/app/lib/hooks/use-events";
import { ticketKeys, useMyTickets } from "@dvnt/app/lib/hooks/use-tickets";
import { commentKeys } from "@dvnt/app/lib/hooks/use-comments";
import { storyKeys } from "@dvnt/app/lib/hooks/use-stories";
import { motionTags } from "@dvnt/app/lib/navigation/transition-tags";
import type { Post, Story } from "@dvnt/app/lib/types";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { safeGridTile } from "@dvnt/app/lib/utils/safe-profile-mappers";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import type { EventDetail } from "@dvnt/app/src/events/types";

const DEMO_FEED_POST_ID = "900001";
const DEMO_MASONRY_POST_ID = "900002";
const DEMO_STORY_ID = "900005";
const DEMO_EVENT_ID = "900003";
const DEMO_TICKET_EVENT_ID = "900004";

const DEMO_AUTHOR = {
  id: "900090",
  username: "dvntmotion",
  avatar:
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
  verified: true,
  name: "DVNT Motion",
};

const DEMO_FEED_POST: Post = {
  id: DEMO_FEED_POST_ID,
  author: DEMO_AUTHOR,
  media: [
    {
      type: "image",
      url: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=80",
    },
  ],
  caption: "Transition lab. Fast, clean, and no duplicate flashes.",
  likes: 248,
  viewerHasLiked: false,
  comments: 12,
  timeAgo: "2m",
  location: "Chelsea · NYC",
  kind: "media",
  thumbnail:
    "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=80",
  type: "image",
  hasMultipleImages: false,
};

const DEMO_MASONRY_POST: Post = {
  id: DEMO_MASONRY_POST_ID,
  author: {
    ...DEMO_AUTHOR,
    username: "masonryproof",
  },
  media: [
    {
      type: "image",
      url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    },
  ],
  caption: "Masonry source to detail viewer.",
  likes: 91,
  viewerHasLiked: false,
  comments: 4,
  timeAgo: "9m",
  location: "Lower East Side",
  kind: "media",
  thumbnail:
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  type: "image",
  hasMultipleImages: false,
};

const DEMO_EVENT_DETAIL: EventDetail & {
  fullDate: string;
  isLiked: boolean;
  userRsvpStatus: string;
  ticketTiers: any[];
  attendeeAvatars: Array<{ id: string; avatar: string }>;
  topReviews: any[];
  topComments: any[];
  reviewCount: number;
} = {
  id: DEMO_EVENT_ID,
  title: "Midnight Motion Lab",
  description:
    "A deterministic event detail transition proof with rich hero media and live CTA chrome.",
  date: "08",
  fullDate: new Date(Date.now() + 86400000).toISOString(),
  endDate: new Date(Date.now() + 3 * 3600000).toISOString(),
  location: "Tribeca Loft",
  image:
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1400&q=80",
  images: [
    {
      type: "image",
      url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1400&q=80",
    },
    {
      type: "image",
      url: "https://images.unsplash.com/photo-1505236731923-6c44f0f48141?auto=format&fit=crop&w=1400&q=80",
    },
  ],
  youtubeVideoUrl: null,
  price: 35,
  likes: 0,
  isLiked: false,
  attendees: 148,
  maxAttendees: 220,
  host: DEMO_AUTHOR,
  coOrganizer: null,
  averageRating: 4.8,
  totalReviews: 26,
  locationLat: 40.7196,
  locationLng: -74.0089,
  locationName: "Tribeca Loft",
  locationAddress: "32 Walker St, New York, NY",
  locationType: "physical",
  visibility: "public",
  ageRestriction: "21+",
  nsfw: false,
  ticketingEnabled: true,
  shareSlug: "midnight-motion-lab",
  category: "After Hours",
  dressCode: "Minimal black, sharp edges",
  doorPolicy: "Doors close one hour after open",
  entryWindow: "11:30 PM - 12:30 AM",
  lineup: ["Avery Nova", "DJ Mirage"],
  perks: ["Immersive visuals", "Two rooms", "Late kitchen"],
  userRsvpStatus: "none",
  ticketTiers: [
    {
      id: "demo-ga",
      name: "General Admission",
      price_cents: 3500,
      perks: ["Entry", "Main room access"],
      remaining: 62,
      max_per_order: 4,
      is_sold_out: false,
      tier: "ga",
      glow_color: "#34A2DF",
    },
  ],
  attendeeAvatars: [
    {
      id: "attendee-1",
      avatar:
        "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80",
    },
    {
      id: "attendee-2",
      avatar:
        "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80",
    },
  ],
  topReviews: [],
  topComments: [],
  reviewCount: 26,
};

const DEMO_EVENT_CARD: Event = {
  id: DEMO_EVENT_ID,
  title: DEMO_EVENT_DETAIL.title,
  description: DEMO_EVENT_DETAIL.description,
  date: "08",
  month: "APR",
  fullDate: DEMO_EVENT_DETAIL.fullDate,
  time: "11:30 PM",
  location: DEMO_EVENT_DETAIL.location,
  image: DEMO_EVENT_DETAIL.image,
  images: DEMO_EVENT_DETAIL.images,
  youtubeVideoUrl: null,
  price: DEMO_EVENT_DETAIL.price,
  likes: 0,
  isLiked: false,
  attendees: DEMO_EVENT_DETAIL.attendees,
  totalAttendees: DEMO_EVENT_DETAIL.attendees,
  category: DEMO_EVENT_DETAIL.category,
  host: {
    id: DEMO_AUTHOR.id,
    username: DEMO_AUTHOR.username,
    avatar: DEMO_AUTHOR.avatar,
  },
};

const DEMO_TICKET: TicketRecord = {
  id: "demo-ticket-1",
  event_id: Number(DEMO_TICKET_EVENT_ID),
  ticket_type_id: "demo-ga",
  user_id: "900099",
  status: "active",
  qr_token: "dvnt-demo-ticket-token",
  checked_in_at: null,
  checked_in_by: null,
  purchase_amount_cents: 3500,
  created_at: new Date().toISOString(),
  ticket_type_name: "General Admission",
  event_title: "Midnight Motion Lab",
  event_image:
    "https://images.unsplash.com/photo-1505236731923-6c44f0f48141?auto=format&fit=crop&w=800&q=80",
  event_date: DEMO_EVENT_DETAIL.fullDate || new Date().toISOString(),
  event_location: "Tribeca Loft",
};

const DEMO_STORIES: Story[] = [
  {
    id: DEMO_STORY_ID,
    userId: "900123",
    username: "storyproof",
    avatar:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
    hasStory: true,
    isViewed: false,
    items: [
      {
        id: "story-item-1",
        type: "image",
        url: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1080&q=80",
        duration: 5000,
        visibility: "public",
      },
    ],
  },
];

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={{ gap: 4, marginBottom: 12 }}>
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>
        {title}
      </Text>
      <Text
        style={{
          color: "rgba(255,255,255,0.62)",
          fontSize: 13,
          lineHeight: 18,
        }}
      >
        {subtitle}
      </Text>
    </View>
  );
}

function TicketPreviewCard({
  ticket,
}: {
  ticket: TicketRecord;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const eventId = String(ticket.event_id);

  const handlePress = () => {
    queryClient.setQueryData(ticketKeys.myTicketForEvent(eventId), ticket);
    queryClient.setQueryData(ticketKeys.myTickets(), [ticket]);
    router.push(`/(protected)/ticket/${eventId}` as any);
  };

  return (
    <Transition.Pressable
      sharedBoundTag={motionTags.ticketCard(eventId)}
      onPress={handlePress}
      style={{
        borderRadius: 24,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "#0D0D10",
      }}
    >
      <View style={{ flexDirection: "row" }}>
        <Transition.View
          sharedBoundTag={motionTags.ticketHero(eventId)}
          style={{ width: 92, height: 118, overflow: "hidden" }}
        >
          <Image
            source={{ uri: ticket.event_image }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        </Transition.View>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 14,
            paddingVertical: 14,
            justifyContent: "space-between",
          }}
        >
          <View style={{ gap: 5 }}>
            <Text
              numberOfLines={1}
              style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}
            >
              {ticket.event_title}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.68)", fontSize: 12 }}>
              {ticket.ticket_type_name}
            </Text>
          </View>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <View
              style={{
                borderRadius: 999,
                backgroundColor: "rgba(63,220,255,0.14)",
                paddingHorizontal: 10,
                paddingVertical: 5,
              }}
            >
              <Text
                style={{ color: "#3FDCFF", fontSize: 11, fontWeight: "700" }}
              >
                Active
              </Text>
            </View>
            <Ticket size={16} color="#8A40CF" />
          </View>
        </View>
      </View>
    </Transition.Pressable>
  );
}

export default function TransitionDebugScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const feedPostsQuery = useFeedPosts();
  const eventsQuery = useEvents();
  const ticketsQuery = useMyTickets();

  useEffect(() => {
    if (!__DEV__) return;

    queryClient.setQueryData(postKeys.detail(DEMO_FEED_POST_ID), DEMO_FEED_POST);
    queryClient.setQueryData(postKeys.detail(DEMO_MASONRY_POST_ID), DEMO_MASONRY_POST);
    queryClient.setQueryData([...commentKeys.byPost(DEMO_FEED_POST_ID), 50], []);
    queryClient.setQueryData(
      [...commentKeys.byPost(DEMO_MASONRY_POST_ID), 50],
      [],
    );
    queryClient.setQueryData(eventKeys.detail(DEMO_EVENT_ID), DEMO_EVENT_DETAIL);
    queryClient.setQueryData(ticketKeys.myTicketForEvent(DEMO_TICKET_EVENT_ID), DEMO_TICKET);
    queryClient.setQueryData(ticketKeys.myTickets(), (current: TicketRecord[] | undefined) =>
      current && current.length > 0 ? current : [DEMO_TICKET],
    );
    queryClient.setQueryData(storyKeys.list(), DEMO_STORIES);
  }, [queryClient]);

  const feedPosts = useMemo(
    () => (feedPostsQuery.data && feedPostsQuery.data.length > 0
      ? feedPostsQuery.data
      : [DEMO_FEED_POST, DEMO_MASONRY_POST]),
    [feedPostsQuery.data],
  );

  const masonryPosts = useMemo(() => {
    const candidates =
      feedPosts.length >= 3
        ? feedPosts.slice(0, 3)
        : [DEMO_MASONRY_POST, DEMO_FEED_POST, DEMO_MASONRY_POST];

    return candidates.map((post, index) =>
      safeGridTile({
        ...post,
        id: String(post.id || `${DEMO_MASONRY_POST_ID}-${index}`),
      }),
    );
  }, [feedPosts]);

  const eventCard = eventsQuery.data?.[0] ?? DEMO_EVENT_CARD;
  const ticketCard = ticketsQuery.data?.[0] ?? DEMO_TICKET;
  const feedPost = feedPosts[0] ?? DEMO_FEED_POST;

  if (!__DEV__) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff" }}>Transition lab is dev-only.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 36 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 18,
            gap: 14,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                <ArrowLeft size={20} color="#fff" />
              </View>
            </Pressable>
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>
                Transition Lab
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                Production routes, deterministic sources
              </Text>
            </View>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(63,220,255,0.12)",
              }}
            >
              <Sparkles size={18} color="#3FDCFF" />
            </View>
          </View>

          {(feedPostsQuery.isLoading || eventsQuery.isLoading) && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderRadius: 16,
                backgroundColor: "rgba(255,255,255,0.04)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <ActivityIndicator color="#3FDCFF" />
              <Text style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>
                Warming live content for transition proof.
              </Text>
            </View>
          )}

          <SectionHeader
            title="Feed Post -> Detail"
            subtitle="Shared card, hero media, and avatar on the production feed post component."
          />
        </View>

        <FeedPost
          {...feedPost}
          author={feedPost.author}
          media={feedPost.media}
          likes={feedPost.likes}
          comments={feedPost.comments}
          timeAgo={feedPost.timeAgo}
        />

        <View style={{ paddingHorizontal: 16, gap: 16 }}>
          <SectionHeader
            title="Profile Masonry -> Viewer"
            subtitle="The real masonry grid component driving the same post detail route."
          />
          <ProfileMasonryGrid
            data={masonryPosts}
            userId={user?.id || "debug-user"}
            interactive
            scrollEnabled={false}
          />

          <SectionHeader
            title="Story Tray -> Viewer"
            subtitle="Shared ring-to-viewer transition with deterministic injected story data."
          />
          <StoriesBar stories={DEMO_STORIES} isLoadingOverride={false} />

          <SectionHeader
            title="Event Card -> Detail"
            subtitle="The production event card transitioning into the full event detail screen."
          />
          <FeedEventCard event={eventCard} />

          <SectionHeader
            title="Ticket Preview -> Detail"
            subtitle="Compact ticket preview transitioning into the luxury pass detail."
          />
          <TicketPreviewCard ticket={ticketCard} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
