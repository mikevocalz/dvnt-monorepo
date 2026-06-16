/**
 * Location Discovery Screen
 * Shows posts at a specific location (Instagram-style location page)
 * Route: /(protected)/location/[placeId]
 */

import {
  View,
  Text,
  Pressable,
  Dimensions,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { navigateToPost } from "@dvnt/app/lib/routes/post-routes";
import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  MapPin,
  Navigation,
  Grid3X3,
  Bookmark,
} from "lucide-react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { DvntMap } from "@dvnt/app/src/components/map";
import { LegendList } from "@dvnt/app/components/list";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import type { NormalizedLocation } from "@dvnt/app/lib/types/location";
import type { Post } from "@dvnt/app/lib/types";
import {
  openDirections,
  openMapView,
  hasValidCoordinates,
  getStaticMapUrl,
} from "@dvnt/app/lib/utils/location";
import { searchApi } from "@dvnt/app/lib/api/search";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_COLS = 3;
const GRID_GAP = 2;
const GRID_CELL_SIZE = (SCREEN_WIDTH - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

// Location header with map preview
function LocationHeader({
  location,
  postCount,
}: {
  location: NormalizedLocation | null;
  postCount: number;
}) {
  const { colors } = useColorScheme();
  const router = useRouter();

  if (!location) return null;

  const hasCoords = hasValidCoordinates(location);

  return (
    <View className="relative">
      {/* Map Preview or Static Map Image */}
      {hasCoords ? (
        <View className="h-48 w-full">
          <DvntMap
            center={[location.longitude, location.latitude]}
            zoom={15}
            markers={[
              {
                id: "location",
                coordinate: [location.longitude, location.latitude],
                title: location.name,
              },
            ]}
            showControls={false}
          />
        </View>
      ) : (
        <View
          className="h-32 w-full items-center justify-center"
          style={{ backgroundColor: colors.muted + "30" }}
        >
          <MapPin size={40} color={colors.mutedForeground} />
        </View>
      )}

      {/* Location Info Overlay */}
      <View className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-8">
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.8)"]}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          }}
          pointerEvents="none"
        />
        <Text className="text-2xl font-bold text-white" numberOfLines={1}>
          {location.name}
        </Text>
        {location.city && (
          <Text className="text-sm text-white/80" numberOfLines={1}>
            {location.city}
            {location.country ? `, ${location.country}` : ""}
          </Text>
        )}
        <Text className="text-xs text-white/60 mt-1">
          {postCount} {postCount === 1 ? "post" : "posts"}
        </Text>
      </View>
    </View>
  );
}

