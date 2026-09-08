/**
 * NewGroupSheet — build a group conversation, as a detached bottom sheet.
 *
 * Reuses `useNewGroupStore` (selection, group name, in-flight flag) and
 * `messagesApi.createGroupConversation`, so the rules live in one place and the
 * `/messages/new-group` route keeps working for deep links. Same reasoning as
 * `new-message-sheet`: composing is a side errand from the inbox, not a
 * destination worth unmounting the inbox for.
 *
 * Inline `<BottomSheet>` for the same reason as `new-message-sheet`: the modal
 * variant's portal mounts nothing on this stack, so open/close is driven off
 * `index` rather than `present()`/`dismiss()`.
 */

import React, { useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import { Search, X, Check, Users } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  useDetachedSheetMetrics,
  SHEET_BOTTOM_INSET,
} from "@dvnt/app/lib/ui/sheet-metrics";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useNewGroupStore } from "@dvnt/app/lib/stores/new-group-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";

interface NewGroupSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

interface Row {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

/** A group needs the author plus at least two others. */
const MIN_GROUP_MEMBERS = 2;

export const NewGroupSheet: React.FC<NewGroupSheetProps> = ({
  visible,
  onDismiss,
}) => {
  const router = useRouter();
  const { colors } = useColorScheme();
  const currentUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const searchQuery = useNewGroupStore((s) => s.searchQuery);
  const setSearchQuery = useNewGroupStore((s) => s.setSearchQuery);
  const selectedUsers = useNewGroupStore((s) => s.selectedUsers);
  const groupName = useNewGroupStore((s) => s.groupName);
  const setGroupName = useNewGroupStore((s) => s.setGroupName);
  const isCreating = useNewGroupStore((s) => s.isCreating);
  const setIsCreating = useNewGroupStore((s) => s.setIsCreating);
  const toggleUser = useNewGroupStore((s) => s.toggleUser);
  const reset = useNewGroupStore((s) => s.reset);

  const sheet = useDetachedSheetMetrics();
  // Numeric snap point: the shared metrics own the max-w-3xl cap and
  // the 3:4 portrait ratio, clamped to clear the detached inset.
  const snapPoints = useMemo(() => [sheet.height], [sheet.height]);

  // Clear the half-built group when the sheet closes, so reopening starts fresh
  // rather than resurrecting a selection you abandoned.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const { data: allUsersData, isLoading } = useQuery({
    queryKey: ["users", "all", searchQuery],
    queryFn: async () => {
      const result = await usersApi.searchUsers(searchQuery || "", 50);
      return result.docs.filter((u: any) => u.id !== currentUser?.id);
    },
    enabled: visible,
  });

  const users: Row[] = useMemo(
    () =>
      (allUsersData || [])
        .filter((u: any) => u.id !== currentUser?.id)
        .map((u: any) => ({
          id: String(u.id || ""),
          username: (u.username as string) || "unknown",
          name: (u.name as string) || (u.username as string) || "User",
          avatar: (u.avatar as string) || "",
        })),
    [allUsersData, currentUser?.id],
  );

  const isUserSelected = useCallback(
    (userId: string) => selectedUsers.some((u) => u.id === userId),
    [selectedUsers],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const canCreate =
    selectedUsers.length >= MIN_GROUP_MEMBERS && !!groupName.trim();

  const handleCreateGroup = useCallback(async () => {
    if (selectedUsers.length < MIN_GROUP_MEMBERS) {
      showToast("error", "Error", "Select at least 2 users for a group chat");
      return;
    }
    if (!groupName.trim()) {
      showToast("error", "Error", "Please enter a group name");
      return;
    }
    setIsCreating(true);
    try {
      const conversation = await messagesApi.createGroupConversation(
        selectedUsers.map((u) => u.id),
        groupName.trim(),
      );
      showToast("success", "Success", "Group chat created");
      // Close before navigating: leaving a presented sheet up puts its backdrop
      // over the conversation you just made.
      onDismiss();
      router.push(`/(protected)/chat/${conversation.id}`);
    } catch (error: any) {
      showToast("error", "Error", error?.message || "Failed to create group");
    } finally {
      setIsCreating(false);
    }
  }, [
    selectedUsers,
    groupName,
    router,
    showToast,
    setIsCreating,
    onDismiss,
  ]);

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
    ({ item }: { item: Row }) => {
      const selected = isUserSelected(item.id);
      return (
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            toggleUser(item);
          }}
          className="flex-row items-center gap-3 px-4 py-3"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={item.username}
        >
          <Image
            source={{ uri: item.avatar }}
            className="w-[50px] h-[50px] rounded-full"
          />
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {item.username}
            </Text>
            <Text className="text-sm text-muted-foreground">{item.name}</Text>
          </View>
          <View
            className="h-6 w-6 items-center justify-center rounded-full border"
            style={{
              backgroundColor: selected ? colors.primary : "transparent",
              borderColor: selected ? colors.primary : colors.border,
            }}
          >
            {selected ? <Check size={14} color="#fff" /> : null}
          </View>
        </Pressable>
      );
    },
    [isUserSelected, toggleUser, colors],
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
      <View className="flex-row items-center gap-3 px-4 pb-2">
        <Text className="flex-1 text-lg font-bold text-foreground">
          New Group
        </Text>
        {canCreate && (
          <Pressable
            onPress={handleCreateGroup}
            disabled={isCreating}
            className="bg-primary px-4 py-2 rounded-full"
            accessibilityRole="button"
            accessibilityLabel="Create group"
          >
            {isCreating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-sm">Create</Text>
            )}
          </Pressable>
        )}
      </View>

      <View className="px-4 pb-3">
        <View className="flex-row items-center bg-secondary rounded-xl px-3">
          <Users size={20} color={colors.mutedForeground} />
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name..."
            placeholderTextColor={colors.mutedForeground}
            maxLength={50}
            className="flex-1 h-11 ml-2 text-foreground text-base"
          />
        </View>
        <Text className="text-xs text-muted-foreground mt-2 ml-1">
          Select at least 2 people
        </Text>
      </View>

      {selectedUsers.length > 0 && (
        <View className="px-4 pb-3">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 8 }}
          >
            <View className="flex-row gap-3">
              {selectedUsers.map((user) => (
                <Pressable
                  key={user.id}
                  onPress={() => toggleUser(user)}
                  className="flex-row items-center gap-2 bg-secondary rounded-full pl-1 pr-3 py-1"
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${user.username}`}
                >
                  <Image
                    source={{ uri: user.avatar }}
                    className="w-7 h-7 rounded-full"
                  />
                  <Text className="text-sm text-foreground">
                    {user.username}
                  </Text>
                  <X size={14} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

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
              <Text className="text-muted-foreground">No users found</Text>
            </View>
          }
        />
      )}
    </BottomSheet>
  );
};
