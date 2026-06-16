import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import {
  Edit,
  Trash2,
  Flag,
  X,
  Link,
  Share2,
  ImagePlus,
  Languages,
} from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import { SHEET_SNAPS_ACTION } from "@/lib/constants/sheets";

interface PostActionSheetProps {
  visible: boolean;
  onClose: () => void;
  isOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReport?: () => void;
  onShareToStory?: () => void;
  onShare?: () => void;
  onTranslate?: () => void;
  isTranslated?: boolean;
  isTranslationCapable?: boolean;
}

export function PostActionSheet({
  visible,
  onClose,
  isOwner,
  onEdit,
  onDelete,
  onReport,
  onShareToStory,
  onShare,
  onTranslate,
  isTranslated,
  isTranslationCapable,
}: PostActionSheetProps) {
  const { colors } = useColorScheme();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [isOwner ? "60%" : "55%"], [isOwner]);

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
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 40,
      }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <BottomSheetView style={styles.content}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Post Options
          </Text>
          <Pressable
            onPress={() => bottomSheetRef.current?.close()}
            hitSlop={12}
          >
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Actions */}
        {isOwner && (
          <>
            <Pressable
              onPress={() => {
                onEdit();
                onClose();
              }}
              style={styles.row}
            >
              <Edit size={22} color={colors.foreground} />
              <Text style={[styles.rowText, { color: colors.foreground }]}>
                Edit Post
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                onDelete();
                onClose();
              }}
              style={styles.row}
            >
              <Trash2 size={22} color="#ef4444" />
              <Text style={[styles.rowText, { color: "#ef4444" }]}>
                Delete Post
              </Text>
            </Pressable>
          </>
        )}

        {/* Common options */}
        {isTranslationCapable && (
          <Pressable
            onPress={() => {
              if (onTranslate) onTranslate();
              onClose();
            }}
            style={styles.row}
          >
            <Languages size={22} color={colors.foreground} />
            <Text style={[styles.rowText, { color: colors.foreground }]}>
              {isTranslated ? "Show Original" : "Translate Post"}
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => {
            onClose();
          }}
          style={styles.row}
        >
          <Link size={22} color={colors.foreground} />
          <Text style={[styles.rowText, { color: colors.foreground }]}>
            Copy Link
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (onShare) onShare();
            onClose();
          }}
          style={styles.row}
        >
          <Share2 size={22} color={colors.foreground} />
          <Text style={[styles.rowText, { color: colors.foreground }]}>
            Share
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (onShareToStory) onShareToStory();
            onClose();
          }}
          style={styles.row}
        >
          <ImagePlus size={22} color={colors.foreground} />
          <Text style={[styles.rowText, { color: colors.foreground }]}>
            Share to Story
          </Text>
        </Pressable>

        {!isOwner && (
          <Pressable
            onPress={() => {
              if (onReport) onReport();
              onClose();
            }}
            style={styles.row}
          >
            <Flag size={22} color="#ef4444" />
            <Text style={[styles.rowText, { color: "#ef4444" }]}>
              Report Post
            </Text>
          </Pressable>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowText: {
    fontSize: 16,
    marginLeft: 16,
  },
});
