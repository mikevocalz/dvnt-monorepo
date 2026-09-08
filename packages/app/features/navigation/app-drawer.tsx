/**
 * The drawer panel — the phone's version of the web side rail.
 *
 * Same material and the same row metrics as `components/app-shell.web.tsx`:
 * liquid glass over near-black, the DVNT mark at the top, 24pt icon plus label
 * rows, and a leading accent bar on the active row rather than a filled pill.
 * The values live in `drawer-theme.ts` so the two menus cannot drift apart.
 *
 * What it does NOT carry is the rail's Home / Events / Search / Activity /
 * Messages / Profile list. Those are tabs on a phone, one thumb-reach away —
 * repeating them here would give every destination two homes. The drawer holds
 * what the tab bar has no room for.
 *
 * Rows come from `drawer-destinations.ts`, which only ever emits routes that
 * exist. Rows the brief asked for that have no destination are recorded there
 * as struck, with the blocker, rather than rendered as dead ends.
 */

import { useCallback, useMemo } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import {
  ChevronRight,
  CircleHelp,
  Crown,
  Gauge,
  Lock,
  Receipt,
  Settings,
  Ticket,
  type LucideIcon,
} from "lucide-react-native";
import Logo from "@dvnt/app/components/logo";
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
import { color, radius, space } from "@dvnt/app/lib/theme";
import {
  buildDrawerSections,
  isDrawerRowActive,
  type DrawerRow,
} from "./drawer-destinations";
import { drawerTheme } from "./drawer-theme";

const ICONS: Record<DrawerRow["icon"], LucideIcon> = {
  ticket: Ticket,
  receipt: Receipt,
  lock: Lock,
  gauge: Gauge,
  crown: Crown,
  settings: Settings,
  help: CircleHelp,
};

function DrawerRowView({
  row,
  active,
  onPress,
}: {
  row: DrawerRow;
  active: boolean;
  onPress: (row: DrawerRow) => void;
}) {
  const Icon = ICONS[row.icon];
  const { row: r } = drawerTheme;

  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="link"
      // The rail's `aria-current="page"`. VoiceOver announces the selected row
      // rather than leaving the accent bar as a sighted-only cue.
      accessibilityState={{ selected: active }}
      accessibilityLabel={row.detail ? `${row.label}. ${row.detail}` : row.label}
      style={({ pressed }) => ({
        minHeight: r.minHeight,
        flexDirection: "row",
        alignItems: "center",
        gap: r.gap,
        paddingHorizontal: r.paddingHorizontal,
        borderRadius: r.borderRadius,
        borderCurve: "continuous",
        overflow: "hidden",
        // Press is the phone's hover. Selected wins over it, the way the rail
        // leaves the active row's tint alone on mouse-over.
        backgroundColor: active
          ? r.activeBackground
          : pressed
            ? r.pressedBackground
            : "transparent",
      })}
    >
      {/* Leading accent bar, the rail's `inset 2px 0 0 ACCENT`. */}
      {active ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: r.activeBarWidth,
            backgroundColor: r.activeBarColor,
          }}
        />
      ) : null}
      <Icon
        size={r.iconSize}
        strokeWidth={active ? 2.4 : 2}
        color={active ? r.activeIcon : r.inactiveIcon}
      />
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            color: active ? r.activeLabel : r.inactiveLabel,
            fontSize: r.fontSize,
            fontWeight: active ? "700" : "600",
            letterSpacing: r.letterSpacing,
          }}
        >
          {row.label}
        </Text>
        {row.detail ? (
          <Text
            numberOfLines={1}
            style={{ color: color.textDim, fontSize: 12, marginTop: 2 }}
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
            backgroundColor: color.cyan,
          }}
        >
          <Text
            style={{
              color: color.inkDeep,
              fontSize: 11,
              fontWeight: "800",
              fontVariant: ["tabular-nums"],
            }}
          >
            {row.badge > 99 ? "99+" : row.badge}
          </Text>
        </View>
      ) : (
        <ChevronRight size={18} color={color.textFaint} />
      )}
    </Pressable>
  );
}

