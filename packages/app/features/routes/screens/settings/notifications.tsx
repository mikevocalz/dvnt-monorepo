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
import { useLayoutEffect } from "react";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { Switch } from "@dvnt/app/components/ui/switch";
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
  type NotificationPrefs,
} from "@dvnt/app/lib/hooks/use-user-settings";

export default function NotificationsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { data: prefs, isLoading, error, refetch } = useNotificationPrefs();
  const updateMutation = useUpdateNotificationPrefs();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Push Notifications",
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

  const handleToggle = (key: keyof NotificationPrefs, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Main className="flex-1">
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text className="mt-4 text-muted-foreground">
              Loading settings...
            </Text>
          </View>
        </Main>
      </View>
    );
  }

  const pauseAll = prefs?.pauseAll ?? false;

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView
          className="flex-1 px-4 py-6"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-6 rounded-xl border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">Pause All</Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Temporarily pause all notifications
                </Text>
              </View>
              <Switch
                checked={pauseAll}
                onCheckedChange={(value) => handleToggle("pauseAll", value)}
              />
            </View>
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            INTERACTIONS
          </Text>
          <View className="mb-6 rounded-xl border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">Likes</Text>
              <Switch
                checked={prefs?.likes ?? true}
                onCheckedChange={(value) => handleToggle("likes", value)}
                disabled={pauseAll}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">Comments</Text>
              <Switch
                checked={prefs?.comments ?? true}
                onCheckedChange={(value) => handleToggle("comments", value)}
                disabled={pauseAll}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">New Followers</Text>
              <Switch
                checked={prefs?.follows ?? true}
                onCheckedChange={(value) => handleToggle("follows", value)}
                disabled={pauseAll}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">Mentions</Text>
              <Switch
                checked={prefs?.mentions ?? true}
                onCheckedChange={(value) => handleToggle("mentions", value)}
                disabled={pauseAll}
              />
            </View>
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            MESSAGES
          </Text>
          <View className="mb-6 rounded-xl border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">
                Direct Messages
              </Text>
              <Switch
                checked={prefs?.messages ?? true}
                onCheckedChange={(value) => handleToggle("messages", value)}
                disabled={pauseAll}
              />
            </View>
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            OTHER
          </Text>
          <View className="mb-6 rounded-xl border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">Live Videos</Text>
              <Switch
                checked={prefs?.liveVideos ?? false}
                onCheckedChange={(value) => handleToggle("liveVideos", value)}
                disabled={pauseAll}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <Text className="font-medium text-foreground">
                Email Notifications
              </Text>
              <Switch
                checked={prefs?.emailNotifications ?? false}
                onCheckedChange={(value) =>
                  handleToggle("emailNotifications", value)
                }
              />
            </View>
          </View>

          <View className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Text className="text-sm text-muted-foreground">
              Changes are saved automatically and will apply immediately.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
