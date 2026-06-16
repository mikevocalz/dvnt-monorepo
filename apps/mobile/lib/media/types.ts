/**
 * Media Pipeline Types
 * Production-grade TypeScript definitions
 */

export type MediaType = "image" | "video";
export type MediaKind = "image" | "gif" | "video" | "livePhoto" | "animated_video";

export type BucketName =
  | "avatars"
  | "images"
  | "videos"
  | "stories"
  | "gifs"
  | "temp";

export type MediaUseCase = "avatar" | "feed" | "story" | "message" | "event";

export interface MediaConstraints {
  maxSizeBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxDurationSeconds?: number; // For videos only
  targetFormat: "webp" | "mp4";
  compressionQuality: number; // 0.0 - 1.0
}

export interface ProcessedMedia {
  uri: string;
  type: MediaType;
  kind: MediaKind;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds?: number;
  hash: string;
  posterUri?: string; // For videos
  pairedVideoUri?: string; // For Live Photos (iOS)
}

export interface UploadedMedia {
  id: number;
  publicUrl: string;
  storagePath: string;
  hash: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds?: number;
  kind?: MediaKind;
  livePhotoVideoUrl?: string;
}

// Hard limits by use case (cost-optimized)
export const MEDIA_CONSTRAINTS: Record<MediaUseCase, MediaConstraints> = {
  avatar: {
    maxSizeBytes: 2 * 1024 * 1024, // 2MB
    maxWidth: 512,
    maxHeight: 512,
    targetFormat: "webp",
    compressionQuality: 0.75,
  },
  feed: {
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    maxWidth: 1280,
    maxHeight: 1280,
    targetFormat: "webp",
    compressionQuality: 0.7,
  },
  story: {
    maxSizeBytes: 30 * 1024 * 1024, // 30MB
    maxWidth: 1080,
    maxHeight: 1920,
    maxDurationSeconds: 60,
    targetFormat: "mp4",
    compressionQuality: 0.7,
  },
  message: {
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    maxWidth: 1280,
    maxHeight: 1280,
    maxDurationSeconds: 30,
    targetFormat: "webp",
    compressionQuality: 0.65,
  },
  event: {
    maxSizeBytes: 8 * 1024 * 1024, // 8MB
    maxWidth: 1440,
    maxHeight: 1440,
    targetFormat: "webp",
    compressionQuality: 0.75,
  },
};

export interface VideoInfo {
  uri: string;
  width: number;
  height: number;
  duration: number; // seconds
  size: number; // bytes
}

export interface ValidationError {
  field: string;
  message: string;
  current: number;
  max: number;
}
