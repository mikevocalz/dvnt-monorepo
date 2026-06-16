import { View, Pressable, Text, Platform } from "react-native";
import { Link, usePathname, useRouter } from "expo-router";
import { Search, MessageSquare } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import Logo from "@dvnt/app/components/logo";
import { useUnreadMessageCount } from "@dvnt/app/lib/hooks/use-messages";
import { useFeedScrollStore } from "@dvnt/app/lib/stores/feed-scroll-store";

export function TabHeaderLogo() {
  const pathname = usePathname();
  const triggerScrollToTop = useFeedScrollStore((s) => s.triggerScrollToTop);
  const isHome =
    pathname === "/" ||
    pathname === "/(protected)/(tabs)" ||
    pathname === "/(protected)/(tabs)/index" ||
    pathname === "/(public)/(tabs)" ||
    pathname === "/(public)/(tabs)/index";
  return (
    <Pressable
      onPress={() => {
        if (isHome) triggerScrollToTop();
      }}
      hitSlop={12}
    >
      <Logo width={100} height={36} />
    </Pressable>
  );
}

export function PublicTabHeaderRight() {
  const router = useRouter();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <Pressable
        onPress={() => router.push("/(auth)/login" as any)}
        hitSlop={12}
        style={{ paddingHorizontal: 6, paddingVertical: 6 }}
      >
        <Text
          style={{
            color: "rgba(255,255,255,0.8)",
            fontSize: 14,
            fontWeight: "700",
          }}
        >
          Sign in
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/(auth)/signup" as any)}
        hitSlop={12}
        style={{
          minHeight: 38,
          paddingHorizontal: 14,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fff",
        }}
      >
        <Text
          style={{
            color: "#000",
            fontSize: 13,
            fontWeight: "800",
          }}
        >
          Join
        </Text>
      </Pressable>
    </View>
  );
}

export function TabHeaderRight() {
  const { colors } = useColorScheme();
  const { data: unreadCount = 0 } = useUnreadMessageCount();
  return (
    <View style={{ marginRight: 16, flexDirection: "row", alignItems: "center", gap: 20 }}>
      <Link href="/(protected)/search" asChild>
        <Pressable
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Search"
          accessibilityHint="Opens the search screen"
          style={{ padding: 6 }}
        >
          <Search size={24} color={colors.foreground} />
        </Pressable>
      </Link>
      <Link href="/(protected)/messages" asChild>
        <Pressable
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Messages"
          accessibilityHint="Opens your messages inbox"
          style={{ padding: 6, position: "relative" }}
        >
          <MessageSquare size={24} color={colors.foreground} />
          {unreadCount > 0 && (
            <View
              style={{
                position: "absolute",
                right: 2,
                top: 2,
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: "#8A40CF",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: "700",
                  color: "#fff",
                }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Text>
            </View>
          )}
        </Pressable>
      </Link>
    </View>
  );
}
