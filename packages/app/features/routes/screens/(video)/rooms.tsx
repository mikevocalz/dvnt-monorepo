import { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { router } from "expo-router";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";

export default function VideoRoomsRedirectScreen() {
  useEffect(() => {
    router.replace({
      pathname: "/(protected)/messages",
      params: { tab: "lynk" },
    } as any);
  }, []);

  return (
    <View className="flex-1 bg-background items-center justify-center px-6">
      <ActivityIndicator size="large" color="#FC253A" />
      <Text className="text-muted-foreground mt-4 text-center">
        Redirecting to {getLynkDisplayName()}
      </Text>
    </View>
  );
}
