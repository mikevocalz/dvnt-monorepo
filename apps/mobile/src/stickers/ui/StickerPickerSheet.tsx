/**
 * StickerPickerSheet — Modal wrapper for StickerSheetContent
 *
 * Opens as a fullscreen modal. When user selects a sticker/GIF/meme,
 * the URI is collected and passed back to the photo editor.
 */

import React, { memo, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, Check } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useStickerStore } from "@/src/stickers/stores/sticker-store";
import { StickerSheetContent } from "./StickerSheetContent";

interface StickerPickerSheetProps {
  onDone: (stickers: string[]) => void;
  onDismiss?: () => void;
}

export const StickerPickerSheet = memo(function StickerPickerSheet({
  onDone,
  onDismiss,
}: StickerPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const isSheetOpen = useStickerStore((s) => s.isSheetOpen);
  const closeSheet = useStickerStore((s) => s.closeSheet);
  const selectedStickers = useStickerStore((s) => s.selectedStickers);
  const addSelectedSticker = useStickerStore((s) => s.addSelectedSticker);
  const clearSelectedStickers = useStickerStore((s) => s.clearSelectedStickers);

  const handleSelect = useCallback(
    (uri: string) => {
      console.log("[StickerPicker] Adding sticker to selection:", uri);
      addSelectedSticker(uri);
    },
    [addSelectedSticker],
  );

  const handleDone = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const stickers = [...selectedStickers];
    console.log(
      "[StickerPicker] Done with stickers:",
      stickers.length,
      stickers,
    );
    closeSheet();
    clearSelectedStickers();
    onDone(stickers);
  }, [selectedStickers, closeSheet, clearSelectedStickers, onDone]);

  const handleClose = useCallback(() => {
    closeSheet();
    clearSelectedStickers();
    onDismiss?.();
  }, [closeSheet, clearSelectedStickers, onDismiss]);

  return (
    <Modal
      visible={isSheetOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { paddingTop: 8 }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={handleClose}
            hitSlop={12}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.1)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>
            {selectedStickers.length > 0
              ? `${selectedStickers.length} selected`
              : "Add Stickers"}
          </Text>
          <Pressable
            onPress={handleDone}
            style={[
              styles.doneButton,
              selectedStickers.length === 0 && styles.doneButtonDisabled,
            ]}
            disabled={selectedStickers.length === 0}
            hitSlop={12}
          >
            <Check size={16} color="#fff" />
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>

        {/* Content */}
        <StickerSheetContent onSelect={handleSelect} />

        {/* Safe area bottom */}
        <View style={{ height: insets.bottom }} />
      </KeyboardAvoidingView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#34A2DF",
  },
  doneButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(99,102,241,0.8)",
  },
  doneButtonDisabled: {
    opacity: 0.3,
  },
  doneText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
});
