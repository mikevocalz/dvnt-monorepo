import { useCallback } from "react";
import { useCreatePost } from "@dvnt/app/lib/hooks/use-posts";
import { useMediaUpload, type MediaUploadResult } from "@dvnt/app/lib/hooks/use-media-upload";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { postPublishQueue } from "@dvnt/app/lib/posts/publish-queue";
import { postTagsApi } from "@dvnt/app/lib/api/post-tags";
import { TEXT_POST_MAX_LENGTH } from "@dvnt/app/lib/posts/text-post";

type Draft = ReturnType<typeof useCreatePostStore.getState>;

/** Snapshot before resetting the composer; a finishing job must never reset a newer draft. */
export function usePublishPost() {
  const { mutateAsync: createPost } = useCreatePost();
  const { uploadMultiple } = useMediaUpload({ folder: "posts" });
  return useCallback((draft: Draft) => {
    const owner = useAuthStore.getState().user;
    const ownerId = owner?.authId || owner?.id;
    if (!ownerId) throw new Error("Please sign in before sharing a post.");
    const operationId = `post-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
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
    const files = draft.selectedMedia.map((media) => ({
      uri: media.editorOpened && media.editedUri ? media.editedUri : media.uri,
      type: media.type as "image" | "video",
      kind: media.kind,
      mimeType: media.mimeType,
      pairedVideoUri: media.pairedVideoUri,
    }));
    const placedTags = draft.placedTags.map((tag) => ({ ...tag }));
    const content = isText ? slides[0] : draft.caption + tags;
    const location = draft.location;
    const textTheme = draft.textTheme;
    const isNSFW = isText ? false : draft.isNSFW;
    // Retain successfully uploaded assets when retrying a failed publish.
    const uploaded: Array<MediaUploadResult | undefined> = [];
    const assertOwner = () => {
      const current = useAuthStore.getState().user;
      if (String(current?.authId || current?.id || "") !== String(ownerId) && String(current?.id || "") !== String(owner?.id)) {
        throw new Error("Sign back into the account that started this post to retry.");
      }
    };
    return postPublishQueue.enqueue(String(ownerId), isText ? "Sharing your text post" : "Sharing your post", async (report) => {
      assertOwner();
      if (!isText) {
        const missingIndexes = files.flatMap((_, index) => uploaded[index]?.success ? [] : [index]);
        if (missingIndexes.length) {
          const results = await uploadMultiple(missingIndexes.map((index) => files[index]), report);
          missingIndexes.forEach((index, resultIndex) => { uploaded[index] = results[resultIndex]; });
        }
        const failure = uploaded.find((result) => result && !result.success);
        if (failure || files.some((_, index) => !uploaded[index]?.success)) {
          throw new Error(failure?.error || "Media upload failed. Try again.");
        }
      }
      assertOwner();
      report("Publishing your post…");
      const post = await createPost({
        operationId,
        expectedAuthorId: String(ownerId),
        kind: isText ? "text" : "media",
        textTheme,
        content,
        slides: isText ? slides : undefined,
        location,
        isNSFW,
        media: uploaded.filter((media): media is MediaUploadResult => Boolean(media?.success)).map((media) => ({
          type: media.type,
          url: media.url,
          mimeType: media.kind === "gif" ? "image/gif" : media.kind === "animated_video" ? "video/mp4+animated" : media.mimeType,
          ...(media.thumbnail && { thumbnail: media.thumbnail }),
          ...(media.livePhotoVideoUrl && { livePhotoVideoUrl: media.livePhotoVideoUrl }),
        })),
      });
      if (!isText && post?.id && placedTags.length) {
        // A tag failure must never mark an already-created post as failed/retryable.
        try {
          assertOwner();
          void postTagsApi.addTags(String(post.id), placedTags.map((tag) => ({
            userId: tag.userId, x: tag.x, y: tag.y, mediaIndex: tag.mediaIndex,
          }))).catch((error) => console.warn("[PublishPost] Could not save people tags", error));
        } catch (error) {
          console.warn("[PublishPost] Post shared but people tags could not be saved", error);
        }
      }
    });
  }, [createPost, uploadMultiple]);
}
