import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useTabBarInset,
  useTabBarTopInset,
} from "@dvnt/app/lib/hooks/use-tab-bar-inset";
import { Main, LinearGradient } from "@dvnt/app/components/ui/html";
import {
  Heart,
  Plus,
  Ticket,
  Search,
  X,
  ArrowUpDown,
  CalendarOff,
  SearchX,
  SlidersHorizontal,
  PartyPopper,
  History,
  Map,
  Zap,
} from "lucide-react-native";
import { EmptyState } from "@dvnt/app/components/ui/empty-state";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useIsLargeScreen } from "@dvnt/app/lib/hooks/use-is-large-screen";

import { Motion } from "@legendapp/motion";
import Animated from "react-native-reanimated";
import { useRef, useCallback, useMemo } from "react";
import { Debouncer } from "@tanstack/react-pacer";
import { EventCardSkeleton } from "@dvnt/app/components/skeletons";
import { PagerViewWrapper } from "@dvnt/app/components/ui/pager-view";
import {
  useEvents,
  useForYouEvents,
  useToggleEventLike,
  eventKeys,
  type Event,
  type EventFilters,
} from "@dvnt/app/lib/hooks/use-events";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useScreenTrace } from "@dvnt/app/lib/perf/screen-trace";
import { useBootstrapEvents } from "@dvnt/app/lib/hooks/use-bootstrap-events";
import { useDeviceLocation } from "@dvnt/app/lib/hooks/use-device-location";
import { useEventsScreenStore } from "@dvnt/app/lib/stores/events-screen-store";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { EventCollectionRow } from "@dvnt/app/features/events";
import { EventsMapSheet } from "@dvnt/app/features/events";
import { EventFilterSheet } from "@dvnt/app/features/events";
import { SpotlightSection } from "@dvnt/app/features/events";
import { PromoteEventSheet } from "@dvnt/app/features/events";
import {
  useSpotlightFeed,
  usePromotedEventIds,
} from "@dvnt/app/lib/hooks/use-promotions";
import { useResponsiveGrid } from "@dvnt/app/lib/hooks/use-responsive-grid";
import { ZoomCard } from "@dvnt/app/components/ui/zoom-card";
import { CONTENT_MAX_WIDTH } from "@dvnt/app/components/layout/screen-shell";
import { EVENT_CARD_ASPECT } from "@dvnt/app/components/event/feed-event-card-shape";

