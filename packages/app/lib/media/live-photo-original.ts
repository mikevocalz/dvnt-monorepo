import type { PublishMediaFile } from "../posts/publish-descriptor";

type SelectedMedia = PublishMediaFile & {
  originalUri?: string;
  editedUri?: string;
  editorOpened?: boolean;
};

/** The bitmap cropper cannot preserve animation or Apple's pairing metadata. */
export function canCropMedia(media: SelectedMedia): boolean {
  return media.type === "image" && media.kind === "image" && !media.pairedVideoUri;
}

/** Protect older composer drafts too, not just the current crop button. */
export function publishMediaFile(media: SelectedMedia): PublishMediaFile {
  const livePhoto = media.kind === "livePhoto" || !!media.pairedVideoUri;
  if (livePhoto && (media.editorOpened || media.editedUri) && !media.originalUri) {
    throw new Error("The original Live Photo is missing. Please remove it and select it again.");
  }
  return {
    uri: livePhoto
      ? media.originalUri || media.uri
      : media.editorOpened && media.editedUri ? media.editedUri : media.uri,
    type: media.type,
    kind: livePhoto ? "livePhoto" : media.kind,
    mimeType: media.mimeType,
    pairedVideoUri: media.pairedVideoUri,
  };
}
