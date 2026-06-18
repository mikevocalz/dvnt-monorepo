/**
 * App slide-over navigation drawer (NATIVE).
 *
 * A real gesture-driven slide-over: the panel translates in from the left over a
 * fading scrim, can be swiped away, and closes on scrim tap or selecting an
 * item. Mounted ONCE in the protected layout (a sibling of the navigation Stack,
 * like the weather overlay) and driven by the global `useDrawerStore`; the
 * hamburger in the tab header just flips that store.
 *
 * Surfaces destinations that aren't bottom-tabs — Blog, Search, Messages,
 * Tickets, Settings — so the blog is reachable on mobile.
 */
import { useEffect } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import {
  BookOpen,
  Search,
  MessageSquare,
  Ticket,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react-native";
import Logo from "@dvnt/app/components/logo";
import { useDrawerStore } from "@dvnt/app/lib/stores/drawer-store";

const C = {
  fg: "#f5f5f4",
  muted: "#a3a3a3",
  faint: "#737373",
  cyan: "#3FDCFF",
  purple: "#8A40CF",
  panel: "#0B0B0F",
  hairline: "rgba(255,255,255,0.08)",
};

type NavItem = { label: string; href: string; Icon: LucideIcon };

const ITEMS: NavItem[] = [
  { label: "Blog", href: "/(protected)/blog", Icon: BookOpen },
  { label: "Search", href: "/(protected)/search", Icon: Search },
  { label: "Messages", href: "/(protected)/messages", Icon: MessageSquare },
  { label: "My Tickets", href: "/(protected)/events/my-tickets", Icon: Ticket },
  { label: "Settings", href: "/settings", Icon: Settings },
];

export function AppDrawer() {
  const open = useDrawerStore((s) => s.open);
  const closeDrawer = useDrawerStore((s) => s.closeDrawer);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const panelWidth = Math.min(width * 0.8, 320);

  // progress: 0 = closed (off-screen left), 1 = fully open.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: 260 });
  }, [open, progress]);

  // Swipe-left-to-close gesture on the panel.
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      const next = 1 + e.translationX / panelWidth; // dragging left lowers it
      progress.value = Math.max(0, Math.min(1, next));
    })
    .onEnd((e) => {
      const shouldClose = progress.value < 0.6 || e.velocityX < -500;
      if (shouldClose) {
        progress.value = withTiming(0, { duration: 200 }, (finished) => {
          if (finished) runOnJS(closeDrawer)();
        });
      } else {
        progress.value = withTiming(1, { duration: 180 });
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [-panelWidth, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // Fully unmount when closed so it never intercepts touches.
  if (!open) return null;

  const go = (href: string) => {
    closeDrawer();
    // Defer so the close animation/store update doesn't race the navigation.
    requestAnimationFrame(() => router.push(href as never));
  };

  return (
    <View style={{ position: "absolute", inset: 0, zIndex: 1000 }}>
      {/* Scrim */}
      <Animated.View style={[{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.6)" }, scrimStyle]}>
        <Pressable style={{ flex: 1 }} onPress={closeDrawer} accessibilityLabel="Close menu" />
      </Animated.View>

      {/* Panel */}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: panelWidth,
              backgroundColor: C.panel,
              borderRightWidth: 1,
              borderRightColor: C.hairline,
              paddingTop: insets.top + 14,
              paddingBottom: insets.bottom + 18,
              paddingHorizontal: 18,
            },
            panelStyle,
          ]}
        >
          {/* Head */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
            <Logo width={104} height={40} />
            <Pressable
              onPress={closeDrawer}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: C.hairline,
              }}
            >
              <X size={20} color={C.fg} />
            </Pressable>
          </View>

          {/* Items */}
          <View style={{ gap: 4 }}>
            {ITEMS.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => go(item.href)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 16,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: C.hairline,
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <item.Icon size={22} color={C.cyan} />
                <Text style={{ color: C.fg, fontSize: 19, fontWeight: "700" }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Footer */}
          <View style={{ flex: 1, justifyContent: "flex-end" }}>
            <Text style={{ color: C.faint, fontSize: 12, letterSpacing: 1, textAlign: "center" }}>
              connect. gather. move.
            </Text>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