function EventCard({
  event,
  index,
  colors,
  router,
  formatLikes,
  cardWidth,
  cardHeight,
  compact,
  queryClient,
}: {
  event: Event;
  index: number;
  colors: any;
  router: any;
  formatLikes: (likes: number) => string;
  cardWidth: number;
  cardHeight: number;
  compact?: boolean;
  queryClient: any;
}) {
  const toggleLike = useToggleEventLike();

  const handleLike = useCallback(() => {
    toggleLike.mutate({ eventId: event.id, isLiked: event.isLiked ?? false });
  }, [event.id, event.isLiked, toggleLike]);

  return (
    <Motion.View
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        damping: 20,
        stiffness: 300,
        delay: index * 0.15,
      }}
      className="w-full self-center"
    >
      {/* Plain View, not Motion.View. Its only animation prop was the
          press-scale, and the App Store zoom needs that gone (a shrink fights
          the zoom for the same frames). A Motion.View left with a `transition`
          but nothing to animate cannot build a stable dependency array, which
          threw "the final argument passed to useMemo changed size between
          renders" on every card. Shadow stays here; the clip is on the child. */}
      <View
        className="rounded-3xl overflow-hidden mb-5"
        style={{
          shadowColor: "#fff",
          shadowOpacity: 0.2,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 0 },
          elevation: 2,
        }}
      >
        {/* Wrap card content so the like button can be a sibling of the
            navigation Pressable — prevents touch conflicts on Android/iOS. */}
        <View style={{ height: cardHeight }}>
          {/* ZoomCard, not a bare Pressable: the feed and the profile grid open
              an event with the App Store card zoom, and this one pushed a flat
              stack instead — same card, same destination, two different
              transitions depending on which tab you tapped it from.
              `router.push` gets no zoom at all; the router threads it through
              the href, which is why this has to be a Link. */}
          <ZoomCard
            href={`/(protected)/events/${event.id}` as never}
            onPress={() => {
              queryClient.prefetchQuery({
                queryKey: eventKeys.detail(event.id),
                queryFn: () => eventsApi.getEventById(event.id),
                staleTime: 5 * 60 * 1000,
              });
            }}
          >
            <View style={{ height: cardHeight }} className="w-full">
              {/* Parallax image layer — branded gradient fallback when
                  the host hasn't uploaded a cover yet, so the card
                  still feels like an event tile instead of a dark void. */}
              <Animated.View
                style={{
                  width: "100%",
                  height: cardHeight + 100,
                  position: "absolute",
                  top: -50,
                }}
              >
                {/* Prefer the video flyer when the host uploaded one — it's
                    the asset they made for this event. Falls back to the
                    cover image, then to a brand gradient placeholder. */}
                {event.flyerVideoUrl ? (
                  <DVNTAnimatedVideoView
                    uri={event.flyerVideoUrl}
                    width="100%"
                    height="100%"
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                    muted
                  />
                ) : event.image ? (
                  <Image
                    source={{ uri: event.image }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <LinearGradient
                    colors={[
                      "rgba(138,64,207,0.55)",
                      "rgba(63,220,255,0.25)",
                      "rgba(0,0,0,0.0)",
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: "100%", height: "100%" }}
                  />
                )}
              </Animated.View>
              <LinearGradient
                colors={["transparent", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.8)"]}
                className="absolute inset-0"
              />

              {/* Date Badge */}
            <Motion.View
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", delay: index * 0.1 }}
              className="absolute top-4 right-4 bg-background rounded-2xl px-4 py-3 items-center min-w-[70px]"
            >
              <Text className="text-2xl font-bold text-foreground">
                {event.date}
              </Text>
              <Text className="text-[10px] text-muted-foreground uppercase mt-0.5">
                {event.month}
              </Text>
            </Motion.View>

            {/* Event Details */}
            <Animated.View
              className="absolute bottom-0 left-0 right-0"
              style={{ padding: compact ? 16 : 24 }}
            >
              <View className="flex-row items-center gap-1.5 mb-2">
                {(event as any).status === "cancelled" ? (
                  <View
                    className="px-3 py-1.5 rounded-xl"
                    style={{ backgroundColor: "rgba(239,68,68,0.9)" }}
                  >
                    <Text className="text-white text-xs font-bold uppercase tracking-wider">
                      Cancelled
                    </Text>
                  </View>
                ) : event.category ? (
                  <View className="bg-white/20 px-3 py-1.5 rounded-xl">
                    <Text className="text-white text-xs font-medium">
                      {event.category}
                    </Text>
                  </View>
                ) : null}
                {event.isPromoted && (event as any).status !== "cancelled" && (
                  <View className="bg-amber-500/90 px-2.5 py-1.5 rounded-xl flex-row items-center gap-1">
                    <Zap size={10} color="#fff" fill="#fff" />
                    <Text className="text-white text-[10px] font-bold uppercase tracking-wider">
                      Promoted
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className={`text-white font-bold ${compact ? "text-lg mb-1" : "text-[28px] mb-2"}`}
                numberOfLines={compact ? 1 : 2}
              >
                {event.title}
              </Text>
              <Text
                className={`text-white/80 ${compact ? "text-xs mb-2" : "text-sm mb-4"}`}
              >
                {event.time} •{" "}
                {(() => {
                  const count = Array.isArray(event.attendees)
                    ? event.attendees.length
                    : event.attendees || 0;
                  return `${count} participant${count === 1 ? "" : "s"}`;
                })()}
              </Text>

              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center">
                  {Array.isArray(event.attendees) ? (
                    event.attendees
                      .slice(0, 3)
                      .map((attendee: any, idx: number) => (
                        <View
                          key={idx}
                          className="border-2 border-background overflow-hidden"
                          style={{
                            marginLeft: idx === 0 ? 0 : -10,
                            borderRadius: 8,
                          }}
                        >
                          <Avatar
                            uri={attendee.image}
                            username={attendee.initials || "??"}
                            size={compact ? 24 : 32}
                            variant="roundedSquare"
                          />
                        </View>
                      ))
                  ) : (
                    <View className="bg-white/20 px-3 py-1.5 rounded-xl">
                      <Text className="text-white text-xs font-medium">
                        {typeof event.attendees === "number"
                          ? event.attendees
                          : 0}{" "}
                        attending
                      </Text>
                    </View>
                  )}
                  {(event.totalAttendees ?? 0) > 3 &&
                    Array.isArray(event.attendees) && (
                      <View className="ml-2 bg-white/20 px-2 py-1 rounded-xl">
                        <Text className="text-white text-xs font-medium">
                          +{(event.totalAttendees ?? 0) - 3}
                        </Text>
                      </View>
                    )}
                </View>
                <View className="bg-primary px-5 py-2 rounded-full">
                  <Text className="text-white text-base font-bold">
                    {event.price === 0 ? "FREE" : `$${event.price}`}
                  </Text>
                </View>
              </View>
            </Animated.View>
            </View>
          </ZoomCard>

          {/* Like Button — outside navigation Pressable to avoid touch conflicts */}
          <View
            pointerEvents="box-none"
            style={{ position: "absolute", top: 16, left: 16 }}
          >
            <Pressable
              onPress={handleLike}
              hitSlop={8}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: "rgba(0,0,0,0.4)",
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 12,
              }}
            >
              <Heart
                size={16}
                color={event.isLiked ? "#FF5BFC" : "#fff"}
                fill={event.isLiked ? "#FF5BFC" : "transparent"}
              />
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>
                {formatLikes(event.likes ?? 0)}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Motion.View>
  );
}

