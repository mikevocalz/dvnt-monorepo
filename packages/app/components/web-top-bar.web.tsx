/**
 * Web top bar (mobile only). The desktop shell uses the left rail; phones got a
 * bottom WebTabBar but NO header — the logged-in app had no top chrome at all.
 * This is the IG/X-style mobile header: DVNT logo (→ home) on the left, Search +
 * Messages actions on the right (neither lives in the bottom tab bar). Sticky +
 * liquid-glass + safe-area aware, matching WebTabBar.
 */
import { Pressable, View, StyleSheet } from "react-native";
import { Header } from "@dvnt/app/components/ui/html";
import { useRouter } from "solito/navigation";
import { Search, BookOpen, MessageCircle } from "lucide-react";
import Logo from "@dvnt/app/components/logo";
import { UnreadBadge } from "./unread-badge";
import { useUnreadMessageCount } from "@dvnt/app/lib/hooks/use-messages";
import { unreadAccessibilityLabel } from "@dvnt/app/lib/badges/unread-badge";

// Web-only style props (position:sticky, backdrop-filter, env()) cast via `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const web = (s: Record<string, unknown>) => s as any;

export function WebTopBar() {
  const router = useRouter();
  const { data: unreadCount } = useUnreadMessageCount();
  return (
    <Header style={styles.wrap} aria-label="App header">
      <Pressable
        onPress={() => router.push("/feed")}
        accessibilityRole="button"
        accessibilityLabel="DVNT home"
      >
        <Logo width={78} height={30} />
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push("/feed/search")}
          accessibilityRole="button"
          accessibilityLabel="Search"
          style={styles.iconBtn}
        >
          <Search size={23} strokeWidth={2} color="#FFFFFF" />
        </Pressable>
        <Pressable
          onPress={() => router.push("/blog")}
          accessibilityRole="button"
          accessibilityLabel="Blog"
          style={styles.iconBtn}
        >
          <BookOpen size={23} strokeWidth={2} color="#FFFFFF" />
        </Pressable>
        <Pressable
          onPress={() => router.push("/feed/messages")}
          accessibilityRole="button"
          accessibilityLabel={unreadAccessibilityLabel("Messages", unreadCount)}
          style={styles.iconBtn}
        >
          <View style={{ position: "relative" }}>
            <MessageCircle size={23} strokeWidth={2} color="#FFFFFF" />
            <UnreadBadge count={unreadCount} />
          </View>
        </Pressable>
      </View>
    </Header>
  );
}

const styles = StyleSheet.create({
  wrap: web({
    position: "sticky",
    top: 0,
    zIndex: 1000,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: "calc(env(safe-area-inset-top) + 10px)",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(8,10,18,0.72)",
    backdropFilter: "saturate(170%) blur(18px)",
    WebkitBackdropFilter: "saturate(170%) blur(18px)",
  }),
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
