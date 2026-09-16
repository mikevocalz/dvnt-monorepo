import { useCallback, useEffect, useMemo } from "react";
import { Platform } from "react-native";
import { useCreatePost } from "@dvnt/app/lib/hooks/use-posts";
import { useMediaUpload, type MediaFile } from "@dvnt/app/lib/hooks/use-media-upload";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { postPublishQueue, type PublishQueueStorage } from "@dvnt/app/lib/posts/publish-queue";
import { createPublishTask, type PublishTaskDeps } from "@dvnt/app/lib/posts/publish-task";
import type { PublishDescriptor, PublishMediaFile } from "@dvnt/app/lib/posts/publish-descriptor";
import { postTagsApi } from "@dvnt/app/lib/api/post-tags";
import { TEXT_POST_MAX_LENGTH } from "@dvnt/app/lib/posts/text-post";
import {
  POST_MEDIA_SCOPE,
  deletePersistedMediaSelection,
  persistLocalMediaSelection,
} from "@dvnt/app/lib/media/persist-local-selection";
import { storage } from "@dvnt/app/lib/utils/storage";

type Draft = ReturnType<typeof useCreatePostStore.getState>;

const queueStorage: PublishQueueStorage = {
  getItem: (key) => (storage.getItem(key) as string | null) ?? null,
  setItem: (key, value) => void storage.setItem(key, value),
  removeItem: (key) => void storage.removeItem(key),
};

const releaseMedia = (descriptor: PublishDescriptor) => {
  for (const file of descriptor.files) {
    void deletePersistedMediaSelection(file.uri);
    if (file.pairedVideoUri) void deletePersistedMediaSelection(file.pairedVideoUri);
  }
};

// A browser tab close is not recoverable: an object URL dies with the document
// and there is no app storage to copy the file into. Web keeps the in-memory
// queue only, so nothing there claims a post will resume.
if (Platform.OS !== "web") {
  postPublishQueue.configure({ storage: queueStorage, release: releaseMedia });
}

function usePublishTaskDeps(): PublishTaskDeps {
  const { mutateAsync: createPost } = useCreatePost();
  const { uploadMultiple } = useMediaUpload({ folder: "posts" });
  return useMemo<PublishTaskDeps>(() => ({
    currentOwnerId: () => {
      const user = useAuthStore.getState().user;
      const id = user?.authId || user?.id;
      return id ? String(id) : null;
    },
    persistMedia: async (file) => {
      if (Platform.OS === "web") return file;
      const uri = await persistLocalMediaSelection(file.uri, {
        scope: POST_MEDIA_SCOPE,
        mimeType: file.mimeType,
      });
      const pairedVideoUri = file.pairedVideoUri
        ? await persistLocalMediaSelection(file.pairedVideoUri, { scope: POST_MEDIA_SCOPE })
        : undefined;
      return { ...file, uri, ...(pairedVideoUri ? { pairedVideoUri } : null) };
    },
    uploadMedia: async (files, report) => {
      const results = await uploadMultiple(
        files.map((file) => ({
          uri: file.uri,
          type: file.type,
          kind: file.kind as MediaFile["kind"],
          mimeType: file.mimeType,
          pairedVideoUri: file.pairedVideoUri,
        })),
        report,
      );
      return results.map((result) =>
        result.success
          ? {
              type: result.type,
              url: result.url,
              mimeType:
                result.kind === "gif"
                  ? "image/gif"
                  : result.kind === "animated_video"
                    ? "video/mp4+animated"
                    : result.mimeType,
              ...(result.thumbnail && { thumbnail: result.thumbnail }),
              ...(result.livePhotoVideoUrl && { livePhotoVideoUrl: result.livePhotoVideoUrl }),
            }
          : { error: result.error || "Media upload failed. Try again." },
      );
    },
    createPost: (input) => createPost(input),
    addPlacedTags: (postId, tags) => {
      void postTagsApi
        .addTags(postId, tags.map((tag) => ({
          userId: tag.userId, x: tag.x, y: tag.y, mediaIndex: tag.mediaIndex,
        })))
        .catch((error) => console.warn("[PublishPost] Could not save people tags", error));
    },
  }), [createPost, uploadMultiple]);
}

/**
 * Rebuild anything a killed app left behind. Mounted with the feed status row,
 * which is where a resumed job reports back.
 */
export function usePublishQueueResume() {
  const deps = usePublishTaskDeps();
  useEffect(() => {
    if (Platform.OS === "web") return;
    postPublishQueue.configure({
      storage: queueStorage,
      release: releaseMedia,
      build: (descriptor, ownerId) => createPublishTask(descriptor, ownerId, deps),
    });
    postPublishQueue.restore();
  }, [deps]);
}

/** Snapshot before resetting the composer; a finishing job must never reset a newer draft. */
export function usePublishPost() {
  const deps = usePublishTaskDeps();
  return useCallback((draft: Draft) => {
    const owner = useAuthStore.getState().user;
    const ownerId = owner?.authId || owner?.id;
    if (!ownerId) throw new Error("Please sign in before sharing a post.");
    const isText = draft.postKind === "text";
    const tags = draft.tags.length ? `\n${draft.tags.map((tag) => `#${tag}`).join(" ")}` : "";
    const slides = draft.textSlides.map((slide, index) =>
      `${slide.content.trim()}${index === draft.textSlides.length - 1 ? tags : ""}`.trim(),
    );
    if (isText && (!slides.length || slides.some((slide) => !slide || slide.length > TEXT_POST_MAX_LENGTH))) {
      throw new Error(`Each text slide, including hashtags, needs 1–${TEXT_POST_MAX_LENGTH} characters.`);
    }
    if (!isText && !draft.selectedMedia.length) throw new Error("Please select a photo or video.");
    if (!isText && draft.selectedMedia.length > 10) throw new Error("You can share up to 10 photos or videos per post.");
    const files: PublishMediaFile[] = isText ? [] : draft.selectedMedia.map((media) => ({
      uri: media.editorOpened && media.editedUri ? media.editedUri : media.uri,
      type: media.type as "image" | "video",
      kind: media.kind,
      mimeType: media.mimeType,
      pairedVideoUri: media.pairedVideoUri,
    }));
    const descriptor: PublishDescriptor = {
      operationId: `post-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      postKind: isText ? "text" : "media",
      content: isText ? slides[0] : draft.caption + tags,
      slides: isText ? slides : [],
      textTheme: draft.textTheme,
      location: draft.location,
      isNSFW: isText ? false : draft.isNSFW,
      files,
      placedTags: draft.placedTags.map((tag) => ({
        userId: tag.userId, x: tag.x, y: tag.y, mediaIndex: tag.mediaIndex,
      })),
      uploaded: files.map(() => null),
    };
    return postPublishQueue.enqueue(
      String(ownerId),
      isText ? "Sharing your text post" : "Sharing your post",
      createPublishTask(descriptor, String(ownerId), deps),
      descriptor,
    );
  }, [deps]);
}
