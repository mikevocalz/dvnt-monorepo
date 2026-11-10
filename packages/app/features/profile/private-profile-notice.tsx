import { View, Text } from "react-native";
import { privateProfilePresentation } from "@dvnt/app/lib/profile/private-profile";

export function PrivateProfileNotice({ pending = false }: { pending?: boolean }) {
  const copy = privateProfilePresentation({ isPrivate: true, requestPending: pending });
  return (
    <View accessibilityLabel="Private account" className="items-center gap-3 px-6 py-16">
      <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{copy.title}</Text>
      <Text className="text-center text-sm text-muted-foreground">{copy.message}</Text>
    </View>
  );
}