export function AppDrawerContent() {
  const router = useRouter();
  const pathname = usePathname();
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
   * Hosting is a server-resolved capability rather than a client guess about
   * ids — but it is currently narrower than it should be.
   *
   * `get-host-dashboard/index.ts:70` filters `events.host_id = authId`, i.e.
   * events this account OWNS. A co-organizer whose only role is `scanner` owns
   * nothing, so this row does not appear for exactly the person who needs to
   * reach a door. Fixing it means widening that endpoint to include accepted
   * `event_co_organizers` rows; there is no client-side signal that would do
   * it honestly, and inventing one is how the owner-only gates in the scanner
   * screens happened. See docs/ux/events-tickets-audit.md.
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

  const { surface, logo, section } = drawerTheme;

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      {/* Liquid glass, matching the rail. Blur on native; the translucent base
          alone on web, where the host already composites a backdrop filter. */}
      {Platform.OS !== "web" ? (
        <BlurView
          intensity={surface.blurIntensity}
          tint="dark"
          style={{ position: "absolute", inset: 0 }}
        />
      ) : null}
      <View
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: surface.base,
        }}
      />
      {/* Top-light sheen — the one gradient here, and it is the glass material
          rather than decoration: it is what stops the panel reading as a flat
          slab against the feed behind it. */}
      <LinearGradient
        colors={[...surface.sheen] as [string, string, string]}
        locations={[...surface.sheenLocations] as [number, number, number]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: 320 }}
        pointerEvents="none"
      />
      {/* Trailing hairline — the rail's `borderRight`. */}
      <View
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: surface.edge,
        }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.px12,
          paddingBottom: insets.bottom + space.px24,
          paddingHorizontal: space.px8,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* The mark leads the panel, as it leads the rail. */}
        <Pressable
          onPress={() => go("/(protected)/(tabs)")}
          accessibilityRole="link"
          accessibilityLabel="DVNT home"
          style={{
            alignSelf: "flex-start",
            paddingTop: logo.paddingTop,
            paddingHorizontal: logo.paddingHorizontal,
            paddingBottom: logo.paddingBottom,
          }}
        >
          <Logo width={logo.width} height={logo.height} />
        </Pressable>

        {/* Identity sits under the mark — on a phone the drawer is also the
            account surface, which the desktop rail does not have to be. */}
        <Pressable
          onPress={() => go("/(protected)/(tabs)/profile")}
          accessibilityRole="link"
          accessibilityLabel={`Your profile, ${user?.username ?? "signed in"}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.px12,
            paddingHorizontal: space.px12,
            paddingVertical: space.px8,
            minHeight: 56,
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: pressed
              ? drawerTheme.row.pressedBackground
              : "transparent",
          })}
        >
          {user?.avatar ? (
            <Image
              source={{ uri: user.avatar }}
              style={{ width: 40, height: 40, borderRadius: radius.md }}
              contentFit="cover"
              accessible={false}
            />
          ) : (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                backgroundColor: color.surface2,
              }}
            />
          )}
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ color: color.text, fontSize: 15, fontWeight: "700" }}
            >
              {user?.name || user?.username || "Your account"}
            </Text>
            {user?.username ? (
              <Text
                numberOfLines={1}
                style={{ color: color.textDim, fontSize: 13 }}
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
              marginTop: space.px12,
              marginHorizontal: space.px4,
              padding: space.px12,
              flexDirection: "row",
              alignItems: "center",
              gap: space.px8,
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
                style={{
                  color: color.textDim,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 1,
                }}
              >
                NEXT EVENT
              </Text>
              <Text
                numberOfLines={1}
                style={{ color: color.text, fontSize: 14, fontWeight: "700" }}
              >
                {nextEvent.eventTitle}
              </Text>
            </View>
            <ChevronRight size={18} color={color.textFaint} />
          </Pressable>
        ) : null}

        {sections.map((s, i) => (
          <View
            key={s.id}
            style={{
              marginTop:
                i === 0 ? logo.gapToRows - logo.paddingBottom : section.marginTop,
              gap: drawerTheme.row.spacing,
            }}
          >
            {s.title ? (
              <Text
                accessibilityRole="header"
                style={{
                  color: section.labelColor,
                  fontSize: section.labelSize,
                  fontWeight: "800",
                  letterSpacing: section.labelLetterSpacing,
                  paddingHorizontal: drawerTheme.row.paddingHorizontal,
                  marginBottom: section.marginBottom - drawerTheme.row.spacing,
                  textTransform: "uppercase",
                }}
              >
                {s.title}
              </Text>
            ) : null}
            {s.rows.map((row) => (
              <DrawerRowView
                key={row.id}
                row={row}
                active={isDrawerRowActive(pathname, row.href)}
                onPress={handleRow}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
