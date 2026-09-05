import { View, Text } from "react-native";

interface ProfilePronounsPillProps {
  pronouns?: string | null;
  inline?: boolean;
}

export function ProfilePronounsPill({
  pronouns,
  inline = false,
}: ProfilePronounsPillProps) {
  const value = typeof pronouns === "string" ? pronouns.trim() : "";
  if (!value) return null;

  return (
    <View
      style={{
        alignSelf: inline ? undefined : "flex-start",
        marginTop: inline ? 0 : 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.1)",
        backgroundColor: "rgba(255,255,255,0.05)",
      }}
    >
      <Text
        style={{
          color: "rgba(245,245,244,0.84)",
          fontSize: 12,
          fontWeight: "600",
          letterSpacing: 0.2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
