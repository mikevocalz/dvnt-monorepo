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
import { UserX } from "lucide-react-native";
import { useLayoutEffect } from "react";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { Image } from "expo-image";
import {
  useBlockedUsers,
  useUnblockUser,
  type BlockedUser,
} from "@dvnt/app/lib/hooks/use-blocks";
// CDN URL with production fallback
const CDN_URL =
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL || "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null): string {
  if (!avatar) return "/dvnt-email-glyph.png";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

function BlockedUserRow({
  user,
  onUnblock,
  isUnblocking,
}: {
  user: BlockedUser;
  onUnblock: () => void;
  isUnblocking: boolean;
}) {
  const router = useRouter();
  const { colors } = useColorScheme();

  return (
    <Pressable
      onPress={() => router.push(`/(protected)/user/${user.username}` as any)}
      className="mb-3 flex-row items-center rounded-xl border border-border bg-card p-3 active:bg-secondary/30"
    >
      <Image
        source={{ uri: getAvatarUrl(user.avatar) }}
        style={{ width: 48, height: 48, borderRadius: 12 }}
        contentFit="cover"
      />
      <View className="ml-3 flex-1">
        <Text className="font-semibold text-foreground">{user.name}</Text>
        <Text className="text-sm text-muted-foreground">@{user.username}</Text>
      </View>
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onUnblock();
        }}
        disabled={isUnblocking}
        className="rounded-lg bg-secondary px-4 py-2 active:bg-secondary/70"
      >
        {isUnblocking ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : (
          <Text className="font-semibold text-foreground">Unblock</Text>
        )}
      </Pressable>
    </Pressable>
  );
}

export default function BlockedScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { data: blockedUsers, isLoading, error, refetch } = useBlockedUsers();
  const unblockMutation = useUnblockUser();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Blocked Accounts",
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
      headerRight: () => <SettingsCloseButton />,
    });
  }, [navigation, colors]);

  const handleUnblock = (blockId: string) => {
    unblockMutation.mutate(blockId);
  };

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <View className="flex-1 items-center justify-center py-20">
              <ActivityIndicator size="large" color={colors.primary} />
              <Text className="mt-4 text-muted-foreground">
                Loading blocked accounts...
              </Text>
            </View>
          ) : !blockedUsers || blockedUsers.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8 py-20">
              <View className="mb-4 rounded-full bg-secondary/50 p-4">
                <UserX size={48} color="#666" />
              </View>
              <Text className="mb-2 text-lg font-semibold text-foreground">
                No Blocked Accounts
              </Text>
              <Text className="text-center text-sm text-muted-foreground">
                When you block someone, they won't be able to find your profile,
                posts, or stories.
              </Text>
            </View>
          ) : (
            <View className="px-4 py-4">
              <Text className="mb-3 text-sm font-medium text-muted-foreground">
                {blockedUsers.length} BLOCKED{" "}
                {blockedUsers.length === 1 ? "ACCOUNT" : "ACCOUNTS"}
              </Text>
              {blockedUsers.map((user) => (
                <BlockedUserRow
                  key={user.blockId}
                  user={user}
                  onUnblock={() => handleUnblock(user.blockId)}
                  isUnblocking={
                    unblockMutation.isPending &&
                    unblockMutation.variables === user.blockId
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      </Main>
    </View>
  );
}