/** Smallest 4:5 flyer card that still shows its title and date. */
/**
 * Smallest event card worth showing — set so the grid resolves to ONE column
 * inside the max-w-3xl content column, i.e. cards at the full 768pt width.
 *
 * At 240 the same column fitted two ~362pt cards, which made a tablet card
 * NARROWER than the ~378pt one a phone shows: the tablet was getting more
 * cards rather than bigger ones, and an event flyer is the content here. This
 * matches the feed's event card, which is also capped to the content column.
 */
const MIN_CARD_WIDTH = 400;

function EventsScreenContent() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  // iPad puts the tab bar at the TOP, over the content.
  const tabBarTopInset = useTabBarTopInset();
  const queryClient = useQueryClient();
  const pagerRef = useRef<any>(null);
  const trace = useScreenTrace("Events");
  useBootstrapEvents();

  // Responsive grid — columns follow the available width
  const { width: screenWidth } = useWindowDimensions();
  const isLargeScreen = useIsLargeScreen();
  // Columns follow the REAL width, and the grid is no longer capped at 768.
  //
  // `Math.min(screenWidth, 768)` meant a bigger iPad got more empty space
  // rather than more content — the definition of not responsive. A 1024pt iPad
  // laid out exactly like a 768pt one and parked the difference in the
  // gutters. Now the canvas grows and a third column appears when there is
  // genuinely room for one at a sane card width.
  // The grid lays out inside the centred max-w-3xl column, NOT the window. Left
  // on the window width it sized every card for a 1024pt iPad while the box
  // holding them was 768 — cards wider than their container, which is why they
  // stopped looking like the full-width cards they are on a phone.
  const contentWidth = Math.min(screenWidth, CONTENT_MAX_WIDTH);
  const { columns: numColumns, cellWidth } = useResponsiveGrid({
    minCellWidth: MIN_CARD_WIDTH,
    gap: 12,
    horizontalPadding: 32,
    containerWidth: contentWidth,
  });
  const gridGap = numColumns > 1 ? 12 : 0;
  const cardWidth = numColumns > 1 ? cellWidth : contentWidth - 12;
  // Height follows the width through EVENT_CARD_ASPECT (6:5), so it stays
  // responsive at every column width. The flyer is authored 3:5 portrait and
  // renders `resizeMode="cover"`, so the card always crops it — the question is
  // only how much. 4:5 was right at a phone's ~378pt but made the full 768pt
  // card 960pt tall, taller than the screen it sits on.
  const cardHeight = Math.round(cardWidth / EVENT_CARD_ASPECT);

  // Zustand store — replaces all useState
  const activeTab = useEventsScreenStore((s) => s.activeTab);
  const setActiveTab = useEventsScreenStore((s) => s.setActiveTab);
  const activeFilters = useEventsScreenStore((s) => s.activeFilters);
  const toggleFilter = useEventsScreenStore((s) => s.toggleFilter);
  const activeSort = useEventsScreenStore((s) => s.activeSort);
  const cycleSort = useEventsScreenStore((s) => s.cycleSort);
  const searchQuery = useEventsScreenStore((s) => s.searchQuery);
  const setSearchQuery = useEventsScreenStore((s) => s.setSearchQuery);
  const debouncedSearch = useEventsScreenStore((s) => s.debouncedSearch);
  const setDebouncedSearch = useEventsScreenStore((s) => s.setDebouncedSearch);
  const showMapView = useEventsScreenStore((s) => s.showMapView);
  const toggleMapView = useEventsScreenStore((s) => s.toggleMapView);
  const setShowMapView = useEventsScreenStore((s) => s.setShowMapView);
  const filterSheetVisible = useEventsScreenStore((s) => s.filterSheetVisible);
  const setFilterSheetVisible = useEventsScreenStore(
    (s) => s.setFilterSheetVisible,
  );
  const activeFilterCount = useEventsScreenStore((s) => s.activeFilterCount);
  const activeCategories = useEventsScreenStore((s) => s.activeCategories);
  const nsfwFilter = useEventsScreenStore((s) => s.nsfwFilter);
  const setNsfwFilter = useEventsScreenStore((s) => s.setNsfwFilter);

  // TanStack Debouncer for search — 400ms delay prevents query-per-keystroke
  const searchDebouncerRef = useRef(
    new Debouncer(
      (q: string) => {
        setDebouncedSearch(q.trim());
      },
      { wait: 400 },
    ),
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      searchDebouncerRef.current.maybeExecute(text);
    },
    [setSearchQuery],
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearch("");
    searchDebouncerRef.current.cancel();
  }, [setSearchQuery, setDebouncedSearch]);

  // Device GPS coords — source of truth for "Near Me" filter
  const { deviceLat, deviceLng } = useDeviceLocation();
  const activeCity = useEventsLocationStore((s) => s.activeCity);

  // Build server-side filters from active pills + debounced search + categories
  const eventFilters = useMemo<EventFilters>(() => {
    const f: EventFilters = {};
    if (activeFilters.includes("online")) f.online = true;
    if (activeFilters.includes("tonight")) f.tonight = true;
    if (activeFilters.includes("this_weekend")) f.weekend = true;
    if (activeFilters.includes("in_city") && deviceLat != null && deviceLng != null) {
      f.cityLat = deviceLat;
      f.cityLng = deviceLng;
      // Pass city name so events without coords can be name-matched instead of passing blindly
      if (activeCity?.name) f.cityName = activeCity.name;
    }
    if (debouncedSearch.length >= 2) f.search = debouncedSearch;
    if (activeSort !== "soonest") f.sort = activeSort;
    if (activeCategories.length > 0) f.categories = activeCategories;
    if (nsfwFilter === true) f.nsfw = true;
    return f;
  }, [
    activeFilters,
    debouncedSearch,
    activeSort,
    activeCategories,
    nsfwFilter,
    deviceLat,
    deviceLng,
    activeCity,
  ]);

  // Live updates for event cards are now mounted at the protected
  // layout level (`app/(protected)/_layout.tsx`) so a single subscription
  // serves every screen.

  // Fetch events via single batch RPC with server-side filters
  const { data: events = [], isLoading, error } = useEvents(eventFilters);

  // "For You" personalized feed (separate query, 15min cache)
  const { data: forYouEvents = [], isLoading: forYouLoading } =
    useForYouEvents();

  // Spotlight + promoted event IDs
  const { data: spotlightItems = [] } = useSpotlightFeed();
  const { data: promotedIds } = usePromotedEventIds();

  // Merge is_promoted flag into events (de-dupe: skip spotlight IDs in first 6 items)
  const spotlightEventIds = useMemo(
    () => new Set(spotlightItems.map((s) => String(s.event_id))),
    [spotlightItems],
  );

  const eventsWithPromotion = useMemo(() => {
    let spotlightSkipCount = 0;
    return events
      .map((ev: Event, idx: number) => {
        const numericId = parseInt(ev.id);
        const isPromoted = promotedIds?.has(numericId) ?? false;
        const inSpotlight = spotlightEventIds.has(ev.id);
        // De-dupe: if event is in spotlight, skip it in first 6 regular items
        if (inSpotlight && spotlightSkipCount < 6 && idx < 6) {
          spotlightSkipCount++;
          return { ...ev, isPromoted, _deduped: true };
        }
        return { ...ev, isPromoted };
      })
      .filter((ev: any) => !ev._deduped);
  }, [events, promotedIds, spotlightEventIds]);

  const formatLikes = (likes: number) => {
    if (likes >= 1000) {
      return `${(likes / 1000).toFixed(1)}k`;
    }
    return likes.toString();
  };


  // Check if any server-side filter or search is active
  const hasActiveFilters =
    activeFilters.length > 0 ||
    activeCategories.length > 0 ||
    activeSort !== "soonest" ||
    debouncedSearch.length >= 2 ||
    nsfwFilter === true;

  // Filter events by tab — server handles pill filters
  // Tab indices: 0=Upcoming, 1=For You, 2=All Events, 3=Past Events
  // Uses eventsWithPromotion (has is_promoted flag + de-duped) for
  // Upcoming/All/Past. For You uses the personalized feed unless
  // filters/search are active, in which case we fall back to filtered
  // "All Events" so pills + sort + search always apply.
  const getFilteredEvents = useCallback(
    (tabIndex: number) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      switch (tabIndex) {
        case 0: // Upcoming — default landing tab
          return eventsWithPromotion.filter(
            (event: Event) =>
              event.fullDate && new Date(event.fullDate) >= today,
          );
        case 1: // For You — use filtered results when any filter/search is active
          return hasActiveFilters ? eventsWithPromotion : forYouEvents;
        case 3: // past_events
          return eventsWithPromotion.filter(
            (event: Event) =>
              event.fullDate && new Date(event.fullDate) < today,
          );
        default: // All Events (2)
          return eventsWithPromotion;
      }
    },
    [eventsWithPromotion, forYouEvents, hasActiveFilters],
  );

  const handleTabPress = useCallback(
    (index: number) => {
      setActiveTab(index);
      pagerRef.current?.setPage(index);
    },
    [setActiveTab],
  );

  const handlePageSelected = useCallback(
    (e: any) => {
      setActiveTab(e.nativeEvent.position);
    },
    [setActiveTab],
  );

  const tabs = [
    { key: "upcoming", label: "Upcoming" },
    { key: "for_you", label: "For You" },
    { key: "all_events", label: "All Events" },
    { key: "past_events", label: "Past Events" },
  ];

  // Compute curated collections from existing events
  const collections = useMemo(() => {
    if (events.length === 0) return { weekend: [], trending: [], fresh: [] };
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const satStart = new Date(now);
    satStart.setDate(now.getDate() + ((6 - dayOfWeek + 7) % 7));
    satStart.setHours(0, 0, 0, 0);
    const sunEnd = new Date(satStart);
    sunEnd.setDate(satStart.getDate() + 1);
    sunEnd.setHours(23, 59, 59, 999);

    const weekend = events.filter((e: Event) => {
      if (!e.fullDate) return false;
      const d = new Date(e.fullDate);
      return d >= satStart && d <= sunEnd;
    });

    const trending = [...events]
      .sort(
        (a: Event, b: Event) =>
          (b.totalAttendees ?? 0) - (a.totalAttendees ?? 0),
      )
      .slice(0, 6);

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fresh = events
      .filter((e: Event) => {
        if (!e.fullDate) return false;
        return new Date(e.fullDate) >= now;
      })
      .slice(0, 6);

    return { weekend, trending, fresh };
  }, [events]);

  const showCollections =
    debouncedSearch.length < 2 && activeFilters.length === 0 && !nsfwFilter;

  // Whether events are still loading (show inline skeletons, never block layout)
  const showEventSkeletons = isLoading && events.length === 0;

  return (
    // FULL WIDTH, not SCREEN_SHELL. The cap and this screen's own grid were
    // fighting: `useResponsiveGrid` above is explicitly built to let a third
    // column appear "when there is genuinely room for one", but max-w-4xl
    // (896pt) meant a 1024pt iPad could never offer that room — it parked the
    // difference in gutters, which is the empty band either side reported from
    // the iPad. The header was inside the cap too, so it stopped short of the
    // screen edges while the tab header above it ran full width.
    <View
      className="flex-1 bg-background w-full"
      // Top clearance goes on the SCREEN, not the lists: this screen has no
      // `contentInsetAdjustmentBehavior="automatic"` (unlike profile/activity,
      // where iOS inserts it and ours doubled it), and the header sits above
      // the lists — padding a list left the header itself under the tab bar.
      style={{ paddingTop: tabBarTopInset }}
    >
      <Main className="flex-1">
        {/* Everything on this screen reads in one centred column — the date and
            title row included. Capping from the search bar down left the title
            and its map/tickets/spicy actions stretched to the tablet's full
            width while the search field beneath them stopped short, so the two
            rows disagreed about where the screen's edge was. */}
        <View className="flex-1 w-full max-w-3xl self-center">
        {/* Header — date+title left, actions right */}
        <View className="px-4 pt-2 pb-1">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </Text>
              <Text className="text-2xl font-bold text-foreground mt-0.5">
                Events
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              {/* Map button — left of Tickets. Opens a detached Gorhom
                  BottomSheetModal instead of swapping the whole screen. */}
              <Motion.Pressable
                onPress={toggleMapView}
                accessibilityLabel="Open events map"
              >
                <Motion.View
                  whileTap={{ scale: 0.9 }}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-card border border-border"
                  style={
                    showMapView
                      ? {
                          backgroundColor: colors.primary,
                          borderColor: colors.primary,
                        }
                      : undefined
                  }
                >
                  <Map
                    size={18}
                    color={showMapView ? "#fff" : colors.foreground}
                  />
                </Motion.View>
              </Motion.Pressable>
              <Motion.Pressable
                onPress={() =>
                  router.push("/(protected)/events/my-tickets" as any)
                }
              >
                <Motion.View
                  whileTap={{ scale: 0.9 }}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-card border border-border"
                >
                  <Ticket size={18} color={colors.foreground} />
                </Motion.View>
              </Motion.Pressable>
              {/* Spicy toggle button */}
              <Motion.Pressable
                onPress={() => setNsfwFilter(nsfwFilter === true ? false : true)}
                accessibilityLabel="Toggle spicy events"
              >
                <Motion.View
                  whileTap={{ scale: 0.9 }}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-card border border-border"
                  style={
                    nsfwFilter === true
                      ? { backgroundColor: "rgba(153,27,27,0.3)", borderColor: "rgba(153,27,27,0.6)" }
                      : undefined
                  }
                >
                  <Text style={{ fontSize: 18 }}>{nsfwFilter === true ? "😈" : "😇"}</Text>
                </Motion.View>
              </Motion.Pressable>
            </View>
          </View>
        </View>

        {/* Search Bar with inline filter button */}
        <View className="px-4 pb-2">
          <View className="flex-row items-center bg-card border border-border rounded-2xl px-4 py-2.5">
            <Search size={18} color={colors.mutedForeground} strokeWidth={2} />
            <TextInput
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="Search events, venues, hosts..."
              placeholderTextColor={colors.mutedForeground}
              className="flex-1 ml-3 text-sm text-foreground py-1"
              style={{ lineHeight: 20 }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={handleClearSearch}
                hitSlop={8}
                className="mr-2"
              >
                <X size={16} color={colors.mutedForeground} />
              </Pressable>
            )}
            {/* Filter button */}
            <Pressable
              onPress={() => setFilterSheetVisible(true)}
              hitSlop={8}
              className="relative"
            >
              <SlidersHorizontal
                size={18}
                color={
                  activeFilterCount() > 0
                    ? colors.primary
                    : colors.mutedForeground
                }
                strokeWidth={2}
              />
              {activeFilterCount() > 0 && (
                <View
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full items-center justify-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-[9px] font-bold text-white">
                    {activeFilterCount()}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        {/* Active filter chips — show inline when filters are active */}
        {(activeFilters.length > 0 ||
          activeCategories.length > 0 ||
          activeSort !== "soonest" ||
          nsfwFilter === true) && (
          <View className="px-4 pb-1">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {activeFilters.map((f) => {
                const chipLabel =
                  f === "in_city"
                    ? "Near Me"
                    : f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <Pressable
                    key={f}
                    onPress={() => toggleFilter(f)}
                    className="flex-row items-center gap-1 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30"
                  >
                    <Text className="text-xs font-semibold text-primary">
                      {chipLabel}
                    </Text>
                    <X size={12} color={colors.primary} strokeWidth={2} />
                  </Pressable>
                );
              })}
              {activeSort !== "soonest" && (
                <View className="flex-row items-center gap-1 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30">
                  <ArrowUpDown
                    size={11}
                    color={colors.primary}
                    strokeWidth={2}
                  />
                  <Text className="text-xs font-semibold text-primary">
                    {
                      {
                        soonest: "Soonest",
                        newest: "Newest",
                        popular: "Popular",
                        price_low: "Price ↑",
                        price_high: "Price ↓",
                      }[activeSort]
                    }
                  </Text>
                </View>
              )}
              {activeCategories.map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() =>
                    useEventsScreenStore.getState().toggleCategory(cat)
                  }
                  className="flex-row items-center gap-1 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30"
                >
                  <Text className="text-xs font-semibold text-primary">
                    {cat
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Text>
                  <X size={12} color={colors.primary} strokeWidth={2} />
                </Pressable>
              ))}
              {nsfwFilter === true && (
                <Pressable
                  onPress={() => setNsfwFilter(null)}
                  className="flex-row items-center gap-1 px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: "rgba(153,27,27,0.15)", borderWidth: 1, borderColor: "rgba(153,27,27,0.4)" }}
                >
                  <Text className="text-xs font-semibold" style={{ color: "#f87171" }}>😈 Spicy</Text>
                  <X size={12} color="#f87171" strokeWidth={2} />
                </Pressable>
              )}
            </ScrollView>
          </View>
        )}

        {/* P0-2: Events list is ALWAYS rendered. The map is presented as a
            detached BottomSheetModal overlay (see EventsMapSheet below),
            not a full-screen swap — so filters, search, and tabs remain
            reachable while the map is open. */}
        {
          <>
            {/* Tab Navigation */}
            <View className="flex-row border-b border-border">
              {tabs.map((tab, index) => (
                <Pressable
                  key={tab.key}
                  onPress={() => handleTabPress(index)}
                  className={`flex-1 py-3 ${activeTab === index ? "border-b-2 border-primary" : ""}`}
                >
                  <Text
                    className={`text-center font-medium ${activeTab === index ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Swipeable Pages */}
            <PagerViewWrapper
              pagerRef={pagerRef}
              style={{ flex: 1 }}
              initialPage={activeTab}
              onPageSelected={handlePageSelected}
            >
              {tabs.map((tab, tabIndex) => {
                const filteredEvents = getFilteredEvents(tabIndex);
                return (
                  <View key={tab.key} className="flex-1">
                    {filteredEvents.length === 0 ? (
                      debouncedSearch.length >= 2 ? (
                        <EmptyState
                          icon={SearchX}
                          title="No matches"
                          accent="#f97316"
                          description={`Nothing matched "${debouncedSearch}". Try a different keyword or check spelling.`}
                          action={
                            <Pressable
                              onPress={handleClearSearch}
                              className="bg-primary px-6 py-3 rounded-full"
                            >
                              <Text className="text-primary-foreground font-semibold text-sm">
                                Clear Search
                              </Text>
                            </Pressable>
                          }
                        />
                      ) : activeFilters.length > 0 ? (
                        <EmptyState
                          icon={SlidersHorizontal}
                          title="Too filtered"
                          accent="#8b5cf6"
                          description="No events match your current filters. Try removing some to see more."
                          action={
                            <Pressable
                              onPress={() => {
                                activeFilters.forEach((f) => toggleFilter(f));
                              }}
                              className="bg-primary px-6 py-3 rounded-full"
                            >
                              <Text className="text-primary-foreground font-semibold text-sm">
                                Clear Filters
                              </Text>
                            </Pressable>
                          }
                        />
                      ) : tabIndex === 3 ? (
                        <EmptyState
                          icon={History}
                          title="No past events"
                          accent="#6b7280"
                          description="Events you've attended will appear here after they end."
                        />
                      ) : tabIndex === 2 ? (
                        <EmptyState
                          icon={PartyPopper}
                          title="Nothing upcoming"
                          accent="#FF5BFC"
                          description="Be the first to create an event in your area!"
                          action={
                            <Pressable
                              onPress={() =>
                                router.push("/(protected)/events/create" as any)
                              }
                              className="bg-primary px-6 py-3 rounded-full flex-row items-center gap-2"
                            >
                              <Plus size={16} color="#fff" />
                              <Text className="text-primary-foreground font-semibold text-sm">
                                Create Event
                              </Text>
                            </Pressable>
                          }
                        />
                      ) : tabIndex === 0 ? (
                        <EmptyState
                          icon={Heart}
                          title="Your feed is building"
                          accent="#8A40CF"
                          description="Like and RSVP to events to train your personalized feed."
                          action={
                            <Pressable
                              onPress={() => handleTabPress(1)}
                              className="bg-primary px-6 py-3 rounded-full"
                            >
                              <Text className="text-primary-foreground font-semibold text-sm">
                                Browse All Events
                              </Text>
                            </Pressable>
                          }
                        />
                      ) : (
                        <EmptyState
                          icon={CalendarOff}
                          title="No events yet"
                          accent="#3FDCFF"
                          description="Check back later or create one to get the party started!"
                          action={
                            <Pressable
                              onPress={() =>
                                router.push("/(protected)/events/create" as any)
                              }
                              className="bg-primary px-6 py-3 rounded-full flex-row items-center gap-2"
                            >
                              <Plus size={16} color="#fff" />
                              <Text className="text-primary-foreground font-semibold text-sm">
                                Create Event
                              </Text>
                            </Pressable>
                          }
                        />
                      )
                    ) : showEventSkeletons ? (
                      <ScrollView
                        className="flex-1"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{
                          paddingBottom: tabBarInset,
                        }}
                      >
                        {tabIndex === 1 &&
                          spotlightItems.length > 0 &&
                          !showMapView &&
                          !nsfwFilter && (
                            <SpotlightSection items={spotlightItems} />
                          )}
                        <View
                          style={{
                            paddingHorizontal: 16,
                            paddingTop: 16,
                          }}
                        >
                          <EventCardSkeleton />
                          <EventCardSkeleton />
                        </View>
                      </ScrollView>
                    ) : (
                      <Animated.ScrollView
                        className="flex-1"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{
                          paddingBottom: tabBarInset,
                        }}
                      >
                        {tabIndex === 1 &&
                          spotlightItems.length > 0 &&
                          !showMapView &&
                          !nsfwFilter && (
                            <SpotlightSection items={spotlightItems} />
                          )}
                        <View
                          style={{
                            paddingTop: 16,
                          }}
                        >
                          {/* Curated collections — only on All Events tab, no search/filters */}
                          {tabIndex === 1 && showCollections && (
                            <View>
                              <EventCollectionRow
                                title="This Weekend"
                                emoji="\uD83C\uDF89"
                                events={collections.weekend}
                              />
                              <EventCollectionRow
                                title="Trending"
                                emoji="\uD83D\uDD25"
                                events={collections.trending}
                              />
                              <EventCollectionRow
                                title="New & Notable"
                                emoji="\u2728"
                                events={collections.fresh}
                              />
                            </View>
                          )}
                          <View
                            style={{
                              paddingHorizontal: 16,
                              // Driven by the computed column count, not by
                              // `isLargeScreen`: those disagreed between 700 and
                              // 768pt, where cards were sized for a grid the
                              // container still stacked.
                              flexDirection: numColumns > 1 ? "row" : "column",
                              flexWrap: numColumns > 1 ? "wrap" : "nowrap",
                              gap: gridGap,
                            }}
                          >
                            {filteredEvents.map((event, index) => (
                              <View
                                key={event.id}
                                style={
                                  numColumns > 1
                                    ? { width: cardWidth }
                                    : undefined
                                }
                              >
                                <EventCard
                                  event={event}
                                  index={index}
                                  colors={colors}
                                  router={router}
                                  formatLikes={formatLikes}
                                  cardWidth={cardWidth}
                                  cardHeight={cardHeight}
                                  compact={isLargeScreen}
                                  queryClient={queryClient}
                                />
                              </View>
                            ))}
                          </View>
                        </View>
                      </Animated.ScrollView>
                    )}
                  </View>
                );
              })}
            </PagerViewWrapper>
          </>
        }
        </View>
        {/* /centred content column */}
      </Main>

      {/* Event Filter Sheet */}
      <EventFilterSheet
        visible={filterSheetVisible}
        onDismiss={() => setFilterSheetVisible(false)}
      />

      {showMapView && (
        <EventsMapSheet
          onDismiss={() => setShowMapView(false)}
          events={eventsWithPromotion}
        />
      )}
    </View>
  );
}

export default function EventsScreen() {
  return (
    <ErrorBoundary screenName="Events">
      <EventsScreenContent />
    </ErrorBoundary>
  );
}
