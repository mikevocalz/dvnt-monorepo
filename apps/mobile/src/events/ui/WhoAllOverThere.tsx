/**
 * "Who All Over There 👀" — ephemeral event moment tray.
 * Shows photo/video moments uploaded by ticket holders and hosts.
 * Expires 24h after the event ends.
 */

import React, { memo, useCallback, useRef, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { X, Camera, ImageIcon, Play, Flag } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { LegendList, type LegendListRef } from "@/components/list";
import { useEventDetailScreenStore } from "@/lib/stores/event-detail-screen-store";
import { uploadToServer } from "@/lib/server-upload";
import { invokeEdge } from "@/lib/api/invoke-edge";
import { useUIStore } from "@/lib/stores/ui-store";

const THUMB_SIZE = 80;
const MAX_VIDEO_SECONDS = 30;

interface Moment {
  id: number;
  media_url: string;
  media_type: "photo" | "video";
  thumbnail_url: string | null;
  duration_sec: number | null;
  created_at: string;
}

interface WhoAllOverThereProps {
  eventId: string;
  canUpload: boolean;
}

function formatDuration(sec: number | null): string | null {
  if (sec == null || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function fetchMoments(eventId: string): Promise<Moment[]> {
  const evId = parseInt(eventId);
  const now = new Date().toISOString();

  // Try with thumbnail_url (requires migration 20260503)
  const { data, error } = await supabase
    .from("event_moments")
    .select("id, media_url, media_type, thumbnail_url, duration_sec, created_at")
    .eq("event_id", evId)
    .gt("expires_at", now)
    .eq("is_flagged", false)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    // Graceful fallback if thumbnail_url column not yet migrated
    console.warn("[WhoAllOverThere] thumbnail_url fetch failed, falling back:", error.code);
    const { data: data2, error: err2 } = await supabase
      .from("event_moments")
      .select("id, media_url, media_type, duration_sec, created_at")
      .eq("event_id", evId)
      .gt("expires_at", now)
      .eq("is_flagged", false)
      .order("created_at", { ascending: false })
      .limit(30);
    if (err2) {
      console.error("[WhoAllOverThere] fetch error:", err2);
      return [];
    }
    return (data2 || []).map((m) => ({ ...m, thumbnail_url: null })) as Moment[];
  }
  return (data || []) as Moment[];
}

function useMoments(eventId: string) {
  return useQuery({
    queryKey: ["event-moments", eventId],
    queryFn: () => fetchMoments(eventId),
    staleTime: 20 * 1000,
    refetchInterval: 30 * 1000,
  });
}

// Fullscreen video player — plays whenever this item is the active page.
// Two reliability fixes from the previous version:
//  1. `nativeControls` defaults to true (was implicit false) so the user
//     can scrub + unmute even when our auto-play didn't fire.
//  2. We retry play() once after a short delay because `useVideoPlayer`
//     setup callback runs before the player is fully ready — the first
//     `play()` call could no-op on some Android devices.
function ViewerVideo({ uri, isActive }: { uri: string; isActive: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (isActive) {
      try {
        player.play();
      } catch (e) {
        console.warn("[WhoAllOverThere] viewer play() failed:", e);
      }
      // Retry once after the player has had a tick to load.
      const t = setTimeout(() => {
        try {
          player.play();
        } catch {}
      }, 250);
      return () => clearTimeout(t);
    }
    try {
      player.pause();
    } catch {}
    // player ref is stable for the component lifetime; only re-run on isActive change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
    />
  );
}

// Single fullscreen viewer item
const ViewerItem = memo(function ViewerItem({
  moment,
  width,
  height,
  isActive,
}: {
  moment: Moment;
  width: number;
  height: number;
  isActive: boolean;
}) {
  // Use explicit width AND height. In a horizontal LegendList, `flex: 1`
  // on an inner View doesn't reliably give a vertical height — it
  // collapses to 0 on some iOS layouts which is why the video player
  // would mount without a viewport and render an all-black frame.
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: "#000",
        justifyContent: "center",
      }}
    >
      {moment.media_type === "video" ? (
        <ViewerVideo uri={moment.media_url} isActive={isActive} />
      ) : (
        <Image
          source={{ uri: moment.media_url }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
        />
      )}
    </View>
  );
});

