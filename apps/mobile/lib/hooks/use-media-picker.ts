import { useCallback, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { Platform } from "react-native";
import { toast } from "sonner-native";
import { detectMediaKind } from "@/lib/media/detect-media-kind";
import type { MediaKind } from "@/lib/media/types";
import type { StoryAnimatedGifOverlay, StoryOverlay } from "@/lib/types";

export interface MediaAsset {
  id: string;
  uri: string;
  type: "image" | "video";
  kind: MediaKind;
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  fileName?: string;
  fileSize?: number;
  originalUri?: string;
  pairedVideoUri?: string; // Live Photo video component (iOS only)
  /** URI of the edited derivative — only set when user explicitly opens editor */
  editedUri?: string;
  /** Whether the user explicitly opened the crop/editor for this asset */
  editorOpened?: boolean;
  cropState?: {
    scale: number;
    translateX: number;
    translateY: number;
  };
  storyAnimatedGifOverlays?: StoryAnimatedGifOverlay[];
  storyOverlays?: StoryOverlay[];
}

export interface StoryMediaOptions {
  maxDuration?: number;
  maxFileSizeMB?: number;
}

const STORY_MAX_DURATION = 30;
const STORY_MAX_FILE_SIZE_MB = 50;
const STORY_ASPECT_RATIO = 9 / 16;

export function useMediaPicker() {
  const [selectedMedia, setSelectedMedia] = useState<MediaAsset[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  const requestPermissions = useCallback(async () => {
    if (Platform.OS === "web") {
      setHasPermission(true);
      return true;
    }

    const { status: cameraStatus } =
      await ImagePicker.requestCameraPermissionsAsync();
    const { status: mediaStatus } =
      await MediaLibrary.requestPermissionsAsync();

    const granted = cameraStatus === "granted" && mediaStatus === "granted";
    setHasPermission(granted);

    if (!granted) {
      toast.error("Permissions Required", {
        description:
          "Please grant camera and media library permissions to select photos and videos.",
      });
    }

    return granted;
  }, []);

  const pickFromLibrary = async (options?: {
    maxSelection?: number;
    allowsMultipleSelection?: boolean;
    mediaTypes?: ("images" | "videos" | "livePhotos")[];
  }) => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const allowMultiple = options?.allowsMultipleSelection ?? true;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: options?.mediaTypes ?? ["images", "videos"],
        allowsMultipleSelection: allowMultiple,
        quality: 1,
        videoMaxDuration: 60,
        selectionLimit: options?.maxSelection ?? 10,
      });

      if (!result.canceled && result.assets) {
        const newMedia: MediaAsset[] = result.assets
          .filter((asset) => asset.type !== "pairedVideo") // paired video handled via pairedVideoAsset
          .map((asset) => {
            const kind = detectMediaKind(
              asset.type,
              asset.mimeType,
              asset.fileName,
            );
            return {
              id: asset.assetId || asset.uri,
              uri: asset.uri,
              type: asset.type === "video" ? "video" : "image",
              kind,
              mimeType: asset.mimeType ?? undefined,
              width: asset.width,
              height: asset.height,
              duration: asset.duration ? asset.duration / 1000 : undefined,
              fileName: asset.fileName ?? undefined,
              pairedVideoUri: asset.pairedVideoAsset?.uri ?? undefined,
            };
          });

        setSelectedMedia((prev) => [...prev, ...newMedia]);
        return newMedia;
      }
    } catch (error) {
      console.error("[v0] Error picking media:", error);
      toast.error("Failed to pick media. Please try again.");
    }
  };

  const takePhoto = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const kind = detectMediaKind(
          asset.type,
          asset.mimeType,
          asset.fileName,
        );
        const newMedia: MediaAsset = {
          id: asset.assetId || asset.uri,
          uri: asset.uri,
          type: "image",
          kind,
          mimeType: asset.mimeType ?? undefined,
          width: asset.width,
          height: asset.height,
          fileName: asset.fileName ?? undefined,
        };

        setSelectedMedia((prev) => [...prev, newMedia]);
        return newMedia;
      }
    } catch (error) {
      console.error("[v0] Error taking photo:", error);
      toast.error("Failed to take photo. Please try again.");
    }
  };

  const recordVideo = async (maxDuration: number = 60) => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["videos"],
        videoMaxDuration: maxDuration,
        quality: 0.7,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const newMedia: MediaAsset = {
          id: asset.assetId || asset.uri,
          uri: asset.uri,
          type: "video",
          kind: "video",
          mimeType: asset.mimeType ?? undefined,
          width: asset.width,
          height: asset.height,
          duration: asset.duration ? asset.duration / 1000 : undefined,
          fileName: asset.fileName ?? undefined,
          fileSize: asset.fileSize ?? undefined,
        };

        setSelectedMedia((prev) => [...prev, newMedia]);
        return newMedia;
      }
    } catch (error) {
      console.error("[MediaPicker] Error recording video:", error);
      toast.error("Failed to record video. Please try again.");
    }
  };

  const pickStoryMedia = async (options?: StoryMediaOptions) => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const maxDuration = options?.maxDuration ?? STORY_MAX_DURATION;
    const maxFileSizeMB = options?.maxFileSizeMB ?? STORY_MAX_FILE_SIZE_MB;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 0.8,
        videoMaxDuration: maxDuration,
        selectionLimit: 4,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });

      if (!result.canceled && result.assets) {
        const validMedia: MediaAsset[] = [];
        const errors: string[] = [];

        for (const asset of result.assets) {
          if (asset.type === "video") {
            if (asset.duration && asset.duration / 1000 > maxDuration) {
              errors.push(`Video exceeds ${maxDuration}s limit`);
              continue;
            }

            const fileSizeMB = asset.fileSize
              ? asset.fileSize / (1024 * 1024)
              : 0;
            if (fileSizeMB > maxFileSizeMB) {
              errors.push(`Video exceeds ${maxFileSizeMB}MB limit`);
              continue;
            }

            if (asset.width && asset.height) {
              const aspectRatio = asset.width / asset.height;
              const targetRatio = STORY_ASPECT_RATIO;
              const tolerance = 0.15;

              if (Math.abs(aspectRatio - targetRatio) > tolerance) {
                console.log(
                  `[MediaPicker] Video aspect ratio ${aspectRatio.toFixed(2)} differs from 9:16 (${targetRatio.toFixed(2)}), will be cropped to fit`,
                );
              }
            }
          }

          validMedia.push({
            id: asset.assetId || asset.uri,
            uri: asset.uri,
            type: asset.type === "video" ? "video" : "image",
            kind: detectMediaKind(asset.type, asset.mimeType, asset.fileName),
            mimeType: asset.mimeType ?? undefined,
            width: asset.width,
            height: asset.height,
            duration: asset.duration ? asset.duration / 1000 : undefined,
            fileName: asset.fileName ?? undefined,
            fileSize: asset.fileSize ?? undefined,
            pairedVideoUri: asset.pairedVideoAsset?.uri ?? undefined,
          });
        }

        if (errors.length > 0) {
          toast.warning("Some media couldn't be added", {
            description: errors.join(", "),
          });
        }

        if (validMedia.length > 0) {
          setSelectedMedia((prev) => [...prev, ...validMedia]);
          return validMedia;
        }
      }
    } catch (error) {
      console.error("[MediaPicker] Error picking story media:", error);
      toast.error("Failed to pick media. Please try again.");
    }
  };

  const recordStoryVideo = async (options?: StoryMediaOptions) => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    const maxDuration = options?.maxDuration ?? STORY_MAX_DURATION;
    const maxFileSizeMB = options?.maxFileSizeMB ?? STORY_MAX_FILE_SIZE_MB;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["videos"],
        videoMaxDuration: maxDuration,
        quality: 0.7,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];

        if (asset.duration && asset.duration / 1000 > maxDuration) {
          toast.error("Video Too Long", {
            description: `Story videos must be ${maxDuration} seconds or less.`,
          });
          return;
        }

        const fileSizeMB = asset.fileSize ? asset.fileSize / (1024 * 1024) : 0;
        if (fileSizeMB > maxFileSizeMB) {
          toast.error("Video Too Large", {
            description: `Video file size (${fileSizeMB.toFixed(1)}MB) exceeds the ${maxFileSizeMB}MB limit.`,
          });
          return;
        }

        const newMedia: MediaAsset = {
          id: asset.assetId || asset.uri,
          uri: asset.uri,
          type: "video",
          kind: "video",
          mimeType: asset.mimeType ?? undefined,
          width: asset.width,
          height: asset.height,
          duration: asset.duration ? asset.duration / 1000 : undefined,
          fileName: asset.fileName ?? undefined,
          fileSize: asset.fileSize ?? undefined,
        };

        console.log(
          `[MediaPicker] Story video recorded: ${asset.duration?.toFixed(1)}s, ${fileSizeMB.toFixed(1)}MB`,
        );
        setSelectedMedia((prev) => [...prev, newMedia]);
        return newMedia;
      }
    } catch (error) {
      console.error("[MediaPicker] Error recording story video:", error);
      toast.error("Failed to record video. Please try again.");
    }
  };

  const removeMedia = (id: string) => {
    setSelectedMedia((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = () => {
    setSelectedMedia([]);
  };

  return {
    selectedMedia,
    hasPermission,
    pickFromLibrary,
    takePhoto,
    recordVideo,
    removeMedia,
    clearAll,
    requestPermissions,
    pickStoryMedia,
    recordStoryVideo,
    STORY_MAX_DURATION,
    STORY_MAX_FILE_SIZE_MB,
  };
}