// Post grid item
function PostGridItem({ post, onPress }: { post: Post; onPress: () => void }) {
  const imageUri = post.thumbnail || post.media?.[0]?.url;
  const isVideo = post.type === "video";

  return (
    <Pressable onPress={onPress}>
      <View
        style={{
          width: GRID_CELL_SIZE,
          height: GRID_CELL_SIZE,
          marginRight: GRID_GAP,
          marginBottom: GRID_GAP,
        }}
      >
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View
            className="w-full h-full items-center justify-center"
            style={{ backgroundColor: "#1a1a1a" }}
          >
            <MapPin size={24} color="#666" />
          </View>
        )}
        {isVideo && (
          <View className="absolute top-2 right-2">
            <View className="w-4 h-4 bg-black/60 rounded items-center justify-center">
              <View className="w-0 h-0 border-l-[6px] border-l-white border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent" />
            </View>
          </View>
        )}
        {post.hasMultipleImages && (
          <View className="absolute top-2 right-2 bg-black/50 rounded px-1 py-0.5">
            <Text className="text-[10px] text-white font-bold">+</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function normalizeLocationTerm(value?: string | string[] | null) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocationMatchTerms(parts: Array<string | string[] | null | undefined>) {
  const terms = new Set<string>();

  for (const part of parts) {
    const normalized = normalizeLocationTerm(part);
    if (!normalized) continue;

    terms.add(normalized);

    const firstSegment = normalized.split(",")[0]?.trim();
    if (firstSegment) {
      terms.add(firstSegment);
    }
  }

  return Array.from(terms).filter((term) => term.length >= 2);
}

function locationMatches(postLocation: string | undefined, terms: string[]) {
  if (!postLocation || terms.length === 0) return false;

  const normalizedLocation = normalizeLocationTerm(postLocation);
  if (!normalizedLocation) return false;

  const locationVariants = new Set<string>([normalizedLocation]);
  const firstSegment = normalizedLocation.split(",")[0]?.trim();
  if (firstSegment) {
    locationVariants.add(firstSegment);
  }

  return terms.some((term) =>
    Array.from(locationVariants).some(
      (candidate) => candidate.includes(term) || term.includes(candidate),
    ),
  );
}

function LocationScreenContent() {
  const { placeId, name, formattedAddress, latitude, longitude } =
    useLocalSearchParams<{
      placeId: string;
      name?: string;
      formattedAddress?: string;
      latitude?: string;
      longitude?: string;
    }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const queryClient = useQueryClient();

  const [location, setLocation] = useState<NormalizedLocation | null>(null);
  const routeLocationName = normalizeLocationTerm(name) || normalizeLocationTerm(placeId);
  const locationMatchTerms = getLocationMatchTerms([name, formattedAddress, placeId]);
  const locationSearchLabel =
    (Array.isArray(name) ? name[0] : name) ||
    (Array.isArray(formattedAddress) ? formattedAddress[0] : formattedAddress) ||
    (Array.isArray(placeId) ? placeId[0] : placeId) ||
    "";
  const parsedLatitude = latitude ? Number(latitude) : NaN;
  const parsedLongitude = longitude ? Number(longitude) : NaN;

  // Fetch posts at this location
  const {
    data: posts = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: [
      "posts",
      "by-location",
      placeId,
      normalizeLocationTerm(name),
      normalizeLocationTerm(formattedAddress),
    ],
    queryFn: async () => {
      const searchResults =
        await searchApi.searchPostsByLocation(locationSearchLabel);
      return searchResults.docs.filter((post) =>
        locationMatches(post.location, locationMatchTerms),
      );
    },
    enabled:
      locationMatchTerms.length > 0 && locationSearchLabel.trim().length >= 2,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  useEffect(() => {
    if (routeLocationName) {
      setLocation({
        placeId: placeId,
        provider: "google",
        name: Array.isArray(name) ? name[0] || routeLocationName : name || routeLocationName,
        formattedAddress:
          (Array.isArray(formattedAddress)
            ? formattedAddress[0]
            : formattedAddress) ||
          (Array.isArray(name) ? name[0] : name) ||
          routeLocationName,
        latitude: Number.isFinite(parsedLatitude) ? parsedLatitude : 0,
        longitude: Number.isFinite(parsedLongitude) ? parsedLongitude : 0,
      });
      return;
    }

    if (posts.length > 0 && posts[0].location) {
      setLocation({
        placeId: placeId,
        provider: "google",
        name: posts[0].location.split(",")[0] || posts[0].location,
        formattedAddress: posts[0].location,
        latitude: 0,
        longitude: 0,
      });
    }
  }, [
    formattedAddress,
    name,
    parsedLatitude,
    parsedLongitude,
    placeId,
    posts,
    routeLocationName,
  ]);

  const handlePostPress = useCallback(
    (postId: string) => {
      navigateToPost(router, queryClient, postId);
    },
    [router, queryClient],
  );

  const handleGetDirections = useCallback(() => {
    if (location && hasValidCoordinates(location)) {
      openDirections(location, { label: location.name });
    }
  }, [location]);

  const renderGridItem = useCallback(
    ({ item }: { item: Post }) => (
      <PostGridItem post={item} onPress={() => handlePostPress(item.id)} />
    ),
    [handlePostPress],
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 gap-3">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text
          className="flex-1 text-lg font-semibold text-foreground"
          numberOfLines={1}
        >
          Location
        </Text>
        {location && hasValidCoordinates(location) && (
          <Pressable onPress={handleGetDirections} hitSlop={12}>
            <Navigation size={22} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {/* Location Header with Map */}
      <LocationHeader location={location} postCount={posts.length} />

      {/* Posts Grid */}
      <View className="flex-1">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <View
              className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent"
              style={{ transform: [{ rotate: "0deg" }] }}
            />
          </View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-muted-foreground text-center">
              Failed to load posts. Pull to refresh.
            </Text>
          </View>
        ) : posts.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <MapPin size={48} color={colors.mutedForeground} />
            <Text className="text-muted-foreground text-center mt-4">
              No posts at this location yet
            </Text>
            <Text className="text-sm text-muted-foreground/60 text-center mt-2">
              Be the first to post here!
            </Text>
          </View>
        ) : (
          <LegendList
            data={posts}
            numColumns={GRID_COLS}
            renderItem={renderGridItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              padding: GRID_GAP,
              paddingBottom: insets.bottom + 20,
            }}
            estimatedItemSize={GRID_CELL_SIZE}
            refreshControl={
              <RefreshControl refreshing={isLoading} onRefresh={refetch} />
            }
          />
        )}
      </View>
    </View>
  );
}

export default function LocationScreen() {
  return (
    <ErrorBoundary screenName="Location">
      <LocationScreenContent />
    </ErrorBoundary>
  );
}
