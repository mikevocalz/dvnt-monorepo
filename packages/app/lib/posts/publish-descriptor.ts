import type { TextPostThemeKey } from "@dvnt/app/lib/types";

/** A picked file, pointed at an app-storage copy once the job has run once. */
export interface PublishMediaFile {
  uri: string;
  type: "image" | "video";
  kind?: string;
  mimeType?: string;
  pairedVideoUri?: string;
}

/** An upload that already landed, in the shape create-post takes. */
export interface PublishUploadedMedia {
  type: "image" | "video";
  url: string;
  mimeType?: string;
  thumbnail?: string;
  livePhotoVideoUrl?: string;
}

export interface PublishPlacedTag {
  userId: number;
  x: number;
  y: number;
  mediaIndex: number;
}

/** Everything needed to rebuild a publish after the app was killed. */
export interface PublishDescriptor {
  /** Server dedupe key. A resumed job replays it and reconciles to the existing post. */
  operationId: string;
  postKind: "text" | "media";
  content: string;
  slides: string[];
  textTheme: TextPostThemeKey;
  location: string;
  isNSFW: boolean;
  files: PublishMediaFile[];
  placedTags: PublishPlacedTag[];
  /** Index-aligned with files. Persisted so a resume sends the same payload. */
  uploaded: Array<PublishUploadedMedia | null>;
}

export type PublishTask = (
  report: (message: string) => void,
  save: (descriptor: PublishDescriptor) => void,
) => Promise<void>;
