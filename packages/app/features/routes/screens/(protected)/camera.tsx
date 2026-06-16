/**
 * Camera Route — opens the custom Vision Camera screen.
 *
 * Query params:
 *   mode: "photo" | "video" | "both" (default "both")
 *   source: "story" | "post" | "chat" | "profile" | "event" (for routing back)
 *   maxDuration: max video seconds (default 60)
 *
 * Returns captured media via the global camera result store.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { CameraScreen, type CapturedMedia } from "@dvnt/app/src/camera";
import * as ImagePicker from "expo-image-picker";
import { useCameraResultStore } from "@dvnt/app/lib/stores/camera-result-store";

function CameraRouteContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    source?: string;
    maxDuration?: string;
  }>();

  const setResult = useCameraResultStore((s) => s.setResult);

  const modeParam = params.mode ?? "both";
  const allowedModes =
    modeParam === "photo"
      ? (["photo"] as const)
      : modeParam === "video"
        ? (["video"] as const)
        : (["photo", "video"] as const);

  const maxDuration = params.maxDuration
    ? parseInt(params.maxDuration, 10)
    : 60;

  const handleCapture = (media: CapturedMedia) => {
    setResult(media);
    router.back();
  };

  const handleClose = () => {
    router.back();
  };

  const handleGalleryPress = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 0.8,
      videoMaxDuration: maxDuration,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setResult({
        uri: asset.uri,
        type: asset.type === "video" ? "video" : "image",
        width: asset.width,
        height: asset.height,
        duration: asset.duration ? asset.duration / 1000 : undefined,
      });
      router.back();
    }
  };

  return (
    <CameraScreen
      onCapture={handleCapture}
      onClose={handleClose}
      allowedModes={[...allowedModes]}
      maxVideoDuration={maxDuration}
      showGallery={true}
      onGalleryPress={handleGalleryPress}
    />
  );
}

export default function CameraRoute() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="Camera" onGoBack={() => router.back()}>
      <CameraRouteContent />
    </ErrorBoundary>
  );
}
