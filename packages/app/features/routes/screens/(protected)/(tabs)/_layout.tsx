import { View, Platform } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Plus } from "lucide-react-native";
import { CenterButton } from "@dvnt/app/components/center-button";
import {
  SpicyToggleFAB,
  supportsNativeTabsBottomAccessory,
} from "@dvnt/app/components/spicy-toggle-fab";
import { useFeedScrollStore } from "@dvnt/app/lib/stores/feed-scroll-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "@dvnt/app/lib/perf/tab-prefetches"; // Register prefetch functions for tab navigation
import { color } from "@dvnt/app/lib/theme";

function isHomeTabPathname(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/index" ||
    pathname === "/(protected)/(tabs)" ||
    pathname === "/(protected)/(tabs)/index"
  );
}

function HomeSpicyToggleAccessory() {
  const pathname = usePathname();
  const placement = NativeTabs.BottomAccessory.usePlacement();

  if (!isHomeTabPathname(pathname)) {
    return null;
  }

  return <SpicyToggleFAB accessoryPlacement={placement} />;
}

export default function TabsLayout() {
  const triggerScrollToTop = useFeedScrollStore((s) => s.triggerScrollToTop);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const supportsBottomAccessory = supportsNativeTabsBottomAccessory();
  // iPadOS renders native tabs as a TOP bar, so the bottom-anchored
  // CenterButton overlay ends up orphaned mid-screen with nothing under it —
  // and the create trigger's deliberately blank label (blank because the
  // overlay covers it on iPhone) renders as an empty gap in the label-only
  // top bar. On iPad: no overlay, real label, create lives in the top bar
  // like its siblings.
  const isPad = Platform.OS === "ios" && Platform.isPad;

  return (
    // Dark-only, same reason as the NativeTabs backgroundColor below: with no
    // background this wrapper falls through to the system appearance, so on a
    // Light-appearance device it painted WHITE. Invisible on a phone, where the
    // content column fills the screen — but every tab screen caps itself
    // (SCREEN_SHELL: max-w-4xl, self-center), so on iPad the gutters either side
    // column were white panels instead of the app background.
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <NativeTabs
      minimizeBehavior="onScrollDown"
      // Dark-only: the underlying UITabBar / BottomNavigationView follows
      // system appearance unless told otherwise, so it rendered as a light
      // bar with dark labels on a Light-appearance device.
      backgroundColor="#000"
      blurEffect="systemChromeMaterialDark"
      tintColor="#FFFFFF"
    >
        {supportsBottomAccessory ? (
          <NativeTabs.BottomAccessory>
            <HomeSpicyToggleAccessory />
          </NativeTabs.BottomAccessory>
        ) : null}
        <NativeTabs.Trigger
          name="index"
          listeners={{
            tabPress: () => {
              triggerScrollToTop();
            },
          }}
        >
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
              router.push("/(protected)/(tabs)/create");
            },
          }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "plus", selected: "plus" }}
            md="add"
          />
          {/* Blank on iPhone: the CenterButton overlay covers this slot. */}
          <NativeTabs.Trigger.Label>
            {isPad ? "Create" : " "}
          </NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="activity">
          <NativeTabs.Trigger.Icon
            sf={{ default: "heart", selected: "heart.fill" }}
            md="favorite"
          />
          <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon
            sf={{ default: "person", selected: "person.fill" }}
            md="person"
          />
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>

      {/* Custom CenterButton overlaid on top of the native "create" tab icon.
          iPhone only — on iPad the tab bar is at the TOP, so the native
          "Create" item (label above) is the create affordance and this
          bottom-anchored overlay would float over the feed with no bar. */}
      {!isPad && (
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
              onPress={() => router.push("/(protected)/(tabs)/create")}
              accessoryPlacement="inline"
            />
          </View>
        </View>
      )}
    </View>
  );
}
