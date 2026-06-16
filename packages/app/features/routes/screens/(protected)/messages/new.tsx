import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ArrowLeft, Search, X } from "lucide-react-native";
import { Image } from "expo-image";
import { useNewMessageStore } from "@dvnt/app/lib/stores/comments-store";
import { useCallback, useState } from "react";
import { useSearchUsers } from "@dvnt/app/lib/hooks/use-search";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { getOrCreateConversationCached } from "@dvnt/app/lib/hooks/use-conversation-resolution";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

function NewMessageScreenContent() {
  const router = useRouter();
  const { searchQuery, setSearchQuery } = useNewMessageStore();
  const currentUser = useAuthStore((state) => state.user);
  const showToast = useUIStore((s) => s.showToast);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  // Fetch all users when no search query
  const { data: allUsersData, isLoading: isLoadingAll } = useQuery({
    queryKey: ["users", "all"],
    queryFn: async () => {
      try {
        const result = await usersApi.searchUsers("", 50);
        // Filter out current user
        return result.docs.filter((user: any) => user.id !== currentUser?.id);
      } catch (error) {
        console.error("[NewMessage] Error fetching users:", error);
        return [];
      }
    },
    enabled: !searchQuery || searchQuery.length === 0,
  });

  // Search users when there's a query
  const { data: searchUsersData, isLoading: isLoadingSearch } = useSearchUsers(
    searchQuery || "",
  );

  const isLoading = searchQuery ? isLoadingSearch : isLoadingAll;
  const allUsers = searchQuery
    ? searchUsersData?.docs || []
    : allUsersData || [];

  // Filter out current user and transform to component format
  const filteredUsers = allUsers
    .filter((user: any) => user.id !== currentUser?.id)
    .map((user: any) => ({
      id: String(user.id || ""),
      username: (user.username as string) || "unknown",
      name: (user.name as string) || (user.username as string) || "User",
      avatar: (user.avatar as string) || "",
    }));

  const queryClient = useQueryClient();

  // FIXED: Create or get conversation BEFORE navigating to chat
  const handleSelectUser = useCallback(
    async (username: string) => {
      if (isCreatingConversation) return;

      setIsCreatingConversation(true);
      try {
        console.log(
          "[NewMessage] Creating/getting conversation with username:",
          username,
        );

        // Get or create conversation with selected user (cached)
        // CRITICAL: Pass username, not numeric user.id
        const conversationId = await getOrCreateConversationCached(
          queryClient,
          username,
        );

        if (conversationId) {
          console.log(
            "[NewMessage] Navigating to conversation:",
            conversationId,
          );
          // Navigate with conversation ID, not user ID
          router.replace(`/(protected)/chat/${conversationId}`);
        } else {
          showToast("error", "Error", "Could not start conversation");
        }
      } catch (error) {
        console.error("[NewMessage] Error creating conversation:", error);
        showToast("error", "Error", "Failed to start conversation");
      } finally {
        setIsCreatingConversation(false);
      }
    },
    [router, isCreatingConversation, showToast, queryClient],
  );
  const handleProfilePress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      router.push(`/(protected)/profile/${username}`);
    },
    [router, queryClient],
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
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
          New Message
        </Text>
      </View>

      <View className="px-4 py-3 border-b border-border">
        <View className="flex-row items-center bg-secondary rounded-xl px-3">
          <Search size={20} color="#666" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search users..."
            placeholderTextColor="#666"
            autoFocus
            className="flex-1 h-11 ml-2 text-foreground text-base"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={12}>
              <X size={20} color="#666" />
            </Pressable>
          )}
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Text className="px-4 pt-4 pb-2 text-muted-foreground text-sm font-semibold">
          {searchQuery ? "Search Results" : "All Users"}
        </Text>
        {isLoading ? (
          <View className="p-8 items-center">
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : (
          <>
            {filteredUsers.map((user) => (
              <View
                key={user.id}
                className="flex-row items-center gap-3 px-4 py-3"
              >
                <Pressable onPress={() => handleProfilePress(user.username)}>
                  <Image
                    source={{ uri: user.avatar }}
                    className="w-[50px] h-[50px] rounded-full"
                  />
                </Pressable>
                <Pressable
                  onPress={() => handleSelectUser(user.username)}
                  className="flex-1"
                >
                  <Pressable onPress={() => handleProfilePress(user.username)}>
                    <Text className="text-base font-semibold text-foreground">
                      {user.username}
                    </Text>
                  </Pressable>
                  <Text className="text-sm text-muted-foreground">
                    {user.name}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => handleSelectUser(user.username)}
                  className="bg-primary px-4 py-2 rounded-full"
                >
                  <Text className="text-white font-semibold text-sm">
                    Message
                  </Text>
                </Pressable>
              </View>
            ))}
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

export default function NewMessageScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="NewMessage" onGoBack={() => router.back()}>
      <NewMessageScreenContent />
    </ErrorBoundary>
  );
}
