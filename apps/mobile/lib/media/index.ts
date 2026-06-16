/**
 * High-Level Media API
 * Combines processing + upload into simple interface
 */

import * as ImagePicker from "expo-image-picker";
import { Camera, CameraView } from "expo-camera";
import { processImage } from "./image-processor";
import { processVideo, getOptimalCameraPreset } from "./video-processor";
import { uploadMedia, uploadMediaBatch } from "./uploader";
import { MEDIA_CONSTRAINTS, MediaUseCase, UploadedMedia } from "./types";

/**
 * Pick and upload image from library
 * Complete flow: pick → validate → process → dedupe → upload
 *
 * @example
 * const media = await pickAndUploadImage('avatar', (progress) => {
 *   console.log(`Upload: ${Math.round(progress * 100)}%`);
 * });
 */
export async function pickAndUploadImage(
  useCase: MediaUseCase,
  onProgress?: (progress: number) => void,
): Promise<UploadedMedia> {
  // Step 1: Request permissions
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Camera roll permission denied");
  }

  // Step 2: Pick image
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsEditing: true,
    aspect: useCase === "avatar" ? [1, 1] : undefined,
    quality: 1, // Max quality (we'll compress ourselves)
  });

  if (result.canceled) {
    throw new Error("Image selection cancelled");
  }

  const asset = result.assets[0];
  onProgress?.(0.2);

  // Step 3: Process image (resize, compress, hash)
  const constraints = MEDIA_CONSTRAINTS[useCase];
  const processed = await processImage(asset.uri, constraints);
  onProgress?.(0.5);

  // Step 4: Upload (with deduplication)
  const uploaded = await uploadMedia(processed, useCase, (uploadProgress) => {
    onProgress?.(0.5 + uploadProgress * 0.5); // Map 0-1 to 0.5-1.0
  });

  return uploaded;
}

/**
 * Pick and upload video from library
 * Complete flow: pick → validate → process → dedupe → upload
 *
 * @example
 * const media = await pickAndUploadVideo('story', (progress) => {
 *   console.log(`Upload: ${Math.round(progress * 100)}%`);
 * });
 */
export async function pickAndUploadVideo(
  useCase: "story" | "message",
  onProgress?: (progress: number) => void,
): Promise<UploadedMedia> {
  // Step 1: Request permissions
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Camera roll permission denied");
  }

  // Step 2: Pick video
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "videos",
    allowsEditing: false,
    quality: 1,
    videoMaxDuration: MEDIA_CONSTRAINTS[useCase].maxDurationSeconds,
  });

  if (result.canceled) {
    throw new Error("Video selection cancelled");
  }

  const asset = result.assets[0];
  onProgress?.(0.1);

  // Step 3: Validate and process
  const constraints = MEDIA_CONSTRAINTS[useCase];
  const processed = await processVideo(asset.uri, constraints);
  onProgress?.(0.4);

  // Step 4: Upload
  const uploaded = await uploadMedia(processed, useCase, (uploadProgress) => {
    onProgress?.(0.4 + uploadProgress * 0.6);
  });

  return uploaded;
}

/**
 * Capture and upload photo from camera
 * Optimized for quick capture → upload flow
 */
export async function captureAndUploadPhoto(
  cameraRef: React.RefObject<CameraView>,
  useCase: MediaUseCase,
  onProgress?: (progress: number) => void,
): Promise<UploadedMedia> {
  if (!cameraRef.current) {
    throw new Error("Camera not ready");
  }

  // Step 1: Capture photo
  const photo = await cameraRef.current.takePictureAsync({
    quality: 1,
    skipProcessing: false, // Let system apply basic processing
  });

  if (!photo) {
    throw new Error("Failed to capture photo");
  }

  onProgress?.(0.2);

  // Step 2: Process
  const constraints = MEDIA_CONSTRAINTS[useCase];
  const processed = await processImage(photo.uri, constraints);
  onProgress?.(0.5);

  // Step 3: Upload
  const uploaded = await uploadMedia(processed, useCase, (uploadProgress) => {
    onProgress?.(0.5 + uploadProgress * 0.5);
  });

  return uploaded;
}

