import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";

export function SettingsCloseButton() {
  const router = useRouter();
  const { colors } = useColorScheme();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      style={{
        marginRight: 8,
        padding: 4,
      }}
    >
      <X size={18} color={colors.foreground} strokeWidth={2.5} />
    </Pressable>
  );
}
