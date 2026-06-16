import { View, Pressable, Dimensions, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useCallback, useRef, useMemo } from "react";
import {
  useVideoLifecycle,
  safePlay,
  safePause,
  cleanupPlayer,
  logVideoHealth,
} from "@dvnt/app/lib/video-lifecycle";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

interface MediaPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  media: {
    type: "image" | "video";
    uri: string;
  } | null;
}

const { width, height } = Dimensions.get("window");

export function MediaPreviewModal({
  visible,
  onClose,
  media,
}: MediaPreviewModalProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const snapPoints = useMemo(() => ["95%"], []);

  useEffect(() => {
    if (visible) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
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
        opacity={0.9}
        pressBehavior="close"
      />
    ),
    [],
  );

  // CRITICAL: Video lifecycle management to prevent crashes
  const { isMountedRef, isSafeToOperate } = useVideoLifecycle(
    "MediaPreviewModal",
    media?.uri,
  );

  const player = useVideoPlayer(
    media?.type === "video" ? media.uri : "",
    (p) => {
      if (isMountedRef.current) {
        p.loop = true;
        // Duck background audio (Spotify etc.) while the preview plays
        // instead of preempting it.
        p.audioMixingMode = "duckOthers";
        logVideoHealth("MediaPreviewModal", "player configured");
      }
    },
  );

  useEffect(() => {
    if (visible && media?.type === "video" && player && isSafeToOperate()) {
      safePlay(player, isMountedRef, "MediaPreviewModal");
    }
    return () => {
      if (player) {
        cleanupPlayer(player, "MediaPreviewModal");
      }
    };
  }, [visible, media, player, isSafeToOperate, isMountedRef]);

  const handleClose = useCallback(() => {
    if (player && isSafeToOperate()) {
      safePause(player, isMountedRef, "MediaPreviewModal");
    }
    onClose();
  }, [player, onClose, isSafeToOperate, isMountedRef]);

  if (!media) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onChange={handleSheetChange}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.sheetHandle}
    >
      <BottomSheetView style={styles.container}>
        <Pressable
          style={[styles.closeButton, { top: 8 }]}
          onPress={handleClose}
          hitSlop={16}
        >
          <View style={styles.closeIconContainer}>
            <X size={24} color="#fff" />
          </View>
        </Pressable>

        <View style={styles.mediaContainer}>
          {media.type === "image" ? (
            <Image
              source={{ uri: media.uri }}
              style={styles.media}
              contentFit="contain"
            />
          ) : (
            <VideoView
              player={player}
              style={styles.media}
              contentFit="contain"
              nativeControls
            />
          )}
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg: {
    backgroundColor: "#000",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHandle: {
    backgroundColor: "rgba(255,255,255,0.3)",
    width: 36,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
  },
  closeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  mediaContainer: {
    width,
    height: height * 0.75,
    justifyContent: "center",
    alignItems: "center",
  },
  media: {
    width: "100%",
    height: "100%",
  },
});
