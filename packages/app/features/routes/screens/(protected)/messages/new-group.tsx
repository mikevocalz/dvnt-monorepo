/**
 * New Group Chat Screen
 *
 * Allows selecting multiple users to create a group conversation.
 *
 * Route: /(protected)/messages/new-group
 */

import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ArrowLeft, Search, X, Check, Users } from "lucide-react-native";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";

interface SelectedUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

const MAX_GROUP_MEMBERS = 4;

function NewGroupScreenContent() {
  const router = useRouter();
  const currentUser = useAuthStore((state) => state.user);
  const showToast = useUIStore((s) => s.showToast);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<SelectedUser[]>([]);
  const [groupName, setGroupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Fetch all users
  const { data: allUsersData, isLoading } = useQuery({
    queryKey: ["users", "all", searchQuery],
    queryFn: async () => {
      try {
        const result = await usersApi.searchUsers(searchQuery || "", 50);
        return result.docs.filter((user: any) => user.id !== currentUser?.id);
      } catch (error) {
        console.error("[NewGroup] Error fetching users:", error);
        return [];
      }
    },
  });

  const filteredUsers = (allUsersData || [])
    .filter((user: any) => user.id !== currentUser?.id)
    .map((user: any) => ({
      id: String(user.id || ""),
      username: (user.username as string) || "unknown",
      name: (user.name as string) || (user.username as string) || "User",
      avatar: (user.avatar as string) || "",
    }));

  const toggleUserSelection = useCallback(
    (user: SelectedUser) => {
      setSelectedUsers((prev) => {
        const isSelected = prev.some((u) => u.id === user.id);
        if (isSelected) {
          return prev.filter((u) => u.id !== user.id);
        }
        // Check max limit (excluding current user who will be added automatically)
        if (prev.length >= MAX_GROUP_MEMBERS - 1) {
          showToast(
            "warning",
            "Limit Reached",
            `Group chats can have max ${MAX_GROUP_MEMBERS} members`,
          );
          return prev;
        }
        return [...prev, user];
      });
    },
    [showToast],
  );

  const isUserSelected = useCallback(
    (userId: string) => selectedUsers.some((u) => u.id === userId),
    [selectedUsers],
  );

  const handleCreateGroup = useCallback(async () => {
    if (selectedUsers.length < 2) {
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
      console.log("[NewGroup] Created group conversation:", conversation.id);

      showToast("success", "Success", "Group chat created");
      router.replace(`/(protected)/chat/${conversation.id}`);
    } catch (error: any) {
      console.error("[NewGroup] Error creating group:", error);
      showToast("error", "Error", error.message || "Failed to create group");
    } finally {
      setIsCreating(false);
    }
  }, [selectedUsers, groupName, router, showToast]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <Text className="flex-1 text-lg font-bold text-foreground">
          New Group
        </Text>
        {selectedUsers.length >= 2 && (
          <Pressable
            onPress={handleCreateGroup}
            disabled={isCreating}
            className="bg-primary px-4 py-2 rounded-full"
          >
            {isCreating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-sm">Create</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Group Name Input */}
      <View className="px-4 py-3 border-b border-border">
        <View className="flex-row items-center bg-secondary rounded-xl px-3">
          <Users size={20} color="#666" />
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name..."
            placeholderTextColor="#666"
            maxLength={50}
            className="flex-1 h-11 ml-2 text-foreground text-base"
          />
        </View>
        <Text className="text-xs text-muted-foreground mt-2 ml-1">
          Group chats support up to {MAX_GROUP_MEMBERS} members
        </Text>
      </View>

      {/* Selected Users */}
      {selectedUsers.length > 0 && (
        <View className="px-4 py-3 border-b border-border">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 8 }}
          >
            <View className="flex-row gap-3">
              {selectedUsers.map((user) => (
                <Pressable
                  key={user.id}
                  onPress={() => toggleUserSelection(user)}
                  className="flex-row items-center gap-2 bg-secondary rounded-full pl-1 pr-3 py-1"
                >
                  <Image
                    source={{ uri: user.avatar }}
                    className="w-7 h-7 rounded-lg"
                  />
                  <Text
                    className="text-sm text-foreground font-medium"
                    numberOfLines={1}
                  >
                    {user.username}
                  </Text>
                  <X size={14} color="#999" />
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Text className="text-xs text-muted-foreground mt-2">
            {selectedUsers.length}/{MAX_GROUP_MEMBERS - 1} selected (min 2, max{" "}
            {MAX_GROUP_MEMBERS - 1})
          </Text>
        </View>
      )}

      {/* Search */}
      <View className="px-4 py-3 border-b border-border">
        <View className="flex-row items-center bg-secondary rounded-xl px-3">
          <Search size={20} color="#666" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search users..."
            placeholderTextColor="#666"
            className="flex-1 h-11 ml-2 text-foreground text-base"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={12}>
              <X size={20} color="#666" />
            </Pressable>
          )}
        </View>
      </View>

      {/* User List */}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Text className="px-4 pt-4 pb-2 text-muted-foreground text-sm font-semibold">
          Select Participants
        </Text>
        {isLoading ? (
          <View className="p-8 items-center">
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : (
          <>
            {filteredUsers.map((user) => {
              const selected = isUserSelected(user.id);
              return (
                <Pressable
                  key={user.id}
                  onPress={() => toggleUserSelection(user)}
                  className="flex-row items-center gap-3 px-4 py-3"
                >
                  <Image
                    source={{ uri: user.avatar }}
                    className="w-[50px] h-[50px] rounded-xl"
                  />
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-foreground">
                      {user.username}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      {user.name}
                    </Text>
                  </View>
                  <View
                    className={`w-6 h-6 rounded-full border-2 items-center justify-center ${
                      selected
                        ? "bg-primary border-primary"
                        : "border-muted-foreground"
                    }`}
                  >
                    {selected && <Check size={14} color="#fff" />}
                  </View>
                </Pressable>
              );
            })}
            {filteredUsers.length === 0 && !isLoading && (
              <View className="p-8 items-center">
                <Text className="text-muted-foreground">
                  {searchQuery ? "No users found" : "No users available"}
                </Text>
              </View>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export default function NewGroupScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="NewGroup" onGoBack={() => router.back()}>
      <NewGroupScreenContent />
    </ErrorBoundary>
  );
}
