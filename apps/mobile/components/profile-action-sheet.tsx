import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, Alert, StyleSheet } from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Share2, Users, Flag, ShieldBan, X } from "lucide-react-native";
import { SHEET_SNAPS_ACTION } from "@/lib/constants/sheets";
import { GlassSheetBackground } from "@/components/sheets/glass-sheet-background";

interface ProfileActionSheetProps {
  visible: boolean;
  onClose: () => void;
  username: string;
  onShareProfile: () => void;
  onAddCloseFriend: () => void;
  onReport: () => void;
  onBlock: () => void;
}

export function ProfileActionSheet({
  visible,
  onClose,
  username,
  onShareProfile,
  onAddCloseFriend,
  onReport,
  onBlock,
}: ProfileActionSheetProps) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [...SHEET_SNAPS_ACTION], []);

  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.expand();
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

  const handleBlock = useCallback(() => {
    Alert.alert(
      "Block User",
      `Are you sure you want to block @${username}? They won't be able to see your profile or message you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: () => {
            onBlock();
            onClose();
          },
        },
      ],
    );
  }, [username, onBlock, onClose]);

  if (!visible) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundComponent={GlassSheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <BottomSheetView style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>@{username}</Text>
          <Pressable
            onPress={() => bottomSheetRef.current?.close()}
            hitSlop={12}
          >
            <X size={20} color="#999" />
          </Pressable>
        </View>

        {/* Actions */}
        <Pressable
          onPress={() => {
            onShareProfile();
            onClose();
          }}
          style={styles.row}
        >
          <Share2 size={22} color="#fff" />
          <Text style={styles.rowText}>Share Profile</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            onAddCloseFriend();
            onClose();
          }}
          style={styles.row}
        >
          <Users size={22} color="#22C55E" />
          <Text style={styles.rowText}>Add to Close Friends</Text>
        </Pressable>

        <View style={styles.separator} />

        <Pressable
          onPress={() => {
            onReport();
            onClose();
          }}
          style={styles.row}
        >
          <Flag size={22} color="#ef4444" />
          <Text style={styles.rowTextDanger}>Report</Text>
        </Pressable>

        <Pressable onPress={handleBlock} style={styles.row}>
          <ShieldBan size={22} color="#ef4444" />
          <Text style={styles.rowTextDanger}>Block User</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#1a1a1a",
  },
  handleIndicator: {
    backgroundColor: "rgba(255,255,255,0.3)",
    width: 40,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowText: {
    fontSize: 16,
    color: "#fff",
    marginLeft: 16,
  },
  rowTextDanger: {
    fontSize: 16,
    color: "#ef4444",
    marginLeft: 16,
  },
  separator: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 20,
    marginVertical: 4,
  },
});
