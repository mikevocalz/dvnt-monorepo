import { View, Text, ScrollView, Pressable } from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { Archive } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useLayoutEffect } from "react";

export default function ArchivedScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Archived",
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

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="flex-1 items-center justify-center px-8 py-20">
            <View className="mb-4 rounded-full bg-secondary/50 p-4">
              <Archive size={48} color="#666" />
            </View>
            <Text className="mb-2 text-lg font-semibold text-foreground">
              No Archived Posts
            </Text>
            <Text className="text-center text-sm text-muted-foreground">
              When you archive posts, they'll appear here. Only you can see
              archived posts.
            </Text>
          </View>

          <View className="mt-2 px-4 pb-8">
            <View className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <Text className="text-center text-sm text-muted-foreground">
                Post archiving is coming soon. You'll be able to hide posts from
                your profile without deleting them.
              </Text>
            </View>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
