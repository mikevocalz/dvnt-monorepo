import { View, Text, RefreshControl } from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { EventCard } from "@dvnt/app/components/event-card";
import { PublicBrowseBanner } from "@dvnt/app/components/access/PublicBrowseBanner";
import { EventCardSkeleton } from "@dvnt/app/components/skeletons";
import { useEvents } from "@dvnt/app/lib/hooks/use-events";
import { usePromotedEventIds } from "@dvnt/app/lib/hooks/use-promotions";
import { usePublicGateStore } from "@dvnt/app/lib/stores/public-gate-store";
import { useMemo } from "react";

function formatLikes(likes: number) {
  if (likes >= 1000) return `${(likes / 1000).toFixed(1)}k`;
  return String(likes);
}

export default function PublicEventsScreen() {
  const scrollY = useSharedValue(0);
  const openGate = usePublicGateStore((s) => s.openGate);
  const { data: events = [], isLoading, isRefetching, refetch, error } =
    useEvents({ sort: "soonest" });
  const { data: promotedIds } = usePromotedEventIds();

  // Tag promoted events + pin them to the top, preserving the backend's
  // chronological order for everyone else.
  const orderedEvents = useMemo(() => {
    if (!promotedIds || promotedIds.size === 0) return events;
    const promoted: any[] = [];
    const rest: any[] = [];
    for (const ev of events) {
      const isPromoted = promotedIds.has(parseInt(String(ev.id)));
      if (isPromoted) promoted.push({ ...ev, isPromoted: true });
      else rest.push(ev);
    }
    return [...promoted, ...rest];
  }, [events, promotedIds]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  if (isLoading && events.length === 0) {
    return (
      <View className="flex-1 bg-background px-4 pt-4">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-white text-base font-semibold">
          Failed to load events
        </Text>
        <Text className="text-white/60 text-sm text-center mt-2">
          Pull to refresh and try again.
        </Text>
      </View>
    );
  }

  return (
    <ErrorBoundary screenName="PublicEvents">
      <Animated.ScrollView
        className="flex-1 bg-background"
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor="#fff"
          />
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <PublicBrowseBanner variant="events" />
        {orderedEvents.slice(0, 12).map((event, index) => (
          <EventCard
            key={event.id}
            event={event}
            index={index}
            scrollY={scrollY}
            formatLikes={formatLikes}
            guestMode
            onRequireAuth={openGate}
          />
        ))}
      </Animated.ScrollView>
    </ErrorBoundary>
  );
}