// Fullscreen swipeable viewer
const MomentViewer = memo(function MomentViewer({
  moments,
  initialIndex,
  currentIndex,
  onClose,
  onIndexChange,
  onFlag,
}: {
  moments: Moment[];
  initialIndex: number;
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onFlag: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();
  const listRef = useRef<LegendListRef>(null);

  const handleViewable = useCallback(
    ({ viewableItems }: any) => {
      const first = viewableItems[0];
      if (first != null && first.index !== currentIndex) {
        onIndexChange(first.index);
      }
    },
    [currentIndex, onIndexChange],
  );

  const btnTop = safeTop + 8;

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={viewerStyles.overlay}>
        <LegendList
          ref={listRef}
          data={moments}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          recycleItems={false}
          estimatedItemSize={width}
          initialScrollIndex={initialIndex}
          keyExtractor={(m) => String(m.id)}
          renderItem={({ item, index }) => (
            <ViewerItem
              moment={item}
              width={width}
              height={height}
              isActive={index === currentIndex}
            />
          )}
          onViewableItemsChanged={handleViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 51 }}
          style={{ flex: 1 }}
        />

        {/* Counter */}
        <View style={[viewerStyles.counter, { top: btnTop }]}>
          <Text style={viewerStyles.counterText}>
            {currentIndex + 1} / {moments.length}
          </Text>
        </View>

        {/* Close */}
        <Pressable style={[viewerStyles.closeBtn, { top: btnTop }]} onPress={onClose} hitSlop={12}>
          <X size={20} color="#fff" />
        </Pressable>

        {/* Flag */}
        <Pressable style={[viewerStyles.flagBtn, { top: btnTop }]} onPress={onFlag} hitSlop={12}>
          <Flag size={16} color="rgba(255,255,255,0.55)" />
        </Pressable>
      </View>
    </Modal>
  );
});

// Paused-frame video thumb. Reliable across iOS + Android because we
// just hand the URL to expo-video and let it render the first frame.
// expo-video-thumbnails would silently fail on a chunk of legacy
// remote videos — this avoids that whole class of bug.
const VideoFrameThumb = memo(function VideoFrameThumb({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = true;
    p.pause();
  });
  // Wrapper View takes the pointerEvents prop so taps pass through to
  // the outer Pressable. VideoView itself doesn't forward pointerEvents
  // reliably across platforms.
  return (
    <View pointerEvents="none" style={trayStyles.thumbImg}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
  );
});

// Individual thumbnail in the tray
const MomentThumb = memo(function MomentThumb({
  moment,
  onPress,
}: {
  moment: Moment;
  onPress: () => void;
}) {
  const isVideo = moment.media_type === "video";
  const dur = formatDuration(moment.duration_sec);
  // For videos: prefer the stored thumbnail; otherwise fall back to a
  // paused VideoView showing frame 0.
  // For photos: render media_url directly.
  const photoUri = !isVideo ? moment.media_url : null;
  const storedThumb = isVideo ? moment.thumbnail_url : null;

  return (
    <Pressable onPress={onPress} style={trayStyles.thumb}>
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          style={trayStyles.thumbImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      ) : storedThumb ? (
        <Image
          source={{ uri: storedThumb }}
          style={trayStyles.thumbImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
        />
      ) : (
        <VideoFrameThumb uri={moment.media_url} />
      )}
      {isVideo && (
        <View style={trayStyles.playBadge}>
          <Play size={8} color="#fff" fill="#fff" />
        </View>
      )}
      {dur != null && (
        <View style={trayStyles.durBadge}>
          <Text style={trayStyles.durText}>{dur}</Text>
        </View>
      )}
    </Pressable>
  );
});

