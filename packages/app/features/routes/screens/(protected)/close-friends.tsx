/**
 * Manage Close Friends Screen
 * Instagram-style close friends management with search, add/remove, optimistic toggle.
 */

import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { LegendList } from "@dvnt/app/components/list";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ChevronLeft, Search, Star, X } from "lucide-react-native";
import { Image } from "expo-image";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  useCloseFriendsList,
  useCloseFriendIds,
  useToggleCloseFriend,
  type CloseFriend,
} from "@dvnt/app/lib/hooks/use-close-friends";
import { useSearchUsers } from "@dvnt/app/lib/hooks/use-search";
import { useState, useCallback, useMemo } from "react";
import { useDebouncedCallback } from "@dvnt/app/lib/hooks/use-debounce";
import * as Haptics from "expo-haptics";

const CF_ACCENT = "#FC253A";

function ManageCloseFriendsScreenContent() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { user } = useAuthStore();

  const { data: closeFriends = [], isLoading } = useCloseFriendsList();
  const { data: closeFriendIdSet } = useCloseFriendIds();
  const toggleMutation = useToggleCloseFriend();

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const debouncedSearch = useDebouncedCallback((q: string) => {
    setDebouncedQuery(q);
  }, 300);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      debouncedSearch(text);
    },
    [debouncedSearch],
  );

  const { data: searchData, isLoading: isSearching } =
    useSearchUsers(debouncedQuery);
  const searchResults = (searchData as any)?.docs || [];

  const isCloseFriend = useCallback(
    (friendId: number) => {
      return closeFriendIdSet?.has(friendId) ?? false;
    },
    [closeFriendIdSet],
  );

  const handleToggle = useCallback(
    (friendId: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toggleMutation.mutate({
        friendId,
        isCloseFriend: isCloseFriend(friendId),
      });
    },
    [toggleMutation, isCloseFriend],
  );

  // When searching, show search results. Otherwise show current close friends.
  const displayData = useMemo(() => {
    if (debouncedQuery.length > 0) {
      return searchResults
        .filter((u: any) => String(u.id) !== String(user?.id))
        .map((u: any) => ({
          id: typeof u.id === "number" ? u.id : parseInt(u.id),
          username: u.username || "",
          name: u.name || u.username || "",
          avatar: u.avatar || null,
        }));
    }
    return closeFriends;
  }, [debouncedQuery, searchResults, closeFriends, user?.id]);

  const renderItem = useCallback(
    ({ item }: { item: CloseFriend }) => {
      const isCF = isCloseFriend(item.id);
      return (
        <Pressable
          onPress={() => handleToggle(item.id)}
          className="flex-row items-center px-4 py-3 active:bg-secondary/30"
        >
          <Image
            source={{
              uri: item.avatar || "",
            }}
            style={{ width: 48, height: 48, borderRadius: 24 }}
            contentFit="cover"
          />
          <View className="ml-3 flex-1">
            <Text className="font-semibold text-foreground">{item.name}</Text>
            <Text className="text-sm text-muted-foreground">
              @{item.username}
            </Text>
          </View>
          <View
            className="rounded-full px-4 py-2"
            style={{
              backgroundColor: isCF ? CF_ACCENT : "rgba(255,255,255,0.1)",
            }}
          >
            <Text
              className="text-xs font-bold"
              style={{ color: isCF ? "#000" : "#fff" }}
            >
              {isCF ? "Added" : "Add"}
            </Text>
          </View>
        </Pressable>
      );
    },
    [isCloseFriend, handleToggle],
  );

  const keyExtractor = useCallback((item: CloseFriend) => String(item.id), []);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center border-b border-border px-4 py-3">
        <Pressable onPress={() => router.back()} className="mr-3" hitSlop={12}>
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-foreground">
          Close Friends
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text className="font-semibold" style={{ color: CF_ACCENT }}>
            Done
          </Text>
        </Pressable>
      </View>

      {/* Info banner */}
      <View
        className="mx-4 mt-4 flex-row items-center gap-3 rounded-xl p-4"
        style={{ backgroundColor: "rgba(252, 37, 58, 0.1)" }}
      >
        <Star size={22} color={CF_ACCENT} fill={CF_ACCENT} />
        <View className="flex-1">
          <Text className="font-semibold text-foreground">Close Friends</Text>
          <Text className="text-xs text-muted-foreground">
            Only people you choose can see your Close Friends stories
          </Text>
        </View>
      </View>

      {/* Search */}
      <View className="mx-4 mt-4 flex-row items-center rounded-xl bg-card px-3 py-2.5">
        <Search size={18} color="#666" />
        <TextInput
          value={searchQuery}
          onChangeText={handleSearchChange}
          placeholder="Search people..."
          placeholderTextColor="#666"
          className="ml-2 flex-1 text-foreground"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => {
              setSearchQuery("");
              setDebouncedQuery("");
            }}
            hitSlop={12}
          >
            <X size={16} color="#666" />
          </Pressable>
        )}
      </View>

      {/* List */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={CF_ACCENT} />
        </View>
      ) : (
        <LegendList
          data={displayData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={{ marginTop: 8 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          recycleItems
          estimatedItemSize={72}
          ListHeaderComponent={
            debouncedQuery.length === 0 && closeFriends.length > 0 ? (
              <Text className="px-4 pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                {closeFriends.length} CLOSE{" "}
                {closeFriends.length === 1 ? "FRIEND" : "FRIENDS"}
              </Text>
            ) : debouncedQuery.length > 0 ? (
              <Text className="px-4 pb-2 pt-4 text-xs font-semibold text-muted-foreground">
                {isSearching ? "SEARCHING..." : `${displayData.length} RESULTS`}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View className="items-center justify-center px-8 py-20">
              <Star size={48} color="#444" />
              <Text className="mt-4 text-lg font-semibold text-foreground">
                {debouncedQuery.length > 0
                  ? "No users found"
                  : "No Close Friends Yet"}
              </Text>
              <Text className="mt-2 text-center text-sm text-muted-foreground">
                {debouncedQuery.length > 0
                  ? "Try a different search"
                  : "Search for people to add to your close friends list"}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

export default function ManageCloseFriendsScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="CloseFriends" onGoBack={() => router.back()}>
      <ManageCloseFriendsScreenContent />
    </ErrorBoundary>
  );
}