/**
 * Record and upload video from camera
 * Uses optimal camera presets to minimize processing
 */
export async function recordAndUploadVideo(
  cameraRef: React.RefObject<CameraView>,
  useCase: "story" | "message",
  onProgress?: (progress: number) => void,
): Promise<UploadedMedia> {
  if (!cameraRef.current) {
    throw new Error("Camera not ready");
  }

  // Get optimal recording settings
  const preset = getOptimalCameraPreset(useCase);

  // Step 1: Record video with optimal settings
  const video = await cameraRef.current.recordAsync({
    maxDuration: preset.videoMaxDuration,
    // Note: React Native Camera doesn't support direct bitrate/quality control
    // Users should use device camera settings or record manually
  });

  if (!video) {
    throw new Error("Failed to record video");
  }

  onProgress?.(0.2);

  // Step 2: Validate and process
  const constraints = MEDIA_CONSTRAINTS[useCase];
  const processed = await processVideo(video.uri, constraints);
  onProgress?.(0.4);

  // Step 3: Upload
  const uploaded = await uploadMedia(processed, useCase, (uploadProgress) => {
    onProgress?.(0.4 + uploadProgress * 0.6);
  });

  return uploaded;
}

/**
 * Pick and upload multiple images (for posts with galleries)
 *
 * @example
 * const mediaList = await pickAndUploadMultipleImages('feed', 5, (index, progress) => {
 *   console.log(`Image ${index + 1}: ${Math.round(progress * 100)}%`);
 * });
 */
export async function pickAndUploadMultipleImages(
  useCase: MediaUseCase,
  maxCount: number = 10,
  onProgress?: (index: number, progress: number) => void,
): Promise<UploadedMedia[]> {
  // Step 1: Request permissions
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Camera roll permission denied");
  }

  // Step 2: Pick multiple images
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsMultipleSelection: true,
    selectionLimit: maxCount,
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    throw new Error("No images selected");
  }

  // Step 3: Process all images
  const constraints = MEDIA_CONSTRAINTS[useCase];
  const processedList = [];

  for (let i = 0; i < result.assets.length; i++) {
    const asset = result.assets[i];
    onProgress?.(i, 0.5);

    const processed = await processImage(asset.uri, constraints);
    processedList.push(processed);

    onProgress?.(i, 1);
  }

  // Step 4: Batch upload
  const uploaded = await uploadMediaBatch(processedList, useCase, onProgress);

  return uploaded;
}

/**
 * Get optimal camera configuration
 * Apply these settings before recording to enforce limits upfront
 *
 * @example
 * const cameraProps = getOptimalCameraConfig('story');
 * <Camera {...cameraProps} ref={cameraRef} />
 */
export function getOptimalCameraConfig(useCase: "story" | "message") {
  const preset = getOptimalCameraPreset(useCase);

  return {
    // Video quality preset
    videoQuality: preset.videoQuality,

    // Recommended: Disable HDR and high frame rates
    enableHighQualityPhotos: false,

    // For stories: prefer portrait, for messages: no preference
    aspect: useCase === "story" ? ("9:16" as const) : ("4:3" as const),
  };
}

/**
 * Persist verification photo to local storage
 * Used during ID/face verification flow
 */
export async function persistVerificationPhoto(
  uri: string,
  type: "id" | "selfie",
): Promise<string> {
  try {
    // For now, just return the URI as-is
    // In production, this would save to secure storage
    console.log(`[Media] Persisting ${type} verification photo:`, uri);
    return uri;
  } catch (error) {
    console.error("[Media] persistVerificationPhoto error:", error);
    throw error;
  }
}