// Picker sheet modal (camera vs library)
const PickerSheet = memo(function PickerSheet({
  onCamera,
  onLibrary,
  onDismiss,
}: {
  onCamera: () => void;
  onLibrary: () => void;
  onDismiss: () => void;
}) {
  const { bottom } = useSafeAreaInsets();
  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onDismiss}
    >
      <Pressable style={pickerStyles.backdrop} onPress={onDismiss} />
      <View style={[pickerStyles.sheet, { paddingBottom: Math.max(bottom, 16) + 16 }]}>
        <View style={pickerStyles.handle} />
        <Text style={pickerStyles.title}>Add a Moment</Text>
        <Pressable style={pickerStyles.option} onPress={onCamera}>
          <Camera size={20} color="#8A40CF" />
          <Text style={pickerStyles.optionText}>Take Photo or Video</Text>
        </Pressable>
        <Pressable style={pickerStyles.option} onPress={onLibrary}>
          <ImageIcon size={20} color="#8A40CF" />
          <Text style={pickerStyles.optionText}>Choose from Library</Text>
        </Pressable>
        <Pressable style={pickerStyles.cancel} onPress={onDismiss}>
          <Text style={pickerStyles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
});

export const WhoAllOverThere = memo(function WhoAllOverThere({
  eventId,
  canUpload,
}: WhoAllOverThereProps) {
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data: moments = [], isLoading } = useMoments(eventId);

  const viewerIndex = useEventDetailScreenStore((s) => s.momentViewerIndex);
  const setViewerIndex = useEventDetailScreenStore((s) => s.setMomentViewerIndex);
  const uploading = useEventDetailScreenStore((s) => s.uploadingMoment);
  const setUploading = useEventDetailScreenStore((s) => s.setUploadingMoment);
  const uploadProgress = useEventDetailScreenStore((s) => s.momentUploadProgress);
  const setUploadProgress = useEventDetailScreenStore((s) => s.setMomentUploadProgress);
  const showPickerSheet = useEventDetailScreenStore((s) => s.showMomentUploader);
  const setShowPickerSheet = useEventDetailScreenStore((s) => s.setShowMomentUploader);

  const createMoment = useMutation({
    mutationFn: async (vars: {
      mediaUrl: string;
      mediaType: "photo" | "video";
      durationSec?: number;
      thumbnailUrl?: string;
    }) => {
      const result = await invokeEdge("create-event-moment", {
        eventId: parseInt(eventId),
        mediaUrl: vars.mediaUrl,
        mediaType: vars.mediaType,
        durationSec: vars.durationSec,
        thumbnailUrl: vars.thumbnailUrl,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-moments", eventId] });
    },
  });

  const handleUpload = useCallback(
    async (source: "camera" | "library") => {
      setShowPickerSheet(false);

      try {
        let picked: ImagePicker.ImagePickerResult;

        if (source === "camera") {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            showToast("error", "Permission needed", "Allow camera access to post moments.");
            return;
          }
          picked = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images", "videos"],
            quality: 0.85,
            videoMaxDuration: MAX_VIDEO_SECONDS,
          });
        } else {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            showToast("error", "Permission needed", "Allow photo library access to post moments.");
            return;
          }
          picked = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images", "videos"],
            quality: 0.85,
            videoMaxDuration: MAX_VIDEO_SECONDS,
          });
        }

        if (picked.canceled || !picked.assets?.[0]) return;
        const asset = picked.assets[0];
        const isVideo = asset.type === "video";

        if (isVideo && asset.duration != null && asset.duration > MAX_VIDEO_SECONDS * 1000) {
          showToast("error", "Too long", `Videos must be ${MAX_VIDEO_SECONDS}s or less.`);
          return;
        }

        setUploading(true);
        setUploadProgress(0);

        let thumbnailUrl: string | undefined;

        if (isVideo) {
          try {
            const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(asset.uri, {
              time: 1000,
              quality: 0.7,
            });
            setUploadProgress(10);
            const thumbResult = await uploadToServer(thumbUri, "event-moments", (p) => {
              setUploadProgress(10 + p.percentage * 0.3);
            });
            if (thumbResult.success && thumbResult.url) {
              thumbnailUrl = thumbResult.url;
            }
          } catch (thumbErr) {
            console.warn("[WhoAllOverThere] thumbnail generation failed:", thumbErr);
          }
          setUploadProgress(40);
        }

        const uploadResult = await uploadToServer(asset.uri, "event-moments", (p) => {
          const base = isVideo ? 40 : 0;
          const range = isVideo ? 50 : 80;
          setUploadProgress(Math.round(base + (p.percentage * range) / 100));
        });

        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(uploadResult.error || "Upload failed");
        }

        setUploadProgress(90);

        await createMoment.mutateAsync({
          mediaUrl: uploadResult.url,
          mediaType: isVideo ? "video" : "photo",
          durationSec:
            isVideo && asset.duration != null
              ? Math.round(asset.duration / 1000)
              : undefined,
          thumbnailUrl,
        });

        setUploadProgress(100);
        showToast("success", "Moment posted!", "Your moment has been added.");
      } catch (err: any) {
        showToast("error", "Upload failed", err?.message || "Something went wrong.");
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [createMoment, eventId, setShowPickerSheet, setUploadProgress, setUploading, showToast],
  );

  const handleFlag = useCallback(() => {
    showToast("info", "Report submitted", "Thank you. We'll review this moment.");
  }, [showToast]);

  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.title}>Who All Over There 👀</Text>
        {moments.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{moments.length}</Text>
          </View>
        )}
      </View>

      {/* Thumbnail tray */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={trayStyles.content}
      >
        {canUpload && (
          <Pressable
            onPress={uploading ? undefined : () => setShowPickerSheet(true)}
            style={trayStyles.uploadBtn}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Text style={trayStyles.progressPct}>{Math.round(uploadProgress)}%</Text>
                <Text style={trayStyles.uploadLabel}>Uploading</Text>
              </>
            ) : (
              <>
                <Camera size={20} color="#8A40CF" />
                <Text style={trayStyles.uploadLabel}>Add</Text>
              </>
            )}
          </Pressable>
        )}

        {isLoading && moments.length === 0 ? null : (
          moments.map((m, i) => (
            <MomentThumb key={m.id} moment={m} onPress={() => setViewerIndex(i)} />
          ))
        )}
      </ScrollView>

      {/* Empty state */}
      {!isLoading && moments.length === 0 && (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyEmoji}>📸</Text>
          <View>
            <Text style={styles.emptyTitle}>No moments yet</Text>
            <Text style={styles.emptyText}>
              {canUpload
                ? "Be the first to share a moment from this event"
                : "Ticket holders can post moments here"}
            </Text>
          </View>
        </View>
      )}

      {/* Fullscreen viewer */}
      {viewerIndex >= 0 && moments.length > 0 && (
        <MomentViewer
          moments={moments}
          initialIndex={viewerIndex}
          currentIndex={viewerIndex}
          onClose={() => setViewerIndex(-1)}
          onIndexChange={setViewerIndex}
          onFlag={handleFlag}
        />
      )}

      {/* Picker sheet */}
      {showPickerSheet && (
        <PickerSheet
          onCamera={() => handleUpload("camera")}
          onLibrary={() => handleUpload("library")}
          onDismiss={() => setShowPickerSheet(false)}
        />
      )}
    </View>
  );
});

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  countBadge: {
    backgroundColor: "rgba(138,64,207,0.25)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.4)",
  },
  countText: {
    color: "#8A40CF",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  emptyEmoji: {
    fontSize: 32,
  },
  emptyTitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  emptyText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
  },
});

const trayStyles = StyleSheet.create({
  content: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
    alignItems: "center",
  },
  uploadBtn: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 14,
    backgroundColor: "rgba(138,64,207,0.10)",
    borderWidth: 1.5,
    borderColor: "rgba(138,64,207,0.35)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  uploadLabel: {
    color: "#8A40CF",
    fontSize: 10,
    fontWeight: "600",
  },
  progressPct: {
    color: "#8A40CF",
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
  },
  videoFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(138,64,207,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  playBadge: {
    position: "absolute",
    top: 5,
    left: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  durBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  durText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});

const viewerStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.96)",
  },
  counter: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  closeBtn: {
    position: "absolute",
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  flagBtn: {
    position: "absolute",
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
});

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  optionText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 18,
    marginTop: 4,
  },
  cancelText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 15,
    fontWeight: "600",
  },
});
