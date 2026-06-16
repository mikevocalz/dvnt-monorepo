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
  useMessagesPrefs,
  useUpdateMessagesPrefs,
  type MessagesPrefs,
} from "@dvnt/app/lib/hooks/use-user-settings";

export default function MessagesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { data: prefs, isLoading } = useMessagesPrefs();
  const updateMutation = useUpdateMessagesPrefs();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Messages",
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

  const handleToggle = (key: keyof MessagesPrefs, value: boolean) => {
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
            WHO CAN MESSAGE YOU
          </Text>
          <View className="mb-6 rounded-lg border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Allow Messages from Everyone
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Anyone can send you messages directly
                </Text>
              </View>
              <Switch
                checked={prefs.allowAll}
                onCheckedChange={(v) => handleToggle("allowAll", v)}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Message Requests
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Receive requests from people you don't follow
                </Text>
              </View>
              <Switch
                checked={prefs.messageRequests}
                onCheckedChange={(v) => handleToggle("messageRequests", v)}
              />
            </View>
            <View className="mx-4 h-px bg-border" />
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Group Requests
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Allow others to add you to group chats
                </Text>
              </View>
              <Switch
                checked={prefs.groupRequests}
                onCheckedChange={(v) => handleToggle("groupRequests", v)}
              />
            </View>
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            MESSAGE SETTINGS
          </Text>
          <View className="mb-6 rounded-lg border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-4">
                <Text className="font-semibold text-foreground">
                  Read Receipts
                </Text>
                <Text className="mt-1 text-sm text-muted-foreground">
                  Show when you've read messages
                </Text>
              </View>
              <Switch
                checked={prefs.readReceipts}
                onCheckedChange={(v) => handleToggle("readReceipts", v)}
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
