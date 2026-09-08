/**
 * The drawer panel.
 *
 * Identity at the top, then the destinations that are genuinely product
 * surfaces, then account. My Tickets sits first because reaching a pass fast is
 * the thing this menu exists to make possible.
 *
 * Rows come from `drawer-destinations.ts`, which only ever emits routes that
 * exist. Rows the brief asked for that have no destination are recorded there
 * as struck, with the blocker, rather than rendered as dead ends.
 */

import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ChevronRight, Ticket } from "lucide-react-native";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useDrawerStore } from "@dvnt/app/lib/stores/drawer-store";
import { useMyTickets } from "@dvnt/app/lib/hooks/use-tickets";
import {
  buildTicketLibrary,
  libraryCounts,
  nextEventShortcut,
} from "@dvnt/app/lib/tickets/ticket-library";
import { ticketPath } from "@dvnt/app/lib/tickets/ticket-identity";
import { getHostDashboard } from "@dvnt/app/lib/api/privileged";
import { color, radius } from "@dvnt/app/lib/theme";
import {
  buildDrawerSections,
  type DrawerRow,
} from "./drawer-destinations";

function DrawerRowView({
  row,
  onPress,
}: {
  row: DrawerRow;
  onPress: (row: DrawerRow) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="link"
      accessibilityLabel={
        row.detail ? `${row.label}. ${row.detail}` : row.label
      }
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: pressed ? color.surface2 : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: color.text, fontSize: 16, fontWeight: "600" }}
          numberOfLines={1}
        >
          {row.label}
        </Text>
        {row.detail ? (
          <Text
            style={{ color: color.textDim, fontSize: 12, marginTop: 2 }}
            numberOfLines={1}
          >
            {row.detail}
          </Text>
        ) : null}
      </View>
      {row.badge ? (
        <View
          style={{
            minWidth: 22,
            height: 22,
            paddingHorizontal: 6,
            borderRadius: radius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: color.violet,
          }}
        >
          <Text style={{ color: color.text, fontSize: 11, fontWeight: "800" }}>
            {row.badge > 99 ? "99+" : row.badge}
          </Text>
        </View>
      ) : null}
      <ChevronRight size={18} color={color.textFaint} />
    </Pressable>
  );
}

export function AppDrawerContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const closeDrawer = useDrawerStore((s) => s.closeDrawer);
  const user = useAuthStore((s) => s.user);

  const tickets = useMyTickets();
  const library = useMemo(
    () => buildTicketLibrary(tickets.data ?? []),
    [tickets.data],
  );
  const counts = libraryCounts(library);
  const shortcut = nextEventShortcut(library);
  const nextEvent = library.upcoming[0];

  /**
   * Hosting is a server-resolved capability: the dashboard endpoint returns the
   * events this account may manage. Comparing `user.id` to `event.host_id` on
   * the client would show the row to anyone whose id happened to match a
   * cached shape.
   */
  const hostDashboard = useQuery({
    queryKey: ["host-dashboard", user?.id ?? "anon"],
    queryFn: getHostDashboard,
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
  const canHost =
    (hostDashboard.data?.tonight.length ?? 0) +
      (hostDashboard.data?.upcoming.length ?? 0) +
      (hostDashboard.data?.drafts.length ?? 0) +
      (hostDashboard.data?.past.length ?? 0) >
    0;

  const sections = useMemo(
    () => buildDrawerSections({ canHost }, counts),
    [canHost, counts],
  );

  // Close first, then navigate. Two surfaces animating at once is how a drawer
  // ends up sitting open behind a pushed screen.
  const go = useCallback(
    (href: string) => {
      closeDrawer();
      router.push(href as never);
    },
    [closeDrawer, router],
  );

  const handleRow = useCallback((row: DrawerRow) => go(row.href), [go]);

  const handleShortcut = useCallback(() => {
    if (!shortcut) return;
    go(
      shortcut.kind === "ticket"
        ? ticketPath(shortcut.ticketId)
        : `/(protected)/ticket/${shortcut.eventId}`,
    );
  }, [go, shortcut]);

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 8,
          gap: 4,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity */}
        <Pressable
          onPress={() => go("/(protected)/(tabs)/profile")}
          accessibilityRole="link"
          accessibilityLabel={`Your profile, ${user?.username ?? "signed in"}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 12,
            paddingVertical: 12,
            minHeight: 64,
          }}
        >
          {user?.avatar ? (
            <Image
              source={{ uri: user.avatar }}
              style={{ width: 48, height: 48, borderRadius: radius.lg }}
              contentFit="cover"
              accessible={false}
            />
          ) : (
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: radius.lg,
                backgroundColor: color.surface2,
              }}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: color.text, fontSize: 16, fontWeight: "800" }}
              numberOfLines={1}
            >
              {user?.name || user?.username || "Your account"}
            </Text>
            {user?.username ? (
              <Text
                style={{ color: color.textDim, fontSize: 13 }}
                numberOfLines={1}
              >
                @{user.username}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {/* Next event. Appears only with an eligible upcoming credential, and
            resolves several passes to the event's group rather than guessing
            which one is meant. */}
        {shortcut && nextEvent ? (
          <Pressable
            onPress={handleShortcut}
            accessibilityRole="link"
            accessibilityLabel={`Open your pass for ${nextEvent.eventTitle}`}
            style={({ pressed }) => ({
              marginHorizontal: 8,
              marginTop: 4,
              marginBottom: 8,
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: color.hairline,
              backgroundColor: pressed ? color.surface2 : color.surface,
            })}
          >
            <Ticket size={18} color={color.cyan} />
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: color.textDim, fontSize: 11, fontWeight: "700" }}
              >
                NEXT EVENT
              </Text>
              <Text
                style={{ color: color.text, fontSize: 14, fontWeight: "700" }}
                numberOfLines={1}
              >
                {nextEvent.eventTitle}
              </Text>
            </View>
            <ChevronRight size={18} color={color.textFaint} />
          </Pressable>
        ) : null}

        {sections.map((section) => (
          <View key={section.id} style={{ marginTop: section.title ? 16 : 0 }}>
            {section.title ? (
              <Text
                accessibilityRole="header"
                style={{
                  color: color.textFaint,
                  fontSize: 11,
                  fontWeight: "800",
                  letterSpacing: 1.2,
                  paddingHorizontal: 16,
                  paddingBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                {section.title}
              </Text>
            ) : null}
            {section.rows.map((row) => (
              <DrawerRowView key={row.id} row={row} onPress={handleRow} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
