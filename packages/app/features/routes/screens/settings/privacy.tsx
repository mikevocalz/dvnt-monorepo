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
  usePrivacySettings,
  useUpdatePrivacySettings,
  type PrivacySettings,
} from "@dvnt/app/lib/hooks/use-user-settings";

export default function PrivacyScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { data: settings, isLoading, error, refetch } = usePrivacySettings();
  const updateMutation = useUpdatePrivacySettings();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Privacy",
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

  const handleToggle = (key: keyof PrivacySettings, value: boolean) => {
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
                <Text className="font-semibold text-foreground">
                  Private Account
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Only approved followers can see your posts
                </Text>
              </View>
              <Switch
                checked={settings?.privateAccount ?? false}
                onCheckedChange={(value) =>
                  handleToggle("privateAccount", value)
                }
              />
            </View>

            <View className="mx-4 h-px bg-border" />

            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Activity Status
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Show when you were last active
                </Text>
              </View>
              <Switch
                checked={settings?.activityStatus ?? true}
                onCheckedChange={(value) =>
                  handleToggle("activityStatus", value)
                }
              />
            </View>

            <View className="mx-4 h-px bg-border" />

            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Read Receipts
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Let others know when you've read their messages
                </Text>
              </View>
              <Switch
                checked={settings?.readReceipts ?? true}
                onCheckedChange={(value) => handleToggle("readReceipts", value)}
              />
            </View>

            <View className="mx-4 h-px bg-border" />

            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Show Likes Count
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Display like counts on your posts
                </Text>
              </View>
              <Switch
                checked={settings?.showLikes ?? true}
                onCheckedChange={(value) => handleToggle("showLikes", value)}
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
