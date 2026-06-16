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
  useLikesCommentsPrefs,
  useUpdateLikesCommentsPrefs,
  type LikesCommentsPrefs,
} from "@dvnt/app/lib/hooks/use-user-settings";

export default function LikesCommentsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { data: prefs, isLoading } = useLikesCommentsPrefs();
  const updateMutation = useUpdateLikesCommentsPrefs();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Likes and Comments",
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

  const handleToggle = (key: keyof LikesCommentsPrefs, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Main className="flex-1">
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary} />
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
          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            LIKES
          </Text>
          <View className="mb-6 rounded-lg border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Hide Like Counts
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Hide like counts on posts from others
                </Text>
              </View>
              <Switch
                checked={prefs.hideLikeCounts}
                onCheckedChange={(v) => handleToggle("hideLikeCounts", v)}
              />
            </View>
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            COMMENTS
          </Text>
          <View className="mb-6 rounded-lg border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Allow Comments
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Let others comment on your posts
                </Text>
              </View>
              <Switch
                checked={prefs.allowComments}
                onCheckedChange={(v) => handleToggle("allowComments", v)}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Filter Offensive Comments
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Hide comments that may be offensive
                </Text>
              </View>
              <Switch
                checked={prefs.filterComments}
                onCheckedChange={(v) => handleToggle("filterComments", v)}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Manual Filter
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Hide comments with specific words
                </Text>
              </View>
              <Switch
                checked={prefs.manualFilter}
                onCheckedChange={(v) => handleToggle("manualFilter", v)}
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
