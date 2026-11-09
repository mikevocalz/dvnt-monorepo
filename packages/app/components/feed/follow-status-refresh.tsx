import { View, Text, Pressable } from "react-native";
import { useFollowStatusRefresh } from "./use-follow-status-refresh";

export function FollowStatusRefresh({
  targetId,
  showError = true,
  recoverLockedPost = false,
}: {
  targetId?: string;
  showError?: boolean;
  recoverLockedPost?: boolean;
}) {
  const status = useFollowStatusRefresh(targetId, recoverLockedPost);
  if (status.data !== "pending" && !status.isError) return null;

  return (
    <View className="mt-2 items-center">
      {showError && status.isError && (
        <Text
          accessibilityRole="alert"
          className="text-center text-sm text-muted-foreground"
        >
          Could not check follow status. Please try again.
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: status.isFetching,
          busy: status.isFetching,
        }}
        disabled={status.isFetching}
        onPress={() => void status.refresh()}
        className="min-h-11 justify-center rounded-lg px-3 disabled:opacity-50"
      >
        <Text className="text-sm text-primary">
          {status.isFetching
            ? "Checking…"
            : status.isError
              ? "Retry follow status"
              : "Check request status"}
        </Text>
      </Pressable>
    </View>
  );
}
