import { BlurView } from "expo-blur";
import { View, Text, Pressable } from "react-native";
import { FollowStatusRefresh } from "./follow-status-refresh";
import { useSpicyFollowGate } from "./use-spicy-follow-gate";
export function SpicyFollowGate({
  author,
  height = 240,
}: {
  author?: { id?: string; username?: string; avatar?: string };
  postId?: string;
  presentation?: "card" | "feed";
  height?: number;
}) {
  const gate = useSpicyFollowGate(author);
  return (
    <View
      accessibilityLabel="Protected Spicy post"
      style={{
        minHeight: height,
        borderRadius: 16,
        padding: 16,
        backgroundColor: "#20172e",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        overflow: "hidden",
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: 160,
          height: 160,
          borderRadius: 80,
          backgroundColor: "#58336d",
          opacity: 0.16,
          top: -60,
          left: -40,
        }}
      />
      <BlurView
        pointerEvents="none"
        intensity={60}
        tint="dark"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>
        Request to FOLLOW
      </Text>
      <Text style={{ color: "#d3c9dd", fontSize: 12, textAlign: "center" }}>
        {gate.note}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: gate.disabled }}
        disabled={gate.disabled}
        onPress={gate.act}
        style={{
          borderWidth: 1,
          borderColor: "#ffffff55",
          borderRadius: 24,
          padding: 12,
          opacity: gate.disabled ? 0.4 : 1,
        }}
      >
        <Text style={{ color: "white", fontWeight: "600" }}>{gate.label}</Text>
      </Pressable>
      <FollowStatusRefresh
        targetId={author?.id}
        showError={false}
        recoverLockedPost
      />
      {gate.failed && (
        <Text
          accessibilityRole="alert"
          style={{ color: "white", fontSize: 12 }}
        >
          Could not update follow. Please try again.
        </Text>
      )}
    </View>
  );
}
