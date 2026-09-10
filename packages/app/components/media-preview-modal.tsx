import {
  View,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
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

/**
 * The player lives in its own component so it is only ever constructed for an
 * actual video. `useVideoPlayer` builds a native AVPlayer on EVERY render pass
 * of its host, so keeping it in MediaPreviewModal meant every image preview —
 * and every `media === null` render — paid for one.
 *
 * The old placeholder source was `""`. Whether that reaches AVURLAsset is moot
 * — `VideoPlayer.replaceCurrentItem` bails on a nil `uri`, so the empty string
 * most likely cost only the AVPlayer and not the asset. The AVPlayer is reason
 * enough: one per image preview, per null render, for a component that is
 * mounted app-wide.
 */
function MediaPreviewVideo({
  uri,
  shouldPlay,
}: {
  uri: string;
  shouldPlay: boolean;
}) {
  // CRITICAL: Video lifecycle management to prevent crashes
  const { isMountedRef, isSafeToOperate } = useVideoLifecycle(
    "MediaPreviewModal",
    uri,
  );

  const player = useVideoPlayer(uri, (p) => {
    if (isMountedRef.current) {
      p.loop = true;
      // Duck background audio (Spotify etc.) while the preview plays
      // instead of preempting it.
      p.audioMixingMode = "duckOthers";
      logVideoHealth("MediaPreviewModal", "player configured");
    }
  });

  useEffect(() => {
    if (!player || !isSafeToOperate()) return;
    if (shouldPlay) {
      safePlay(player, isMountedRef, "MediaPreviewModal");
    } else {
      safePause(player, isMountedRef, "MediaPreviewModal");
    }
  }, [shouldPlay, player, isSafeToOperate, isMountedRef]);

  useEffect(() => {
    return () => {
      cleanupPlayer(player, "MediaPreviewModal");
    };
  }, [player]);

  return (
    <VideoView
      player={player}
      style={styles.media}
      contentFit="contain"
      nativeControls
    />
  );
}

export function MediaPreviewModal({
  visible,
  onClose,
  media,
}: MediaPreviewModalProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  // Read per-render, not at module scope: a module-scope size is captured once
  // at import and never follows an iPad rotation or Split View resize.
  const { width, height } = useWindowDimensions();
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
          onPress={onClose}
          hitSlop={16}
        >
          <View style={styles.closeIconContainer}>
            <X size={24} color="#fff" />
          </View>
        </Pressable>

        <View
          style={[styles.mediaContainer, { width, height: height * 0.75 }]}
        >
          {media.type === "image" ? (
            <Image
              source={{ uri: media.uri }}
              style={styles.media}
              contentFit="contain"
            />
          ) : (
            <MediaPreviewVideo uri={media.uri} shouldPlay={visible} />
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
    justifyContent: "center",
    alignItems: "center",
  },
  media: {
    width: "100%",
    height: "100%",
  },
});
