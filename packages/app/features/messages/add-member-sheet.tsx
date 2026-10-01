/**
 * AddMemberSheet — add a user to an existing group conversation.
 *
 * Mirrors the NewGroupSheet search/select pattern but for a single addition.
 * The 12-member ceiling is enforced by the DB trigger; the sheet mirrors the
 * limit in its UI and surfaces the trigger error as a Sonner toast.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { Search, X, UserPlus } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import {
  useDetachedSheetMetrics,
  SHEET_BOTTOM_INSET,
} from "@dvnt/app/lib/ui/sheet-metrics";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { DB } from "@dvnt/app/lib/supabase/db-map";
import { MAX_GROUP_CHAT_MEMBERS } from "@dvnt/app/lib/constants/group-chat";

interface ExistingMember {
  id?: string;
  authId?: string;
  username?: string;
}

interface AddMemberSheetProps {
  visible: boolean;
  onDismiss: () => void;
  conversationId: string;
  currentCount: number;
  existingMembers: ExistingMember[];
  onAdded?: () => void;
}

interface Row {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

export const AddMemberSheet: React.FC<AddMemberSheetProps> = ({
  visible,
  onDismiss,
  conversationId,
  currentCount,
  existingMembers,
  onAdded,
}) => {
  const { colors } = useColorScheme();
  const currentUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  const sheet = useDetachedSheetMetrics();
  const snapPoints = useMemo(() => [sheet.height], [sheet.height]);

  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);

  const existingIds = useMemo(
    () =>
      new Set(
        existingMembers
          .flatMap((m) => [m.id, m.authId, m.username])
          .filter(Boolean)
          .map(String),
      ),
    [existingMembers],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["users", "all", query],
    queryFn: async () => usersApi.searchUsers(query || "", 50),
    enabled: visible,
  });

  const users: Row[] = useMemo(
    () =>
      (data?.docs || [])
        .filter(
          (u: any) =>
            u.id !== currentUser?.id && !existingIds.has(String(u.id || "")),
        )
        .map((u: any) => ({
          id: String(u.id || ""),
          username: (u.username as string) || "unknown",
          name: (u.name as string) || (u.username as string) || "User",
          avatar: (u.avatar as string) || "",
        })),
    [data, currentUser?.id, existingIds],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
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

  const handleAdd = useCallback(
    async (user: Row) => {
      if (currentCount >= MAX_GROUP_CHAT_MEMBERS) {
        showToast("error", "12 MAX GROUP CHAT USERS");
        return;
      }
      setAddingId(user.id);
      try {
        const { data: userRow, error: lookupError } = await supabase
          .from(DB.users.table)
          .select(DB.users.authId)
          .eq(DB.users.id, parseInt(user.id, 10))
          .single();

        if (lookupError || !userRow?.[DB.users.authId]) {
          showToast("error", "Error", "Could not add member");
          return;
        }

        const { error } = await supabase
          .from(DB.conversationsRels.table)
          .insert({
            [DB.conversationsRels.parentId]: parseInt(conversationId, 10),
            [DB.conversationsRels.usersId]: userRow[DB.users.authId],
            path: "participants",
          });

        if (error) {
          if (error.message.includes("12 MAX GROUP CHAT USERS")) {
            showToast("error", "12 MAX GROUP CHAT USERS");
          } else {
            showToast("error", "Error", error.message);
          }
          return;
        }

        showToast("success", "Success", `${user.username} added to the group`);
        onAdded?.();
        onDismiss();
      } catch (e: any) {
        showToast("error", "Error", e?.message || "Failed to add member");
      } finally {
        setAddingId(null);
      }
    },
    [conversationId, currentCount, existingIds, onAdded, onDismiss, showToast],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      const busy = addingId === item.id;
      return (
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            void handleAdd(item);
          }}
          disabled={busy}
          className="flex-row items-center gap-3 px-4 py-3"
          accessibilityRole="button"
          accessibilityLabel={`Add ${item.username}`}
        >
          <Image
            source={{ uri: item.avatar }}
            className="w-10 h-10 rounded-full"
          />
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              {item.username}
            </Text>
            <Text className="text-sm text-muted-foreground">{item.name}</Text>
          </View>
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.primary }}
            >
              <UserPlus size={16} color="#fff" />
            </View>
          )}
        </Pressable>
      );
    },
    [addingId, colors.primary, handleAdd],
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
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-lg font-bold text-foreground">Add member</Text>
        <Text className="text-xs text-muted-foreground">
          {currentCount}/{MAX_GROUP_CHAT_MEMBERS}
        </Text>
      </View>

      <View className="px-4 pb-3">
        <View className="flex-row items-center bg-secondary rounded-xl px-3">
          <Search size={20} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search users..."
            placeholderTextColor={colors.mutedForeground}
            className="flex-1 h-11 ml-2 text-foreground text-base"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery("")}
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
                {query ? "No users found" : "Search for a user to add"}
              </Text>
            </View>
          }
        />
      )}
    </BottomSheet>
  );
};
