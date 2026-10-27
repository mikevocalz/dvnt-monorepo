import { Linking, Pressable, Text, View } from "react-native";

/** Local capture failure must not tear down the room's receiving transport. */
export function CaptureErrorBanner({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry?: () => void;
}) {
  if (!error) return null;
  return (
    <View accessibilityRole="alert" className="mx-3 mb-2 rounded-xl bg-surface p-3">
      <Text className="text-foreground font-semibold">Camera or microphone unavailable</Text>
      <Text className="mt-1 text-muted-foreground">{error}</Text>
      <Text className="mt-1 text-muted-foreground">You can stay in the room. Check device permissions, then retry.</Text>
      <View className="mt-2 flex-row gap-4">
        <Pressable accessibilityRole="button" accessibilityLabel="Retry camera and microphone" onPress={onRetry} hitSlop={8}>
          <Text className="text-primary font-semibold">Retry</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open device settings" onPress={() => { void Linking.openSettings().catch(() => {}); }} hitSlop={8}>
          <Text className="text-primary font-semibold">Open settings</Text>
        </Pressable>
      </View>
    </View>
  );
}
