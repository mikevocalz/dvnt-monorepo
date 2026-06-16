import { View, Platform } from "react-native";
import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Plus } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CenterButton } from "@dvnt/app/components/center-button";
import { usePublicGateStore } from "@dvnt/app/lib/stores/public-gate-store";

export default function PublicTabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const openGate = usePublicGateStore((s) => s.openGate);

  return (
    <View style={{ flex: 1 }}>
      <NativeTabs minimizeBehavior="never">
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon
            sf={{ default: "house", selected: "house.fill" }}
            md="home"
          />
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="events">
          <NativeTabs.Trigger.Icon
            sf={{ default: "calendar", selected: "calendar.badge.clock" }}
            md="calendar_month"
          />
          <NativeTabs.Trigger.Label>Events</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="create"
          listeners={{
            tabPress: () => {
              openGate("create");
            },
          }}
        >
          <NativeTabs.Trigger.Icon sf={{ default: "plus", selected: "plus" }} md="add" />
          <NativeTabs.Trigger.Label> </NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="activity"
          listeners={{
            tabPress: () => {
              openGate("activity");
            },
          }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "heart", selected: "heart.fill" }}
            md="favorite"
          />
          <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="profile"
          listeners={{
            tabPress: () => {
              openGate("profile");
            },
          }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "person", selected: "person.fill" }}
            md="person"
          />
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>

      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          bottom: Platform.OS === "ios" ? insets.bottom - 2 : 8,
          left: 0,
          right: 0,
          alignItems: "center",
          zIndex: 1000,
        }}
      >
        <View style={{ paddingHorizontal: 26 }}>
          <CenterButton
            Icon={Plus}
            onPress={() => openGate("create")}
            accessoryPlacement="inline"
          />
        </View>
      </View>
    </View>
  );
}
