import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Link, useRouter, useLocalSearchParams } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useNavigation } from "@react-navigation/native";
import {
  ArrowLeft,
  Search,
  X,
  Play,
  Hash,
  Compass,
  MapPin,
} from "lucide-react-native";
import { Image } from "expo-image";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useSearchStore } from "@dvnt/app/lib/stores/search-store";
import { useEffect, useCallback, useMemo, useState } from "react";
import { Debouncer } from "@tanstack/pacer";
import { SearchSkeleton, SearchResultsSkeleton } from "@dvnt/app/components/skeletons";
import {
  useDiscoverData,
  useSearchResults,
  type DiscoverDTO,
} from "@dvnt/app/lib/hooks/use-search-screen";
import { BadgeCheck, UserPlus } from "lucide-react-native";
import { LegendList } from "@dvnt/app/components/list";
import { VideoThumbnailImage } from "@dvnt/app/components/ui/video-thumbnail-image";
import type { Post } from "@dvnt/app/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { navigateToPost } from "@dvnt/app/lib/routes/post-routes";
import {
  LocationAutocompleteInstagram,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-instagram";
import { TextPostSurface } from "@dvnt/app/components/post/TextPostSurface";
import { resolveTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import { prefetchImagesBlocking } from "@dvnt/app/lib/perf/image-prefetch";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const columnWidth = (SCREEN_WIDTH - 8) / 3;
const GRID_COLS = SCREEN_WIDTH >= 768 ? 5 : 4;
const GRID_GAP = 2;
const GRID_CELL_SIZE = (SCREEN_WIDTH - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

function getSearchPreviewUrls(posts: Post[]) {
  return posts
    .flatMap((post) => {
      const firstMedia = post.media?.[0];
      const isVideo = post.type === "video" || firstMedia?.type === "video";
      const imageUri =
        post.thumbnail || (!isVideo ? firstMedia?.url : undefined);
      return imageUri ? [imageUri] : [];
    })
    .filter(Boolean);
}

function getSearchAvatarUrls(users: Array<{ avatar?: string | null }>) {
  return users
    .map((user) => user.avatar)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

function PostGridTile({
  post,
  size,
  router,
  queryClient,
}: {
  post: Post;
  size: number;
  router: ReturnType<typeof useRouter>;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const firstMedia = post.media?.[0];
  const isTextPost = post.kind === "text";
  const textPostPreview = resolveTextPostPresentation(
    post.textSlides,
    post.caption,
  );
  const isVideo = post.type === "video" || firstMedia?.type === "video";
  const videoUrl = isVideo ? firstMedia?.url : undefined;
  const imageUri = post.thumbnail || (!isVideo ? firstMedia?.url : undefined);

  return (
    <Pressable
      onPress={() => {
        if (post.id) {
          navigateToPost(router, queryClient, post.id);
        }
      }}
      style={{
        width: size,
        height: size,
        padding: 1,
      }}
    >
      <View
        className="flex-1 overflow-hidden bg-secondary"
        style={{ borderRadius: 8 }}
      >
        {isTextPost ? (
          <TextPostSurface
            text={textPostPreview.previewText}
            theme={post.textTheme}
            variant="grid"
            style={{ minHeight: "100%", height: "100%" }}
          />
        ) : imageUri ? (
          <>
            <Image
              source={{ uri: imageUri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={0}
              cachePolicy="memory-disk"
            />
            {isVideo ? (
              <View className="absolute top-2 right-2">
                <Play size={20} color="#fff" fill="#fff" />
              </View>
            ) : null}
            {post.hasMultipleImages ? (
              <View
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  borderRadius: 4,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                }}
              >
                <Text
                  style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}
                >
                  +
                </Text>
              </View>
            ) : null}
          </>
        ) : videoUrl ? (
          <>
            <VideoThumbnailImage videoUrl={videoUrl} transition={0} />
            <View className="absolute top-2 right-2">
              <Play size={20} color="#fff" fill="#fff" />
            </View>
          </>
        ) : (
          <View className="w-full h-full items-center justify-center">
            <Text className="text-muted-foreground text-xs">No preview</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function DiscoverSection({
  users,
}: {
  users: DiscoverDTO["users"];
}) {
  return (
    <View className="py-4">
      <View className="flex-row items-center gap-2 px-4 mb-4">
        <UserPlus size={20} color="#3FDCFF" />
        <Text className="text-lg font-bold text-foreground">
          Discover New Profiles
        </Text>
      </View>

      {users.length === 0 ? (
        <View className="px-4">
          <Text className="text-muted-foreground text-sm">
            No new profiles to discover right now.
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {users.map((user) => (
            <Link
              key={user.id}
              href={
                {
                  pathname: "/(protected)/profile/[username]",
                  params: {
                    username: user.username,
                    authId: user.id,
                    avatar: user.avatar || "",
                    name: user.name || "",
                  },
                } as any
              }
              asChild
            >
              <Pressable
                style={{
                  width: 140,
                  backgroundColor: "rgba(30, 30, 30, 0.8)",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)",
                  paddingVertical: 16,
                  alignItems: "center",
                }}
              >
                <Avatar
                  uri={user.avatar}
                  username={user.username}
                  size="lg"
                  variant="roundedSquare"
                  transition={0}
                />
                <View className="flex-row items-center gap-1 mt-2">
                  <Text
                    className="text-sm font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {user.name}
                  </Text>
                  {user.verified && (
                    <BadgeCheck size={12} color="#FF6DC1" fill="#FF6DC1" />
                  )}
                </View>
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={1}
                >
                  @{user.username}
                </Text>
                {user.bio ? (
                  <Text
                    className="text-[11px] text-muted-foreground mt-1 px-3 text-center"
                    numberOfLines={2}
                  >
                    {user.bio}
                  </Text>
                ) : null}
              </Pressable>
            </Link>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function DiscoverGrid({
  router,
  posts,
  queryClient,
}: {
  router: ReturnType<typeof useRouter>;
  posts: Post[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const renderItem = useCallback(
    ({ item }: { item: Post }) => {
      return (
        <PostGridTile
          post={item}
          size={GRID_CELL_SIZE}
          router={router}
          queryClient={queryClient}
        />
      );
    },
    [queryClient, router],
  );

  if (posts.length === 0) return null;

  return (
    <View style={{ paddingTop: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          marginBottom: 12,
        }}
      >
        <Compass size={20} color="#3FDCFF" />
        <Text
          style={{
            fontSize: 18,
            fontWeight: "700",
            color: "#fff",
          }}
        >
          Explore
        </Text>
      </View>
      <LegendList
        data={posts}
        renderItem={renderItem}
        keyExtractor={(item: Post) => item.id}
        numColumns={GRID_COLS}
        estimatedItemSize={GRID_CELL_SIZE}
        recycleItems
        columnWrapperStyle={{ gap: GRID_GAP }}
        contentContainerStyle={{ gap: GRID_GAP }}
        scrollEnabled={false}
      />
    </View>
  );
}

function SearchScreenContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ query?: string; mode?: string }>();
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);
  const debouncedSearch = useSearchStore((s) => s.debouncedSearch);
  const setDebouncedSearch = useSearchStore((s) => s.setDebouncedSearch);
  const clearSearch = useSearchStore((s) => s.clearSearch);
  const insets = useSafeAreaInsets();

  // Location search state
  const [searchMode, setSearchMode] = useState<"content" | "location">(
    "content",
  );
  const [selectedLocation, setSelectedLocation] = useState<LocationData | null>(
    null,
  );
  const [criticalAssetsReady, setCriticalAssetsReady] = useState(false);
  const [activeAssetKey, setActiveAssetKey] = useState<string | null>(null);
  const isContentMode = searchMode === "content";
  const hasSearchQuery = debouncedSearch.trim().length >= 2;

  // TanStack Debouncer — 300ms delay prevents query-per-keystroke
  const searchDebouncer = useMemo(
    () =>
      new Debouncer((text: string) => setDebouncedSearch(text), { wait: 300 }),
    [setDebouncedSearch],
  );

  // Use query from params if provided (e.g., when navigating from hashtag)
  useEffect(() => {
    if (params.query) {
      setSearchQuery(params.query);
      setDebouncedSearch(params.query);
    }
  }, [params.query, setSearchQuery, setDebouncedSearch]);

  useEffect(() => {
    if (params.mode === "location") {
      setSearchMode("location");
      return;
    }

    if (params.mode === "content") {
      setSearchMode("content");
    }
  }, [params.mode]);

  // Consolidated queries — ONE for discover, ONE for search results
  const { data: discoverData, isLoading: isDiscoverLoading } = useDiscoverData({
    enabled: isContentMode && !hasSearchQuery,
  });
  const { data: searchData, isLoading: isSearchLoading } = useSearchResults(
    debouncedSearch,
    {
      enabled: isContentMode && hasSearchQuery,
    },
  );

  const isHashtag = debouncedSearch.startsWith("#");
  const discoverPosts = useMemo(
    () => (discoverData?.posts || []).filter((post) => !post.isNSFW),
    [discoverData?.posts],
  );
  const searchResults = useMemo(
    () => (searchData?.posts?.docs || []).filter((post) => !post.isNSFW),
    [searchData?.posts?.docs],
  );
  const userResults = searchData?.users?.docs || [];
  const criticalAssetPayload = useMemo(() => {
    if (!isContentMode) {
      return { key: "location-mode", urls: [] as string[] };
    }

    if (hasSearchQuery) {
      if (!searchData) {
        return { key: null, urls: [] as string[] };
      }

      const urls = [
        ...getSearchAvatarUrls(userResults),
        ...getSearchPreviewUrls(searchResults),
      ].slice(0, 16);
      const key = [
        "results",
        debouncedSearch.trim().toLowerCase(),
        userResults.map((user: any) => user.id).join(","),
        searchResults.map((post) => post.id).join(","),
      ].join(":");
      return { key, urls };
    }

    if (!discoverData) {
      return { key: null, urls: [] as string[] };
    }

    const urls = [
      ...getSearchAvatarUrls(discoverData.users),
      ...getSearchPreviewUrls(discoverPosts),
    ].slice(0, 16);
    const key = [
      "discover",
      discoverData.users.map((user) => user.id).join(","),
      discoverPosts.map((post) => post.id).join(","),
    ].join(":");
    return { key, urls };
  }, [
    debouncedSearch,
    discoverData,
    discoverPosts,
    hasSearchQuery,
    isContentMode,
    searchData,
    searchResults,
    userResults,
  ]);

  useEffect(() => {
    if (!isContentMode) {
      setActiveAssetKey("location-mode");
      setCriticalAssetsReady(true);
      return;
    }

    const pendingContentData = hasSearchQuery ? !searchData : !discoverData;
    if (pendingContentData || !criticalAssetPayload.key) {
      setActiveAssetKey(null);
      setCriticalAssetsReady(false);
      return;
    }

    if (activeAssetKey === criticalAssetPayload.key && criticalAssetsReady) {
      return;
    }

    let cancelled = false;
    setActiveAssetKey(criticalAssetPayload.key);
    setCriticalAssetsReady(false);

    const warmAssets = async () => {
      if (criticalAssetPayload.urls.length > 0) {
        await prefetchImagesBlocking(criticalAssetPayload.urls);
      }

      if (cancelled) return;
      setCriticalAssetsReady(true);
    };

    void warmAssets();

    return () => {
      cancelled = true;
    };
  }, [
    activeAssetKey,
    criticalAssetPayload.key,
    criticalAssetPayload.urls,
    criticalAssetsReady,
    discoverData,
    hasSearchQuery,
    isContentMode,
    searchData,
  ]);

  const handleQueryChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      searchDebouncer.maybeExecute(text);
    },
    [setSearchQuery, searchDebouncer],
  );

  const handleClear = useCallback(() => {
    searchDebouncer.cancel();
    clearSearch();
    setSelectedLocation(null);
  }, [clearSearch, searchDebouncer]);

  const handleLocationSelect = useCallback(
    (location: LocationData) => {
      setSelectedLocation(location);
      router.push({
        pathname: "/(protected)/location/[placeId]",
        params: {
          placeId: location.placeId || location.name,
          name: location.name,
          formattedAddress: location.formattedAddress || "",
          latitude:
            typeof location.latitude === "number"
              ? String(location.latitude)
              : "",
          longitude:
            typeof location.longitude === "number"
              ? String(location.longitude)
              : "",
        },
      });
    },
    [router],
  );

  const toggleSearchMode = useCallback(() => {
    setSearchMode((prev) => (prev === "content" ? "location" : "content"));
    searchDebouncer.cancel();
    clearSearch();
  }, [clearSearch, searchDebouncer]);

  return (
    <View
      className="flex-1 bg-background max-w-3xl w-full self-center"
      style={{ paddingTop: insets.top }}
    >
      {/* Header */}
      <View
        className="flex-row items-center gap-3 border-b border-border px-4 py-3"
        style={{ zIndex: 20, elevation: 20 }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <View className="flex-1">
          {searchMode === "content" ? (
            <View className="flex-row items-center bg-secondary rounded-xl px-3">
              <Search size={20} color="#999" />
              <TextInput
                value={searchQuery}
                onChangeText={handleQueryChange}
                placeholder={isHashtag ? "Search hashtags..." : "Search"}
                placeholderTextColor="#999"
                autoFocus={false}
                className="flex-1 h-10 ml-2 text-foreground"
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={handleClear}>
                  <X size={20} color="#999" />
                </Pressable>
              )}
            </View>
          ) : (
            <View />
          )}
        </View>
        <Pressable
          onPress={toggleSearchMode}
          className="bg-secondary rounded-lg p-2"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {searchMode === "content" ? (
            <MapPin size={18} color="#3FDCFF" />
          ) : (
            <Search size={18} color="#3FDCFF" />
          )}
        </Pressable>
      </View>

      {/* Content */}
      {searchMode === "location" ? (
        <View className="flex-1">
          <LocationAutocompleteInstagram
            value={selectedLocation?.formattedAddress || selectedLocation?.name || ""}
            placeholder="Search locations..."
            onLocationSelect={handleLocationSelect}
            onClear={() => setSelectedLocation(null)}
            onTextChange={(text) => {
              if (!text.trim()) {
                setSelectedLocation(null);
              }
            }}
            autoOpen
            hideTrigger
            onDismiss={() => setSearchMode("content")}
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {debouncedSearch.length >= 2 ? (
            isSearchLoading || !searchData || !criticalAssetsReady ? (
              <SearchResultsSkeleton />
            ) : (
              <View className="flex-1">
                {isHashtag ? (
                  <>
                    <View className="p-4 border-b border-border">
                      <View className="flex-row items-center gap-2">
                        <Hash size={20} color="#fff" />
                        <Text className="text-lg font-semibold text-foreground">
                          {searchQuery}
                        </Text>
                      </View>
                      <Text className="text-sm text-muted-foreground mt-1">
                        {searchResults.length}{" "}
                        {searchResults.length === 1 ? "post" : "posts"}
                      </Text>
                    </View>
                    {searchResults.length > 0 ? (
                      <View className="flex-row flex-wrap">
                        {searchResults.map((post: any) => (
                          <PostGridTile
                            key={post.id}
                            post={post}
                            size={columnWidth}
                            router={router}
                            queryClient={queryClient}
                          />
                        ))}
                      </View>
                    ) : (
                      <View className="p-8 items-center">
                        <Hash size={48} color="#666" />
                        <Text className="text-muted-foreground mt-4 text-center">
                          No posts found for {searchQuery}
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    {userResults.length > 0 && (
                      <View className="p-4 border-b border-border">
                        <Text className="text-base font-semibold text-foreground mb-3">
                          Users
                        </Text>
                        {userResults.map((user: any) => (
                          <Pressable
                            key={user.id}
                            onPress={() =>
                              router.push({
                                pathname: "/(protected)/profile/[username]",
                                params: {
                                  username: user.username,
                                  authId: user.authId || user.id,
                                  avatar: user.avatar || "",
                                  name: user.name || "",
                                },
                              })
                            }
                            className="flex-row items-center py-3 border-b border-border"
                          >
                            <Avatar
                              uri={user.avatar}
                              username={user.username || "User"}
                              size="md"
                              variant="roundedSquare"
                              transition={0}
                            />
                            <View className="ml-3 flex-1">
                              <Text className="font-semibold text-foreground">
                                {user.username}
                              </Text>
                              {user.name && (
                                <Text className="text-muted-foreground text-[13px]">
                                  {user.name}
                                </Text>
                              )}
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {searchResults.length > 0 && (
                      <View className="p-4">
                        <Text className="text-base font-semibold text-foreground mb-3">
                          Posts
                        </Text>
                        <View className="flex-row flex-wrap">
                          {searchResults.map((post: any) => (
                            <PostGridTile
                              key={post.id}
                              post={post}
                              size={columnWidth}
                              router={router}
                              queryClient={queryClient}
                            />
                          ))}
                        </View>
                      </View>
                    )}
                    {userResults.length === 0 && searchResults.length === 0 && (
                      <View className="p-8 items-center">
                        <Search size={48} color="#666" />
                        <Text className="text-muted-foreground mt-4 text-center">
                          No results found for "{debouncedSearch}"
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </View>
            )
          ) : isDiscoverLoading || !discoverData || !criticalAssetsReady ? (
            <SearchSkeleton />
          ) : (
            <>
              <DiscoverSection users={discoverData?.users ?? []} />
              <DiscoverGrid
                router={router}
                posts={discoverPosts}
                queryClient={queryClient}
              />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="Search" onGoBack={() => router.back()}>
      <SearchScreenContent />
    </ErrorBoundary>
  );
}
