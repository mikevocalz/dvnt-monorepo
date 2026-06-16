import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { Star, Users, UserPlus } from "lucide-react-native";
import { useLayoutEffect } from "react";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { Image } from "expo-image";
import {
  useCloseFriendsList,
  useToggleCloseFriend,
} from "@dvnt/app/lib/hooks/use-close-friends";
import * as Haptics from "expo-haptics";

const CF_ACCENT = "#FC253A";

export default function CloseFriendsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { data: closeFriends = [], isLoading } = useCloseFriendsList();
  const toggleMutation = useToggleCloseFriend();

  const handleRemove = (friendId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleMutation.mutate({ friendId, isCloseFriend: true });
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Close Friends",
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerTintColor: colors.foreground,
      headerStyle: { backgroundColor: colors.background },
      headerTitleStyle: {
        color: colors.foreground,
        fontWeight: "600" as const,
        fontSize: 17,
      },
      headerShadowVisible: false,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={() => router.push("/(protected)/close-friends" as any)}
            hitSlop={12}
          >
            <UserPlus size={22} color={CF_ACCENT} />
          </Pressable>
          <SettingsCloseButton />
        </View>
      ),
    });
  }, [navigation, colors, router]);

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="px-4 py-4">
            <View
              className="mb-4 flex-row items-center gap-3 rounded-lg p-4"
              style={{ backgroundColor: "rgba(252, 37, 58, 0.1)" }}
            >
              <Star size={24} color={CF_ACCENT} fill={CF_ACCENT} />
              <View className="flex-1">
                <Text className="font-semibold text-foreground">
                  Close Friends
                </Text>
                <Text className="text-sm text-muted-foreground">
                  Share stories exclusively with your close friends
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => router.push("/(protected)/close-friends" as any)}
              className="mb-4 flex-row items-center justify-center gap-2 rounded-xl py-3"
              style={{ backgroundColor: CF_ACCENT }}
            >
              <UserPlus size={18} color="#fff" />
              <Text className="font-semibold text-white">
                Manage Close Friends
              </Text>
            </Pressable>
          </View>

          {isLoading ? (
            <View className="flex-1 items-center justify-center py-20">
              <ActivityIndicator size="large" color={CF_ACCENT} />
            </View>
          ) : closeFriends.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8 py-20">
              <View className="mb-4 rounded-full bg-secondary/50 p-4">
                <Users size={48} color="#666" />
              </View>
              <Text className="mb-2 text-lg font-semibold text-foreground">
                No Close Friends Yet
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                Tap "Manage Close Friends" to search and add people to your
                close friends list.
              </Text>
            </View>
          ) : (
            <View className="px-4">
              <Text className="mb-3 text-sm font-semibold text-muted-foreground">
                {closeFriends.length} CLOSE{" "}
                {closeFriends.length === 1 ? "FRIEND" : "FRIENDS"}
              </Text>

              {closeFriends.map((friend) => (
                <Pressable
                  key={friend.id}
                  onPress={() =>
                    router.push(
                      `/(protected)/profile/${friend.username}` as any,
                    )
                  }
                  className="mb-3 flex-row items-center rounded-lg border border-border bg-card p-3 active:bg-secondary/30"
                >
                  <Image
                    source={{
                      uri: friend.avatar || "",
                    }}
                    style={{ width: 48, height: 48, borderRadius: 24 }}
                    contentFit="cover"
                  />
                  <View className="ml-3 flex-1">
                    <Text className="font-semibold text-foreground">
                      {friend.name}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      @{friend.username}
                    </Text>
                  </View>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      handleRemove(friend.id);
                    }}
                    className="rounded-full p-2"
                    style={{ backgroundColor: "rgba(252, 37, 58, 0.15)" }}
                  >
                    <Star size={18} color={CF_ACCENT} fill={CF_ACCENT} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}

          <View className="mt-6 px-4 pb-8">
            <Text className="text-center text-sm text-muted-foreground">
              People won't be notified when you add or remove them from your
              close friends list.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
