import React, { memo, useCallback, useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { Lock, ChevronDown } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  useAnimatedProps,
} from "react-native-reanimated";
import { useEventDetailScreenStore } from "@dvnt/app/lib/stores/event-detail-screen-store";
import {
  useEventAttendeesStore,
  selectAttendees,
} from "@dvnt/app/lib/stores/event-attendees-store";
import { hasMoreAttendees } from "@dvnt/app/lib/events/attendee-page";
import { LegendList } from "@dvnt/app/components/list";
import type { EventAttendee } from "../types";

const AVATAR_SIZE = 44;
const AVATAR_RADIUS = 10;
const COLS = 5;
/** Four rows of tiles. Bounded so the list scrolls instead of clipping. */
const GRID_HEIGHT = 300;

interface GoingAccordionProps {
  attendees: EventAttendee[];
  totalCount: number;
  isLoggedIn?: boolean;
  onAttendeePress?: (attendee: EventAttendee) => void;
  /** Enables paging past the 20 the detail RPC ships. Omit → static list. */
  eventId?: string;
  /** Gate: only a public event's list is fetched. */
  visibility?: unknown;
}

const AvatarTile = memo(function AvatarTile({
  attendee,
  size,
  onPress,
}: {
  attendee: EventAttendee;
  size?: number;
  onPress?: (a: EventAttendee) => void;
}) {
  const sz = size ?? AVATAR_SIZE;
  return (
    <Pressable
      onPress={onPress ? () => onPress(attendee) : undefined}
      style={{ alignItems: "center", gap: 4 }}
    >
      {attendee.avatar ? (
        <Image
          source={{ uri: attendee.avatar }}
          style={{ width: sz, height: sz, borderRadius: AVATAR_RADIUS }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={{
            width: sz,
            height: sz,
            borderRadius: AVATAR_RADIUS,
            backgroundColor: attendee.color || "#4B2D7F",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: sz * 0.32, fontWeight: "700" }}>
            {attendee.initials || attendee.username?.charAt(0)?.toUpperCase() || "?"}
          </Text>
        </View>
      )}
      {attendee.username ? (
        <Text
          style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: "500" }}
          numberOfLines={1}
        >
          {attendee.username}
        </Text>
      ) : null}
    </Pressable>
  );
});

export const GoingAccordion = memo(function GoingAccordion({
  attendees,
  totalCount,
  isLoggedIn = true,
  onAttendeePress,
  eventId,
  visibility,
}: GoingAccordionProps) {
  const expanded = useEventDetailScreenStore((s) => s.attendeesExpanded);
  const setExpanded = useEventDetailScreenStore((s) => s.setAttendeesExpanded);
  const progress = useSharedValue(0);

  // Paged rows live in the store; `attendees` is only the first screenful the
  // detail RPC shipped. Without an eventId (design demos) the prop stands alone.
  const paged = useEventAttendeesStore(selectAttendees(eventId ?? ""));
  const seed = useEventAttendeesStore((s) => s.seed);
  const loadMore = useEventAttendeesStore((s) => s.loadMore);
  useEffect(() => {
    if (eventId && attendees.length > 0) seed(eventId, attendees);
  }, [eventId, attendees, seed]);
  const rows = eventId ? paged.rows : attendees;
  const canLoadMore =
    !!eventId &&
    hasMoreAttendees({
      loaded: rows.length,
      totalCount,
      lastPageSize: paged.lastPageSize,
    });
  const onEndReached = useCallback(() => {
    if (eventId && canLoadMore && !paged.loading) loadMore(eventId, visibility);
  }, [eventId, canLoadMore, paged.loading, loadMore, visibility]);

  const toggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    progress.value = withTiming(next ? 1 : 0, { duration: 280 });
  }, [expanded, setExpanded, progress]);

  // The panel animates open to a FIXED height and the list scrolls inside it.
  // It used to animate maxHeight 0 -> 600 with overflow hidden and no scroller,
  // so anything past ~33 tiles was unreachable: clipped, with nothing to drag.
  const gridStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    height: interpolate(progress.value, [0, 1], [0, GRID_HEIGHT]),
    overflow: "hidden",
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  const previewAvatars = rows.slice(0, 4);

  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {previewAvatars.slice(0, 3).map((a, i) => (
            <BlurView key={a.id} intensity={18} tint="dark" style={[styles.blurAvatar, { marginLeft: i > 0 ? -8 : 0 }]}>
              {a.avatar ? (
                <Image
                  source={{ uri: a.avatar }}
                  style={[StyleSheet.absoluteFill, { borderRadius: AVATAR_RADIUS, opacity: 0.3 }]}
                  contentFit="cover"
                />
              ) : null}
            </BlurView>
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <Lock size={13} color="rgba(255,255,255,0.4)" />
            <Text style={styles.lockedText}>Sign in to see who's going</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header row — always visible */}
      <Pressable style={styles.header} onPress={toggle}>
        {/* Face pile preview */}
        <View style={{ flexDirection: "row" }}>
          {previewAvatars.map((a, i) => (
            <View key={a.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}>
              {a.avatar ? (
                <Image
                  source={{ uri: a.avatar }}
                  style={styles.previewAvatar}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.previewAvatar, { backgroundColor: a.color || "#4B2D7F", alignItems: "center", justifyContent: "center" }]}>
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                    {a.initials || a.username?.charAt(0)?.toUpperCase() || "?"}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.countText}>
            <Text style={styles.countBold}>{totalCount}</Text> going
          </Text>
          {attendees.length > 0 && !expanded && (
            <Text style={styles.tapHint}>Tap to see everyone</Text>
          )}
        </View>

        <Animated.View style={chevronStyle}>
          <ChevronDown size={18} color="rgba(255,255,255,0.5)" />
        </Animated.View>
      </Pressable>

      {/* Expandable grid — scrolls inside the panel, pages as it reaches the end */}
      <Animated.View style={gridStyle}>
        <LegendList
          data={rows}
          numColumns={COLS}
          keyExtractor={(item: EventAttendee) => item.id}
          estimatedItemSize={72}
          nestedScrollEnabled
          showsVerticalScrollIndicator
          contentContainerStyle={styles.grid}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          renderItem={({ item }: { item: EventAttendee }) => (
            <View style={styles.gridCell}>
              <AvatarTile attendee={item} onPress={onAttendeePress} />
            </View>
          )}
          ListFooterComponent={
            paged.loading ? (
              <Text style={styles.footerText}>Loading more…</Text>
            ) : null
          }
        />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(138,64,207,0.08)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.15)",
    padding: 14,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  previewAvatar: {
    width: 30,
    height: 30,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#000",
  },
  blurAvatar: {
    width: 30,
    height: 30,
    borderRadius: 7,
    overflow: "hidden",
  },
  countText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  countBold: {
    color: "#fff",
    fontWeight: "700",
  },
  tapHint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    marginTop: 1,
  },
  lockedText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 14,
    gap: 10,
  },
  gridCell: {
    width: `${100 / COLS}%`,
    alignItems: "center",
  },
  footerText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 12,
  },
});
