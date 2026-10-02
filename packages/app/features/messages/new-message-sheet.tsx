/**
 * NewMessageSheet — pick someone to message, as a detached bottom sheet.
 *
 * Same data path as the `/messages/new` route (`useSearchUsers` +
 * `usersApi.searchUsers`, then `getOrCreateConversationCached`); the route is
 * left in place for deep links. Starting a DM is a small side errand from the
 * inbox, and pushing a whole screen for it threw the inbox away and made you
 * navigate back to a list you never left. A sheet keeps the inbox behind it.
 *
 * Inline `<BottomSheet>`, driven off `index` — not the modal variant. On this
 * stack (Expo SDK 57 / RN 0.86) the modal's portal mounts nothing: `present()`
 * runs, the ref is set, no error is logged, and a native UI dump shows zero
 * sheet and zero backdrop nodes. The inline sheet renders fine in the same app.
 * It needs no portal and no wrapper — its own container is `absoluteFill` with
 * `pointerEvents="box-none"`, so at `index={-1}` taps fall through to the
 * inbox behind it.
 */

import React, { useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import { Search, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useDetachedSheetMetrics,
  SHEET_BOTTOM_INSET,
} from "@dvnt/app/lib/ui/sheet-metrics";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useMessagesSheetsStore } from "@dvnt/app/lib/stores/messages-sheets-store";
import { useSearchUsers } from "@dvnt/app/lib/hooks/use-search";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getOrCreateConversationCached } from "@dvnt/app/lib/hooks/use-conversation-resolution";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";

interface NewMessageSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

interface Row {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

export const NewMessageSheet: React.FC<NewMessageSheetProps> = ({
  visible,
  onDismiss,
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useColorScheme();
  const currentUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  // Store, never useState (house rule). `resetNewMessage` on close is what keeps
  // a stale query out of the field next time the sheet opens.
  const searchQuery = useMessagesSheetsStore((st) => st.searchQuery);
  const setSearchQuery = useMessagesSheetsStore((st) => st.setSearchQuery);
  const isCreating = useMessagesSheetsStore((st) => st.isCreating);
  const setIsCreating = useMessagesSheetsStore((st) => st.setIsCreating);
  const resetNewMessage = useMessagesSheetsStore((st) => st.resetNewMessage);

  const sheet = useDetachedSheetMetrics();
  // Numeric snap point: the shared metrics own the max-w-3xl cap and
  // the 3:4 portrait ratio, clamped to clear the detached inset.
  const snapPoints = useMemo(() => [sheet.height], [sheet.height]);

  useEffect(() => {
    if (!visible) resetNewMessage();
  }, [visible, resetNewMessage]);

  const { data: allUsersData, isLoading: isLoadingAll } = useQuery({
    queryKey: ["users", "all"],
    queryFn: async () => {
      const result = await usersApi.searchUsers("", 50);
      return result.docs.filter((u: any) => u.id !== currentUser?.id);
    },
    enabled: visible && searchQuery.length === 0,
  });

  const { data: searchUsersData, isLoading: isLoadingSearch } =
    useSearchUsers(searchQuery);

  const isLoading = searchQuery ? isLoadingSearch : isLoadingAll;
  const users: Row[] = useMemo(() => {
    const source = searchQuery
      ? searchUsersData?.docs || []
      : allUsersData || [];
    return source
      .filter((u: any) => u.id !== currentUser?.id)
      .map((u: any) => ({
        id: String(u.id || ""),
        username: (u.username as string) || "unknown",
        name: (u.name as string) || (u.username as string) || "User",
        avatar: (u.avatar as string) || "",
      }));
  }, [searchQuery, searchUsersData?.docs, allUsersData, currentUser?.id]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const handleSelectUser = useCallback(
    async (username: string) => {
      if (isCreating) return;
      setIsCreating(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const conversationId = await getOrCreateConversationCached(
          queryClient,
          username,
        );
        if (!conversationId) {
          showToast("error", "Error", "Could not start conversation");
          return;
        }
        // Close first: navigating out from under a presented sheet leaves the
        // backdrop on screen over the chat.
        onDismiss();
        router.push(`/(protected)/chat/${conversationId}`);
      } catch {
        showToast("error", "Error", "Failed to start conversation");
      } finally {
        setIsCreating(false);
      }
    },
    [isCreating, queryClient, showToast, onDismiss, router],
  );

  const handleProfilePress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      onDismiss();
      router.push(`/(protected)/profile/${username}`);
    },
    [queryClient, onDismiss, router],
  );

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.55}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <View className="flex-row items-center gap-3 px-4 py-3">
        <Pressable
          onPress={() => handleProfilePress(item.username)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${item.username}'s profile`}
        >
          <Image
            source={{ uri: item.avatar }}
            className="w-[50px] h-[50px] rounded-full"
          />
        </Pressable>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">
            {item.username}
          </Text>
          <Text className="text-sm text-muted-foreground">{item.name}</Text>
        </View>
        <Pressable
          onPress={() => handleSelectUser(item.username)}
          disabled={isCreating}
          className="bg-primary px-4 py-2 rounded-full"
          accessibilityRole="button"
          accessibilityLabel={`Message ${item.username}`}
        >
          <Text className="text-white font-semibold text-sm">Message</Text>
        </Pressable>
      </View>
    ),
    [handleProfilePress, handleSelectUser, isCreating],
  );

  return (
    <BottomSheet
      snapPoints={snapPoints}
      index={visible ? 0 : -1}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      enableDynamicSizing={false}
      enablePanDownToClose
      detached
      bottomInset={SHEET_BOTTOM_INSET}
      style={{ marginHorizontal: sheet.marginHorizontal }}
      backgroundStyle={{
        backgroundColor: colors.card,
        // All four corners: detached floats as a card, so a top-only radius
        // leaves square bottom corners hanging over the inset.
        borderRadius: 24,
        borderWidth: 1,
        borderColor: colors.border,
      }}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 36,
        height: 4,
      }}
    >
      <View className="px-4 pb-2">
        <Text className="text-lg font-bold text-foreground">New Message</Text>
      </View>

      <View className="px-4 pb-3">
        <View className="flex-row items-center bg-secondary rounded-xl px-3">
          <Search size={20} color={colors.mutedForeground} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search users..."
            placeholderTextColor={colors.mutedForeground}
            className="flex-1 h-11 ml-2 text-foreground text-base"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery("")}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X size={20} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {isLoading ? (
        <View className="p-8 items-center">
          <ActivityIndicator size="large" color={colors.foreground} />
        </View>
      ) : (
        <BottomSheetFlatList
          data={users}
          keyExtractor={(item: Row) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View className="p-8 items-center">
              <Text className="text-muted-foreground">
                {searchQuery ? "No users found" : "No users available"}
              </Text>
            </View>
          }
        />
      )}
    </BottomSheet>
  );
};
