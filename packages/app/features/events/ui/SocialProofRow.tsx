import React, { memo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { Lock, X, ChevronRight } from "lucide-react-native";
import { useEventDetailScreenStore } from "@dvnt/app/lib/stores/event-detail-screen-store";
import type { EventAttendee } from "../types";

const AVATAR_SIZE = 34;
const AVATAR_RADIUS = 8; // rounded-square, not circle
const AVATAR_OVERLAP = 10;

interface SocialProofRowProps {
  attendees: EventAttendee[];
  totalCount: number | { image?: string; initials?: string }[];
  followingCount?: number;
  isLoggedIn?: boolean;
  onAttendeePress?: (attendee: EventAttendee) => void;
}

// Single rounded-square avatar tile
const AttendeeTile = memo(function AttendeeTile({
  attendee,
  index,
  onPress,
}: {
  attendee: EventAttendee;
  index: number;
  onPress?: (a: EventAttendee) => void;
}) {
  const handlePress = useCallback(() => onPress?.(attendee), [onPress, attendee]);
  return (
    <Pressable
      onPress={onPress ? handlePress : undefined}
      disabled={!onPress}
      style={[
        styles.avatarWrapper,
        { marginLeft: index === 0 ? 0 : -AVATAR_OVERLAP, zIndex: 10 - index },
      ]}
    >
      {attendee.avatar ? (
        <Image
          source={{ uri: attendee.avatar }}
          style={styles.avatar}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.avatar, styles.initialsAvatar, { backgroundColor: attendee.color || "#4B2D7F" }]}>
          <Text style={styles.initials}>
            {attendee.initials || attendee.username?.charAt(0)?.toUpperCase() || "?"}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

// Full attendee list modal shown on "See more"
const AttendeeListModal = memo(function AttendeeListModal({
  visible,
  attendees,
  totalCount,
  onClose,
  onAttendeePress,
}: {
  visible: boolean;
  attendees: EventAttendee[];
  totalCount: number;
  onClose: () => void;
  onAttendeePress?: (a: EventAttendee) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {totalCount} Going
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.modalClose}>
              <X size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
          >
            {attendees.map((a) => (
              <Pressable
                key={a.id}
                style={styles.attendeeRow}
                onPress={() => onAttendeePress?.(a)}
                disabled={!onAttendeePress}
              >
                {a.avatar ? (
                  <Image
                    source={{ uri: a.avatar }}
                    style={styles.listAvatar}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.listAvatar, styles.initialsAvatar, { backgroundColor: a.color || "#4B2D7F" }]}>
                    <Text style={[styles.initials, { fontSize: 14 }]}>
                      {a.initials || a.username?.charAt(0)?.toUpperCase() || "?"}
                    </Text>
                  </View>
                )}
                <Text style={styles.attendeeUsername} numberOfLines={1}>
                  {a.username || "Guest"}
                </Text>
                {onAttendeePress && (
                  <ChevronRight size={14} color="rgba(255,255,255,0.3)" style={{ marginLeft: "auto" }} />
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

export const SocialProofRow = memo(function SocialProofRow({
  attendees,
  totalCount,
  followingCount,
  isLoggedIn = true,
  onAttendeePress,
}: SocialProofRowProps) {
  const showAll = useEventDetailScreenStore((s) => s.showAttendeesModal);
  const setShowAll = useEventDetailScreenStore((s) => s.setShowAttendeesModal);

  const count =
    typeof totalCount === "number"
      ? totalCount
      : Array.isArray(totalCount)
        ? totalCount.length
        : 0;

  const displayAvatars = attendees.slice(0, 5);
  const hasMore = count > 5;

  if (!isLoggedIn) {
    // Logged-out: blurred face pile + lock gate, no count revealed
    return (
      <View style={styles.container}>
        <View style={styles.facePile}>
          {displayAvatars.slice(0, 3).map((attendee, index) => (
            <View
              key={attendee.id}
              style={[
                styles.avatarWrapper,
                { marginLeft: index === 0 ? 0 : -AVATAR_OVERLAP, zIndex: 10 - index },
              ]}
            >
              <BlurView intensity={20} tint="dark" style={[styles.avatar, { borderRadius: AVATAR_RADIUS }]}>
                {attendee.avatar ? (
                  <Image
                    source={{ uri: attendee.avatar }}
                    style={[StyleSheet.absoluteFill, { borderRadius: AVATAR_RADIUS, opacity: 0.35 }]}
                    contentFit="cover"
                    blurRadius={Platform.OS === "android" ? 8 : 0}
                  />
                ) : null}
              </BlurView>
            </View>
          ))}
        </View>
        <View style={styles.textContainer}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Lock size={13} color="rgba(255,255,255,0.4)" />
            <Text style={[styles.countText, { color: "rgba(255,255,255,0.4)" }]}>
              Sign in to see attendees
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      <Pressable
        style={styles.container}
        onPress={hasMore ? () => setShowAll(true) : undefined}
        disabled={!hasMore}
      >
        <View style={styles.facePile}>
          {displayAvatars.map((attendee, index) => (
            <AttendeeTile
              key={attendee.id}
              attendee={attendee}
              index={index}
              onPress={onAttendeePress}
            />
          ))}
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.countText}>
            <Text style={styles.countBold}>{count}</Text> going
          </Text>
          {followingCount != null && followingCount > 0 && (
            <Text style={styles.followingText}>
              {followingCount} {followingCount === 1 ? "person" : "people"} you follow
            </Text>
          )}
        </View>

        {hasMore && (
          <View style={styles.seeMoreBadge}>
            <Text style={styles.seeMoreText}>See all</Text>
            <ChevronRight size={12} color="rgba(255,255,255,0.5)" />
          </View>
        )}
      </Pressable>

      <AttendeeListModal
        visible={showAll}
        attendees={attendees}
        totalCount={count}
        onClose={() => setShowAll(false)}
        onAttendeePress={onAttendeePress}
      />
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(138,64,207,0.08)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.15)",
  },
  facePile: {
    flexDirection: "row",
    marginRight: 12,
  },
  avatarWrapper: {
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: AVATAR_RADIUS + 2,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_RADIUS,
  },
  initialsAvatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  textContainer: {
    flex: 1,
  },
  countText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  countBold: {
    color: "#fff",
    fontWeight: "700",
  },
  followingText: {
    color: "#FF5BFC",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  seeMoreBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 0.75,
    borderColor: "rgba(255,255,255,0.1)",
  },
  seeMoreText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "600",
  },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalSheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "75%",
    paddingTop: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.75,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  modalClose: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.75,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  listAvatar: {
    width: 42,
    height: 42,
    borderRadius: 10,
  },
  attendeeUsername: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
});
