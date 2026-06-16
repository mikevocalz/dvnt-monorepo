/**
 * CameraScreen — Instagram-level camera experience
 *
 * Architecture:
 * - Zustand store for ALL state (zero useState)
 * - Shallow selectors isolate camera preview from UI state
 * - Reanimated for recording HUD / animations (UI thread)
 * - NativeWind for all styling
 * - Lucide icons only
 * - Post-capture review inline (Edit / Retake / Next)
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  Camera,
  type CameraRef,
  type Recorder,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  usePhotoOutput,
  useVideoOutput,
} from "react-native-vision-camera";
import {
  X,
  Zap,
  ZapOff,
  RotateCcw,
  Image as ImageIcon,
  Camera as CameraIcon,
  RefreshCw,
  ArrowRight,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as MediaLibrary from "expo-media-library";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useStoryCaptureStore } from "./stores/useStoryCaptureStore";

// ---- Types (re-exported from index.ts) ----

export interface CapturedMedia {
  uri: string;
  type: "image" | "video";
  width?: number;
  height?: number;
  duration?: number;
}

interface CameraScreenProps {
  onCapture: (media: CapturedMedia) => void;
  onClose: () => void;
  allowedModes?: ("photo" | "video")[];
  maxVideoDuration?: number;
  showGallery?: boolean;
  onGalleryPress?: () => void;
}

// ---- Recording HUD (Reanimated — UI thread) ----

const RecordingHUD: React.FC<{ maxDuration: number }> = React.memo(
  ({ maxDuration }) => {
    const insets = useSafeAreaInsets();
    const recordingStartTs = useStoryCaptureStore((s) => s.recordingStartTs);

    // Pulsing red dot
    const dotOpacity = useSharedValue(1);
    useEffect(() => {
      dotOpacity.value = withRepeat(
        withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }, [dotOpacity]);

    const dotStyle = useAnimatedStyle(() => ({
      opacity: dotOpacity.value,
    }));

    // Elapsed time (derived from startTs, updated every second via store)
    const elapsed = recordingStartTs
      ? Math.floor((Date.now() - recordingStartTs) / 1000)
      : 0;
    const fmtDur = (s: number) =>
      `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(200)}
        style={{
          position: "absolute",
          alignSelf: "center",
          top: insets.top + 16,
        }}
        className="flex-row items-center bg-black/60 px-3 py-1.5 rounded-xl gap-1.5"
      >
        <Animated.View
          style={dotStyle}
          className="w-2 h-2 rounded-full bg-red-500"
        />
        <Text
          className="text-white text-base font-bold"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {fmtDur(elapsed)}
        </Text>
        <Text className="text-[#3FDCFF]/70 text-sm">
          / {fmtDur(maxDuration)}
        </Text>
      </Animated.View>
    );
  },
);
RecordingHUD.displayName = "RecordingHUD";

// ---- Post-Capture Review ----

const CaptureReview: React.FC<{
  onRetake: () => void;
  onNext: () => void;
}> = React.memo(({ onRetake, onNext }) => {
  const insets = useSafeAreaInsets();
  const lastCapture = useStoryCaptureStore((s) => s.lastCapture);
  const videoSource = lastCapture?.type === "video" ? lastCapture.uri : null;
  const player = useVideoPlayer(videoSource, (instance) => {
    instance.loop = true;
    instance.muted = false;
    instance.play();
  });

  if (!lastCapture) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(200)}
      className="absolute inset-0 bg-black"
    >
      {/* Preview */}
      <View className="flex-1 rounded-[20px] overflow-hidden m-1">
        {lastCapture.type === "image" ? (
          <Image
            source={{ uri: lastCapture.uri }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
        ) : (
          <View className="flex-1 bg-neutral-900">
            <VideoView
              player={player}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              nativeControls={false}
            />
          </View>
        )}
      </View>

      {/* Top — Retake */}
      <View
        style={{
          position: "absolute",
          top: insets.top + 12,
          left: 16,
          right: 16,
        }}
        className="flex-row justify-between items-center"
      >
        <Pressable
          onPress={onRetake}
          hitSlop={16}
          className="w-9 h-9 rounded-xl bg-black/50 items-center justify-center"
        >
          <RefreshCw size={20} color="#fff" strokeWidth={2.5} />
        </Pressable>
      </View>

      {/* Bottom — Use Photo */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: insets.bottom + 20,
          paddingHorizontal: 24,
        }}
      >
        <Pressable
          onPress={onNext}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: "#3EA4E5",
            paddingVertical: 16,
            borderRadius: 16,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>
            {lastCapture.type === "video" ? "Use Video" : "Use Photo"}
          </Text>
          <ArrowRight size={20} color="#fff" strokeWidth={2.5} />
        </Pressable>
      </View>
    </Animated.View>
  );
});
CaptureReview.displayName = "CaptureReview";

