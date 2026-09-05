import { View, Text, Pressable, ScrollView } from "react-native";
import { Section } from "@dvnt/app/components/ui/html";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { feedScrollY } from "@dvnt/app/lib/stores/feed-scroll-shared";

/** Row height. The collapse interpolates over exactly this much scroll. */
const STORIES_HEIGHT = 154;
import { Plus } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { prefetchImagesRN } from "@dvnt/app/lib/perf/image-prefetch";
import { StoriesBarSkeleton } from "@dvnt/app/components/skeletons";
import { StoryRing } from "./story-ring";
import { useStories } from "@dvnt/app/lib/hooks/use-stories";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { assertAvatarSource } from "@dvnt/app/lib/invariants/assertAvatarOwnership";
import type { Story } from "@dvnt/app/lib/types";

type StoriesBarProps = {
  stories?: Story[];
  isLoadingOverride?: boolean;
};

function StoriesBarContent({
  stories,
  isPending,
}: {
  stories: Story[];
  isPending: boolean;
}) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const handleCreateStory = useCallback(() => {
    router.push("/(protected)/story/create");
  }, [router]);

  // CRITICAL: Find user's own story by userId (author ID), NOT story ID
  // Also filter to only include stories with valid items
  const myStory = useMemo(() => {
    if (!user) return null;
    const userStories = stories.filter(
      (story) =>
        String(story.userId) === String(user.id) &&
        story.items &&
        story.items.length > 0,
    );
    return userStories[0] || null;
  }, [stories, user]);

  const hasMyStory = !!myStory;

  // CRITICAL: Filter out user's own stories from "Other Stories" list
  // Also deduplicate by story ID and group by author
  const otherStories = useMemo(() => {
    if (!user) return stories;

    const filtered = stories.filter(
      (story) =>
        String(story.userId) !== String(user.id) &&
        story.items &&
        story.items.length > 0,
    );

    const seen = new Set<string>();
    const deduped = filtered.filter((story) => {
      if (seen.has(story.id)) return false;
      seen.add(story.id);
      return true;
    });

    const authorMap = new Map<string, (typeof stories)[0]>();
    for (const story of deduped) {
      const authorKey = story.userId || story.username;
      if (!authorMap.has(authorKey)) {
        authorMap.set(authorKey, story);
      }
    }

    return Array.from(authorMap.values());
  }, [stories, user]);

  // Prefetch thumbnail images for smooth circle rendering
  useEffect(() => {
    if (!otherStories.length) return;
    const urls: string[] = [];
    for (const story of otherStories) {
      const latestItem = story.items?.[story.items.length - 1];
      const thumb = latestItem?.thumbnail || latestItem?.url || story.avatar;
      if (thumb) urls.push(thumb);
    }
    if (urls.length) prefetchImagesRN(urls);
  }, [otherStories]);

  // Handle own story press — navigate to viewer route
  const handleMyStoryPress = useCallback(() => {
    if (myStory) {
      router.push({
        pathname: "/(protected)/story/[id]",
        params: {
          id: String(myStory.id),
          username: myStory.username || user?.username || "",
        },
      });
    }
  }, [myStory, router, user?.username]);

  // Collapse as the feed scrolls away, Instagram-style: the row gives its height
  // back to the feed instead of just fading, so nothing is left holding dead
  // space. Driven entirely on the UI thread from `feedScrollY` — no re-renders,
  // which matters because this row is a horizontally scrollable image strip.
  const collapseStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      feedScrollY.value,
      [0, STORIES_HEIGHT],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      height: STORIES_HEIGHT * (1 - progress),
      opacity: 1 - progress,
      // Pull it up as it shrinks so the content slides out rather than squashing.
      transform: [{ translateY: -STORIES_HEIGHT * progress * 0.35 }],
    };
  });

  if (isPending) {
    return <StoriesBarSkeleton />;
  }

  return (
    <Animated.View style={collapseStyle}>
    <Section className="border-b border-border">
      <View style={{ height: STORIES_HEIGHT, flexDirection: "row" }}>
        {/* Your Story */}
        <View style={{ paddingTop: 5, paddingLeft: 4, paddingRight: 10 }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            {hasMyStory && myStory ? (
              <View style={{ position: "relative" }}>
                {/* Tap story ring to view story — delayPressIn lets the + button win */}
                <Pressable
                  onPress={handleMyStoryPress}
                  unstable_pressDelay={200}
                >
                  {/* CRITICAL: Avatar MUST come from story.avatar (entity data), NOT user.avatar (authUser) */}
                  <StoryRing
                    src={myStory.avatar}
                    alt={myStory.username || "Your story"}
                    hasStory={true}
                    isViewed={myStory.isViewed}
                    isCloseFriends={myStory.hasCloseFriendsStory}
                    storyThumbnail={(() => {
                      const latest = myStory.items?.[myStory.items.length - 1];
                      return latest?.type === "video"
                        ? latest?.thumbnail || latest?.url
                        : latest?.url;
                    })()}
                  />
                </Pressable>
                {/* Add button overlay - instant response, larger hit area */}
                <Pressable
                  onPress={handleCreateStory}
                  unstable_pressDelay={0}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={{
                    position: "absolute",
                    bottom: -4,
                    right: -4,
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    backgroundColor: "#3EA4E5",
                    borderWidth: 2,
                    borderColor: "#000",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 10,
                  }}
                >
                  <Plus size={15} color="#0c0a09" strokeWidth={3} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={handleCreateStory}>
                <View className="relative">
                  <View
                    className="items-center justify-center rounded-xl border-2 border-border bg-card"
                    style={{ height: 104, width: 74 }}
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
                      <Plus size={24} color="#0c0a09" strokeWidth={3} />
                    </View>
                  </View>
                </View>
              </Pressable>
            )}
            <Text
              className="max-w-[64px] text-[9px] font-bold text-muted-foreground"
              numberOfLines={1}
            >
              Your Story
            </Text>
          </View>
        </View>

        {/* Other Stories — each circle navigates to expo-video-based viewer */}
        {otherStories.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingRight: 40, gap: 4 }}
          >
            {otherStories.map((story) => {
              // DEV INVARIANT: avatar must come from entity, not authUser
              if (__DEV__) {
                assertAvatarSource({
                  context: "story",
                  entityOwnerId: story.userId,
                  authUserId: user?.id,
                  avatarSource: "entity",
                });
              }

              const latestItem = story.items?.[story.items.length - 1];
              const storyThumb =
                latestItem?.type === "video"
                  ? latestItem?.thumbnail || latestItem?.url
                  : latestItem?.url || story.avatar || undefined;

              return (
                <View
                  key={story.id}
                  style={{ paddingTop: 5, paddingHorizontal: 3, alignItems: "center", gap: 6 }}
                >
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(protected)/story/[id]",
                        params: {
                          id: String(story.id),
                          username: story.username || "",
                        },
                      })
                    }
                  >
                    <StoryRing
                      src={story.avatar}
                      alt={story.username || "Story"}
                      hasStory={true}
                      isViewed={story.isViewed}
                      isCloseFriends={story.hasCloseFriendsStory}
                      storyThumbnail={storyThumb}
                    />
                  </Pressable>
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 10,
                      fontWeight: "600",
                      maxWidth: 64,
                    }}
                    numberOfLines={1}
                  >
                    {story.username || "Unknown"}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Section>
    </Animated.View>
  );
}

function StoriesBarWithQuery() {
  const storiesQuery = useStories();
  return (
    <StoriesBarContent
      stories={storiesQuery.data ?? []}
      isPending={storiesQuery.isPending}
    />
  );
}

export function StoriesBar({
  stories: injectedStories,
  isLoadingOverride,
}: StoriesBarProps) {
  if (
    Array.isArray(injectedStories) ||
    typeof isLoadingOverride === "boolean"
  ) {
    return (
      <StoriesBarContent
        stories={injectedStories ?? []}
        isPending={Boolean(isLoadingOverride)}
      />
    );
  }

  return <StoriesBarWithQuery />;
}
