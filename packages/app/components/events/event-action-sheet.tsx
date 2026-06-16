import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import {
  Share2,
  Heart,
  CalendarPlus,
  Pencil,
  Trash2,
  Flag,
  X,
  Link,
  Zap,
  LayoutDashboard,
  ScanLine,
  Download,
  UserPlus,
  Users,
  Radio,
} from "lucide-react-native";

interface EventActionSheetProps {
  visible: boolean;
  onClose: () => void;
  isHost: boolean;
  isLiked: boolean;
  onShare: () => void;
  onToggleLike: () => void;
  onAddToCalendar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDashboard?: () => void;
  onScanner?: () => void;
  onStaff?: () => void;
  onAttendees?: () => void;
  onLive?: () => void;
  onPromote?: () => void;
  onDownloadOffline?: () => void;
  offlineTokenCount?: number;
}

export function EventActionSheet({
  visible,
  onClose,
  isHost,
  isLiked,
  onShare,
  onToggleLike,
  onAddToCalendar,
  onEdit,
  onDelete,
  onDashboard,
  onScanner,
  onStaff,
  onAttendees,
  onLive,
  onPromote,
  onDownloadOffline,
  offlineTokenCount = 0,
}: EventActionSheetProps) {
  // Close the sheet first, then run the action on the next frame. Doing both
  // at once means the sheet's close animation races with a router.push() and
  // on iOS the new screen can mount UNDER a still-visible BottomSheet — which
  // looks identical to "the option screen never opened."
  const runAfterClose = useCallback(
    (action: (() => void) | undefined) => {
      if (!action) return;
      onClose();
      requestAnimationFrame(() => {
        setTimeout(action, 0);
      });
    },
    [onClose],
  );
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [isHost ? "72%" : "45%"], [isHost]);

  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  // NOTE: do not `return null` on !visible. The bottom sheet has its own
  // open/close animation driven by the imperative ref above. Unmounting it
  // while `visible` is still flipping cancels the close animation AND drops
  // the underlying pointer handlers, which has been mistaken for "the
  // option screens don't open" — the press registered, but the unmount
  // raced with the navigation.
  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={visible ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <BottomSheetView style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Event Options</Text>
          <Pressable
            onPress={() => bottomSheetRef.current?.close()}
            hitSlop={12}
          >
            <X size={20} color="#71717a" />
          </Pressable>
        </View>

        {/* Host-only actions */}
        {isHost && (
          <>
            <Pressable
              onPress={() => runAfterClose(onEdit)}
              style={styles.row}
            >
              <View style={[styles.iconCircle, { backgroundColor: "rgba(63,220,255,0.12)" }]}>
                <Pencil size={20} color="#3FDCFF" />
              </View>
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowText}>Edit Event</Text>
                <Text style={styles.rowSubtext}>Update details, images, date & time</Text>
              </View>
            </Pressable>

            {onDashboard && (
              <Pressable
                onPress={() => runAfterClose(onDashboard)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(138,64,207,0.12)" }]}>
                  <LayoutDashboard size={20} color="#8A40CF" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>Dashboard</Text>
                  <Text style={styles.rowSubtext}>View attendees & analytics</Text>
                </View>
              </Pressable>
            )}

            {onLive && (
              <Pressable
                onPress={() => runAfterClose(onLive)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(34,197,94,0.14)" }]}>
                  <Radio size={20} color="#22C55E" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>War Room (Live)</Text>
                  <Text style={styles.rowSubtext}>Real-time scans & 30-min chart</Text>
                </View>
              </Pressable>
            )}

            {onScanner && (
              <Pressable
                onPress={() => runAfterClose(onScanner)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
                  <ScanLine size={20} color="#22C55E" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>Ticket Scanner</Text>
                  <Text style={styles.rowSubtext}>Scan & check in attendees</Text>
                </View>
              </Pressable>
            )}

            {onAttendees && (
              <Pressable
                onPress={() => runAfterClose(onAttendees)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(63,220,255,0.12)" }]}>
                  <Users size={20} color="#3FDCFF" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>Attendees</Text>
                  <Text style={styles.rowSubtext}>Search + filter the roster</Text>
                </View>
              </Pressable>
            )}

            {onStaff && (
              <Pressable
                onPress={() => runAfterClose(onStaff)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(138,64,207,0.12)" }]}>
                  <UserPlus size={20} color="#C084FC" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>Staff & Scanners</Text>
                  <Text style={styles.rowSubtext}>Invite co-hosts, managers, door staff</Text>
                </View>
              </Pressable>
            )}

            {onPromote && (
              <Pressable
                onPress={() => runAfterClose(onPromote)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
                  <Zap size={20} color="#f59e0b" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>Promote to Spotlight</Text>
                  <Text style={styles.rowSubtext}>Boost event visibility</Text>
                </View>
              </Pressable>
            )}

            {onDownloadOffline && (
              <Pressable
                onPress={() => runAfterClose(onDownloadOffline)}
                style={styles.row}
              >
                <View style={[styles.iconCircle, { backgroundColor: "rgba(59,130,246,0.12)" }]}>
                  <Download size={20} color="#3b82f6" />
                </View>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText}>
                    {offlineTokenCount > 0
                      ? `${offlineTokenCount} Tickets Cached`
                      : "Download for Offline"}
                  </Text>
                  <Text style={styles.rowSubtext}>Cache tickets for offline check-in</Text>
                </View>
              </Pressable>
            )}

            <View style={styles.divider} />
          </>
        )}

        {/* Common actions */}
        <Pressable
          onPress={() => runAfterClose(onShare)}
          style={styles.row}
        >
          <View style={[styles.iconCircle, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
            <Share2 size={20} color="#fff" />
          </View>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowText}>Share Event</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => runAfterClose(onToggleLike)}
          style={styles.row}
        >
          <View style={[styles.iconCircle, { backgroundColor: isLiked ? "rgba(255,91,252,0.12)" : "rgba(255,255,255,0.06)" }]}>
            <Heart
              size={20}
              color={isLiked ? "#FF5BFC" : "#fff"}
              fill={isLiked ? "#FF5BFC" : "transparent"}
            />
          </View>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowText}>
              {isLiked ? "Unsave Event" : "Save Event"}
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => runAfterClose(onAddToCalendar)}
          style={styles.row}
        >
          <View style={[styles.iconCircle, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
            <CalendarPlus size={20} color="#fff" />
          </View>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowText}>Add to Calendar</Text>
          </View>
        </Pressable>

        {/* Destructive actions */}
        {isHost && (
          <>
            <View style={styles.divider} />
            <Pressable
              onPress={() => runAfterClose(onDelete)}
              style={styles.row}
            >
              <View style={[styles.iconCircle, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
                <Trash2 size={20} color="#ef4444" />
              </View>
              <View style={styles.rowTextWrap}>
                <Text style={[styles.rowText, { color: "#ef4444" }]}>
                  Delete Event
                </Text>
              </View>
            </Pressable>
          </>
        )}

        {!isHost && (
          <Pressable onPress={onClose} style={styles.row}>
            <View style={[styles.iconCircle, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
              <Flag size={20} color="#ef4444" />
            </View>
            <View style={styles.rowTextWrap}>
              <Text style={[styles.rowText, { color: "#ef4444" }]}>
                Report Event
              </Text>
            </View>
          </Pressable>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    backgroundColor: "#555",
    width: 40,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 14,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTextWrap: {
    flex: 1,
  },
  rowText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  rowSubtext: {
    fontSize: 12,
    color: "#71717a",
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginVertical: 4,
  },
});
