import { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { useLocalSearchParams, router } from "expo-router";

export default function VideoRoomRedirectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  useEffect(() => {
    if (!id) return;
    router.replace({
      pathname: "/(protected)/sneaky-lynk/room/[id]",
      params: { id },
    } as any);
  }, [id]);

  return (
    <View className="flex-1 bg-background items-center justify-center px-6">
      <ActivityIndicator size="large" color="#FC253A" />
      <Text className="text-muted-foreground mt-4 text-center">
        Opening Lynk
      </Text>
    </View>
  );
}