// ---- Isolated Camera Preview ----
// Only re-renders when camera-critical state changes (facing, mode, flash).

type CameraPreviewProps = {
  isActive: boolean;
  photoOutput: ReturnType<typeof usePhotoOutput>;
  videoOutput: ReturnType<typeof useVideoOutput>;
};

const CameraPreview = React.memo(
  React.forwardRef<CameraRef, CameraPreviewProps>(
    ({ isActive, photoOutput, videoOutput }, ref) => {
      const mode = useStoryCaptureStore((s) => s.mode);
      const facing = useStoryCaptureStore((s) => s.facing);
      const flash = useStoryCaptureStore((s) => s.flash);
      const device = useCameraDevice(facing);

      if (!device) return null;

      return (
        <Camera
          ref={ref}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
          device={device}
          isActive={isActive}
          outputs={mode === "photo" ? [photoOutput] : [videoOutput]}
          torchMode={mode === "video" && flash === "on" ? "on" : "off"}
          enableNativeZoomGesture={true}
        />
      );
    },
  ),
);
CameraPreview.displayName = "CameraPreview";

// ---- Perf HUD ----

const CapturePerfHUD: React.FC = React.memo(() => {
  const renderCount = useRef(0);
  renderCount.current++;

  const mode = useStoryCaptureStore((s) => s.mode);
  const isRecording = useStoryCaptureStore((s) => s.isRecording);
  const facing = useStoryCaptureStore((s) => s.facing);

  return (
    <View className="absolute top-24 left-4 bg-black/80 p-2 rounded-xl z-50">
      <Text className="text-green-400 text-xs font-mono">
        Renders: {renderCount.current}
      </Text>
      <Text className="text-green-400 text-xs font-mono">
        Mode: {mode} | Facing: {facing}
      </Text>
      <Text className="text-green-400 text-xs font-mono">
        Recording: {isRecording ? "YES" : "NO"}
      </Text>
    </View>
  );
});
CapturePerfHUD.displayName = "CapturePerfHUD";

// ---- Main CameraScreen ----

