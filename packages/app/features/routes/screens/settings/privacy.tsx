import { FollowRequestsPanel } from "@dvnt/app/features/settings/follow-requests-panel";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Main } from "@dvnt/app/components/ui/html";
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
import { LocationControls } from "@dvnt/app/features/settings/ui/LocationControls";
import { CityVisibilityCard } from "@dvnt/app/features/settings/ui/CityVisibilityCard";
import { CITY_VISIBILITY_COPY } from "@dvnt/app/lib/stores/city-discovery-visibility";

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

  if (error || !settings)
    return (
      <View className="flex-1 bg-background p-6">
        <Text className="text-foreground">
          Could not load privacy settings.
        </Text>
        <Pressable onPress={() => refetch()}>
          <Text className="text-primary">Retry</Text>
        </Pressable>
      </View>
    );

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
                  Page visibility
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Public: eligible adults must follow to see Spicy posts.
                  Private: you must approve their follow request first. Age and
                  access checks always apply.
                </Text>
              </View>
              <View accessibilityRole="radiogroup">
                {[false, true].map((isPrivate) => (
                  <Pressable
                    key={String(isPrivate)}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: settings.privateAccount === isPrivate,
                      disabled: updateMutation.isPending,
                    }}
                    disabled={updateMutation.isPending}
                    onPress={() => handleToggle("privateAccount", isPrivate)}
                    className="rounded-xl border border-border p-3"
                  >
                    <Text
                      className={
                        settings.privateAccount === isPrivate
                          ? "text-primary font-bold"
                          : "text-foreground"
                      }
                    >
                      {isPrivate ? "Private" : "Public"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
          <FollowRequestsPanel />
          <View className="mb-6 rounded-xl border border-border bg-card">
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

          <Text className="mb-2 px-1 text-sm font-semibold uppercase text-muted-foreground">
            {CITY_VISIBILITY_COPY.sectionTitle}
          </Text>
          <CityVisibilityCard />
          {updateMutation.isError && (
            <Text accessibilityRole="alert" className="text-foreground">
              Could not save visibility. Please try again.
            </Text>
          )}
          <LocationControls />

          <View className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Text className="text-sm text-muted-foreground">
              Changes apply after the server confirms they were saved.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
