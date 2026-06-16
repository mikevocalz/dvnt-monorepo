import { Stack } from "expo-router";
import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PublicTabHeaderRight, TabHeaderLogo } from "@dvnt/app/components/tab-header";

function PublicTabsHeader() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: "#000",
        paddingTop: insets.top,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <TabHeaderLogo />
      <PublicTabHeaderRight />
    </View>
  );
}

export default function PublicLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#000" },
      }}
    >
      <Stack.Screen
        name="(tabs)"
        options={{
          animation: "none",
          headerShown: true,
          header: () => <PublicTabsHeader />,
        }}
      />
      <Stack.Screen name="dev/location-picker" options={{ headerShown: false }} />
      <Stack.Screen name="dev/telemetry" options={{ headerShown: false }} />
      <Stack.Screen name="profile/[username]" options={{ headerShown: false }} />
      <Stack.Screen name="events/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="tickets/guest/[token]"
        options={{ headerShown: false }}
      />
      <Stack.Screen name="search" options={{ headerShown: false }} />
    </Stack>
  );
}