export function CameraScreen({
  onCapture,
  onClose,
  allowedModes = ["photo", "video"],
  maxVideoDuration = 60,
  showGallery = true,
  onGalleryPress,
}: CameraScreenProps) {
  const insets = useSafeAreaInsets();
  const allowedModesKey = allowedModes.join(",");
  const cameraRef = useRef<CameraRef>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const photoOutput = usePhotoOutput();
  const videoOutput = useVideoOutput({ enableAudio: true });
  const requiresMicrophone = allowedModes.includes("video");

  const { hasPermission: hasCamPerm, requestPermission: reqCamPerm } =
    useCameraPermission();
  const { hasPermission: hasMicPerm, requestPermission: reqMicPerm } =
    useMicrophonePermission();

  // ---- Zustand selectors ----
  const mode = useStoryCaptureStore((s) => s.mode);
  const facing = useStoryCaptureStore((s) => s.facing);
  const flash = useStoryCaptureStore((s) => s.flash);
  const isRecording = useStoryCaptureStore((s) => s.isRecording);
  const isTakingPhoto = useStoryCaptureStore((s) => s.isTakingPhoto);
  const lastCapture = useStoryCaptureStore((s) => s.lastCapture);
  const permissionsReady = useStoryCaptureStore((s) => s.permissionsReady);
  const lastGalleryThumb = useStoryCaptureStore((s) => s.lastGalleryThumb);
  const showPerfHUD = useStoryCaptureStore((s) => s.showPerfHUD);

  // Must be called before any conditional returns (Rules of Hooks)
  const device = useCameraDevice(facing);

  // ---- Actions ----
  const setMode = useStoryCaptureStore((s) => s.setMode);
  const toggleFacing = useStoryCaptureStore((s) => s.toggleFacing);
  const cycleFlash = useStoryCaptureStore((s) => s.cycleFlash);
  const setPermReady = useStoryCaptureStore((s) => s.setPermissionsReady);
  const setIsTakingPhoto = useStoryCaptureStore((s) => s.setIsTakingPhoto);
  const startRec = useStoryCaptureStore((s) => s.startRecording);
  const stopRec = useStoryCaptureStore((s) => s.stopRecording);
  const setLastCapture = useStoryCaptureStore((s) => s.setLastCapture);
  const setLastGalleryThumb = useStoryCaptureStore(
    (s) => s.setLastGalleryThumb,
  );
  const resetStore = useStoryCaptureStore((s) => s.reset);

  // Recording timer ref (drives the recording HUD re-render once/sec)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Permissions ----
  useEffect(() => {
    (async () => {
      const cam = await reqCamPerm();
      const mic = requiresMicrophone ? await reqMicPerm() : true;
      setPermReady(cam && mic);
    })();
  }, [reqCamPerm, reqMicPerm, requiresMicrophone, setPermReady]);

  // ---- Gallery thumb (deferred — non-blocking) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === "granted" && !cancelled) {
          const assets = await MediaLibrary.getAssetsAsync({
            first: 1,
            sortBy: ["creationTime"],
            mediaType: ["photo", "video"],
          });
          if (assets.assets.length > 0 && !cancelled) {
            setLastGalleryThumb(assets.assets[0].uri);
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [setLastGalleryThumb]);

  // ---- Cleanup recording timer ----
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  // Keep the internal capture mode aligned with the route mode restrictions.
  useEffect(() => {
    const preferredMode = allowedModes[0] ?? "photo";
    const currentMode = useStoryCaptureStore.getState().mode;

    if (
      (allowedModes.length === 1 && currentMode !== preferredMode) ||
      !allowedModes.includes(currentMode)
    ) {
      setMode(preferredMode);
    }
  }, [allowedModesKey, setMode]);

  // ---- Reset store on mount (clear stale state) + unmount ----
  useEffect(() => {
    setLastCapture(null);
    return () => resetStore();
  }, [resetStore, setLastCapture]);

  // ---- Handlers ----

  const handleFlip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleFacing();
  }, [toggleFacing]);

  const handleFlash = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    cycleFlash();
  }, [cycleFlash]);

  const handleTakePhoto = useCallback(async () => {
    if (!cameraRef.current || useStoryCaptureStore.getState().isTakingPhoto)
      return;
    setIsTakingPhoto(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const flashVal = useStoryCaptureStore.getState().flash;
      const photo = await photoOutput.capturePhoto(
        {
          flashMode:
            flashVal === "auto" ? "auto" : flashVal === "on" ? "on" : "off",
          enableShutterSound: true,
        },
        {},
      );
      const filePath = await photo.saveToTemporaryFileAsync();
      const uri =
        filePath.startsWith("file://") ? filePath : `file://${filePath}`;
      setLastCapture({
        uri,
        type: "image",
        width: photo.width,
        height: photo.height,
      });
    } catch (e) {
      console.error("[Camera] Photo error:", e);
    } finally {
      setIsTakingPhoto(false);
    }
  }, [photoOutput, setIsTakingPhoto, setLastCapture]);

  const handleStopRecording = useCallback(async () => {
    if (!recorderRef.current || !useStoryCaptureStore.getState().isRecording)
      return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    try {
      await recorderRef.current.stopRecording();
    } catch (e) {
      console.error("[Camera] Stop error:", e);
      recorderRef.current = null;
      stopRec();
    }
  }, [stopRec]);

  const handleStartRecording = useCallback(async () => {
    if (!cameraRef.current || useStoryCaptureStore.getState().isRecording)
      return;
    startRec();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // Timer — only updates the store's recordingStartTs was set;
    // RecordingHUD reads elapsed from the timestamp.
    // We use a lightweight interval that auto-stops at max duration.
    recordingTimerRef.current = setInterval(() => {
      const { recordingStartTs } = useStoryCaptureStore.getState();
      if (!recordingStartTs) return;
      const elapsed = Math.floor((Date.now() - recordingStartTs) / 1000);
      if (elapsed >= maxVideoDuration) {
        handleStopRecording();
      }
    }, 1000);

    try {
      const recorder = await videoOutput.createRecorder({});
      recorderRef.current = recorder;
      await recorder.startRecording(
        (filePath: string) => {
          const uri =
            filePath.startsWith("file://") ? filePath : `file://${filePath}`;
          setLastCapture({
            uri,
            type: "video",
            duration: recorder.recordedDuration,
          });
          recorderRef.current = null;
          stopRec();
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
        },
        (err: Error) => {
          console.error("[Camera] Recording error:", err);
          recorderRef.current = null;
          stopRec();
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
        },
      );
    } catch (e) {
      console.error("[Camera] Start error:", e);
      recorderRef.current = null;
      stopRec();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [
    maxVideoDuration,
    startRec,
    stopRec,
    videoOutput,
    setLastCapture,
    handleStopRecording,
  ]);

  const handleCapture = useCallback(() => {
    if (mode === "photo") handleTakePhoto();
    else if (isRecording) handleStopRecording();
    else handleStartRecording();
  }, [
    mode,
    isRecording,
    handleTakePhoto,
    handleStartRecording,
    handleStopRecording,
  ]);

  // ---- Post-capture handlers ----
  const handleRetake = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLastCapture(null);
  }, [setLastCapture]);

  const handleNext = useCallback(() => {
    if (!lastCapture) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCapture(lastCapture);
  }, [lastCapture, onCapture]);

  // ---- Permission screen ----
  if (!permissionsReady) {
    return (
      <View
        className="flex-1 bg-black items-center justify-center gap-4"
        style={{ paddingTop: insets.top }}
      >
        <CameraIcon size={48} color="#666" />
        <Text className="text-white/60 text-base text-center mt-3">
          Camera & mic access required
        </Text>
        <Pressable
          onPress={async () => {
            const c = await reqCamPerm();
            const m = requiresMicrophone ? await reqMicPerm() : true;
            setPermReady(c && m);
          }}
          className="bg-[#3EA4E5] px-6 py-3 rounded-xl"
        >
          <Text className="text-white text-base font-semibold">
            Grant Access
          </Text>
        </Pressable>
        <Pressable onPress={onClose} className="mt-4">
          <Text className="text-white/50 text-base">Cancel</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View
        className="flex-1 bg-black items-center justify-center gap-4"
        style={{ paddingTop: insets.top }}
      >
        <ActivityIndicator size="large" color="#fff" />
        <Text className="text-white/60 text-base">Loading camera...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* Camera Preview — isolated component, minimal re-renders */}
      <View
        style={{
          flex: 1,
          borderRadius: 20,
          overflow: "hidden",
          margin: 4,
        }}
      >
        <CameraPreview
          ref={cameraRef}
          isActive={!lastCapture}
          photoOutput={photoOutput}
          videoOutput={videoOutput}
        />

        {/* Recording HUD */}
        {isRecording && <RecordingHUD maxDuration={maxVideoDuration} />}
      </View>

      {/* ---- Controls overlay ----
           Single full-screen layer above the native Camera.
           pointerEvents="box-none" lets taps pass through to camera
           for zoom gestures, while children (buttons) capture taps. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        {/* Top Controls */}
        {!lastCapture && (
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            style={{
              position: "absolute",
              top: insets.top + 12,
              left: 16,
              right: 16,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Pressable
              onPress={onClose}
              hitSlop={16}
              style={{
                width: 44,
                height: 44,
                borderRadius: 11,
                backgroundColor: "rgba(0,0,0,0.5)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={26} color="#fff" strokeWidth={2.5} />
            </Pressable>

            <Pressable
              onPress={handleFlash}
              hitSlop={16}
              style={{
                width: 44,
                height: 44,
                borderRadius: 16,
                backgroundColor: "rgba(0,0,0,0.3)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {flash === "off" ? (
                <ZapOff size={24} color="#fff" />
              ) : (
                <View>
                  <Zap
                    size={24}
                    color={flash === "auto" ? "#FFD700" : "#fff"}
                    fill={flash === "on" ? "#fff" : "none"}
                  />
                  {flash === "auto" && (
                    <Text
                      style={{
                        position: "absolute",
                        bottom: -1,
                        right: -1,
                        color: "#FFD700",
                        fontSize: 11,
                        fontWeight: "800",
                      }}
                    >
                      A
                    </Text>
                  )}
                </View>
              )}
            </Pressable>
          </Animated.View>
        )}

        {/* Mode Toggle */}
        {allowedModes.length > 1 && !isRecording && !lastCapture && (
          <View
            style={{
              position: "absolute",
              alignSelf: "center",
              bottom: insets.bottom + 130,
              flexDirection: "row",
              gap: 32,
              backgroundColor: "rgba(0,0,0,0.4)",
              paddingHorizontal: 24,
              paddingVertical: 10,
              borderRadius: 16,
            }}
          >
            {allowedModes.map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  setMode(m);
                  Haptics.selectionAsync();
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    letterSpacing: 2,
                    color: mode === m ? "#FFFFFF" : "#3FDCFF",
                  }}
                >
                  {m === "photo" ? "PHOTO" : "VIDEO"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Bottom Controls */}
        {!lastCapture && (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              paddingBottom: insets.bottom + 28,
              paddingTop: 40,
              paddingHorizontal: 24,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            {/* Gallery */}
            <View style={{ width: 56, alignItems: "center" }}>
              {showGallery && (
                <Pressable
                  onPress={onGalleryPress}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    overflow: "hidden",
                    borderWidth: 2,
                    borderColor: "rgba(255,255,255,0.4)",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "rgba(0,0,0,0.3)",
                  }}
                >
                  {lastGalleryThumb ? (
                    <Image
                      source={{ uri: lastGalleryThumb }}
                      style={{ width: "100%", height: "100%" }}
                      contentFit="cover"
                      pointerEvents="none"
                    />
                  ) : (
                    <ImageIcon size={28} color="#fff" />
                  )}
                </Pressable>
              )}
            </View>

            {/* Capture Button */}
            <Pressable
              onPress={handleCapture}
              disabled={isTakingPhoto}
              style={{
                width: 88,
                height: 88,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Gradient ring (outer) */}
              <LinearGradient
                colors={["#34A2DF", "#8A40CF", "#FF5BFC"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 26,
                }}
              />
              {/* Dark mask — hides gradient center, leaves only the ring */}
              <View
                style={{
                  position: "absolute",
                  top: 5,
                  left: 5,
                  right: 5,
                  bottom: 5,
                  borderRadius: 21,
                  backgroundColor: "rgba(0,0,0,0.)",
                }}
              />
              {/* Inner content */}
              {mode === "photo" ? (
                <View
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: 18,
                    backgroundColor: "#FFFFFF",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isTakingPhoto && (
                    <ActivityIndicator size="small" color="#000" />
                  )}
                </View>
              ) : isRecording ? (
                <View
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: 18,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundColor: "#EF4444",
                    }}
                  />
                </View>
              ) : (
                <View
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: 18,
                    backgroundColor: "#EF4444",
                  }}
                />
              )}
            </Pressable>

            {/* Flip camera */}
            <View style={{ width: 56, alignItems: "center" }}>
              <Pressable
                onPress={handleFlip}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 16,
                  backgroundColor: "rgba(0,0,0,0.4)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RotateCcw size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        )}

        {/* Post-Capture Review */}
        {lastCapture && (
          <CaptureReview onRetake={handleRetake} onNext={handleNext} />
        )}

        {/* Perf HUD (debug) */}
        {showPerfHUD && <CapturePerfHUD />}
      </View>
    </View>
  );
}
