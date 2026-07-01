"use client";

/**
 * Create Post — web port of `(protected)/(tabs)/create.tsx`.
 *
 * Law 1 (data wiring is sacred): imports/calls the EXACT portable hooks the
 * native screen uses — `useCreatePostStore` (Zustand form state), `useCreatePost`
 * (mutation), `useMediaUpload` (CDN upload), `useAuthStore`, `useUIStore`. Caption,
 * location, tags, text-slides, spicy toggle and publish all flow through them.
 *
 * Law 3 (web idioms): raw semantic HTML + Tailwind className on DOM tags only,
 * NativeWind interop OFF. Media intake is a `<input type=file multiple>` (object-URL
 * previews) replacing the native picker; on publish the same `useMediaUpload` runs.
 * Camera links to /feed/camera. Avatars / media tiles are rounded SQUARES, no pills.
 */

import { useRef } from "react";
import { useRouter } from "solito/navigation";
import {
  Hash,
  X,
  ImagePlus,
  Camera,
  Trash2,
  Plus,
  Type as TypeIcon,
  Image as ImageIcon,
  CalendarPlus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { useCreatePost } from "@dvnt/app/lib/hooks/use-posts";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import {
  TEXT_POST_THEMES,
  TEXT_POST_MAX_LENGTH,
  TEXT_POST_MAX_SLIDES,
  serializeTextSlidesForMutation,
} from "@dvnt/app/lib/posts/text-post";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import type { MediaKind, TextPostThemeKey } from "@dvnt/app/lib/types";
import { useCreatePostUIStore } from "./create-post-ui-store";

const MAX_PHOTOS = 10;
const MAX_ANIMATED_VIDEO_DURATION = 15; // seconds

const inputCls =
  "w-full h-11 px-3 rounded-xl bg-white/6 border border-white/10 text-[15px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60";

export function CreatePostScreen() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    selectedMedia,
    setSelectedMedia,
    caption,
    setCaption,
    textSlides,
    activeTextSlideIndex,
    setActiveTextSlideIndex,
    updateTextSlide,
    addTextSlide,
    removeTextSlide,
    location,
    setLocationData,
    isNSFW,
    setIsNSFW,
    tags,
    addTag,
    removeTag,
    postKind,
    setPostKind,
    textTheme,
    setTextTheme,
    reset,
  } = useCreatePostStore();

  const ui = useCreatePostUIStore();
  const { user } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);
  const { mutate: createPost, isPending: isCreating } = useCreatePost();
  const {
    uploadMultiple,
    isUploading,
    isCompressing,
    progress: uploadProgress,
    compressionProgress,
    statusMessage,
  } = useMediaUpload({ folder: "posts", userId: user?.id });

  const isTextPost = postKind === "text";
  const activeTextSlide = textSlides[activeTextSlideIndex] ?? textSlides[0];
  const canAddMore = selectedMedia.length < MAX_PHOTOS;

  const areTextSlidesValid =
    textSlides.length > 0 &&
    textSlides.every(
      (slide) =>
        slide.content.trim().length > 0 &&
        slide.content.trim().length <= TEXT_POST_MAX_LENGTH,
    );
  const isValid = isTextPost ? areTextSlidesValid : selectedMedia.length > 0;
  const busy = isCreating || isUploading || ui.isSubmitLocked;

  // ---- Media intake (file input → object-URL MediaAssets) ----

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_PHOTOS - selectedMedia.length;
    if (remaining <= 0) {
      showToast("warning", "Photo limit", `Maximum ${MAX_PHOTOS} photos per post.`);
      e.target.value = "";
      return;
    }

    const next: MediaAsset[] = [];
    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) continue;
      if (!isVideo && next.length >= remaining) {
        showToast("warning", "Photo limit reached", `You can add up to ${MAX_PHOTOS} photos per post.`);
        break;
      }
      const uri = URL.createObjectURL(file);
      const kind: MediaKind = isVideo
        ? "video"
        : file.type === "image/gif"
          ? "gif"
          : "image";
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${next.length}`,
        uri,
        type: isVideo ? "video" : "image",
        kind,
        mimeType: file.type || undefined,
      });
    }

    if (next.length > 0) {
      setSelectedMedia([...selectedMedia, ...next]);
    }
    e.target.value = "";
  };

  const handleRemoveMedia = (id: string) => {
    setSelectedMedia(selectedMedia.filter((m) => m.id !== id));
  };

  const moveMedia = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= selectedMedia.length) return;
    const reordered = [...selectedMedia];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    setSelectedMedia(reordered);
  };

  const handleSetPostKind = (nextKind: "media" | "text") => {
    if (nextKind === postKind) return;
    setPostKind(nextKind);
    if (nextKind === "text") {
      if (selectedMedia.length > 0) setSelectedMedia([]);
      if (isNSFW) setIsNSFW(false);
    }
  };

  const handleAddTag = () => {
    const value = ui.tagInput.trim();
    if (!value) return;
    addTag(value);
    ui.setTagInput("");
  };

  // ---- Publish (same upload + mutation path as native) ----

  const handlePost = async () => {
    const {
      selectedMedia: currentSelectedMedia,
      caption: currentCaption,
      textSlides: currentTextSlides,
      location: currentLocation,
      isNSFW: currentIsNSFW,
      tags: currentTags,
      postKind: currentPostKind,
      textTheme: currentTextTheme,
    } = useCreatePostStore.getState();

    const isTextSubmission = currentPostKind === "text";
    const normalizedTextSlides = currentTextSlides.map((slide) => slide.content.trim());

    if (busy) return;

    if (!isTextSubmission && currentSelectedMedia.length === 0) {
      showToast("error", "No Photos", "Please select at least one photo.");
      return;
    }
    if (isTextSubmission && normalizedTextSlides.some((slide) => slide.length === 0)) {
      showToast("error", "Empty Slide", "Each slide needs text before you can post.");
      return;
    }
    if (isTextSubmission && normalizedTextSlides.some((slide) => slide.length > TEXT_POST_MAX_LENGTH)) {
      showToast("error", "Too Long", `Text posts are limited to ${TEXT_POST_MAX_LENGTH} characters.`);
      return;
    }

    ui.setIsSubmitLocked(true);

    try {
      const tagsString =
        currentTags.length > 0 ? "\n" + currentTags.map((t) => `#${t}`).join(" ") : "";
      const fullContent = currentCaption + tagsString;
      const textSlidesWithTags = isTextSubmission
        ? normalizedTextSlides.map((slide, index) =>
            index === normalizedTextSlides.length - 1 ? `${slide}${tagsString}`.trim() : slide,
          )
        : [];

      let postMedia: Array<{
        type: string;
        url: string;
        thumbnail?: string;
        mimeType?: string;
        livePhotoVideoUrl?: string;
      }> = [];

      if (!isTextSubmission) {
        const mediaFiles = currentSelectedMedia.map((m) => ({
          uri: m.editorOpened && m.editedUri ? m.editedUri : m.uri,
          type: m.type as "image" | "video",
          kind: m.kind,
          mimeType: m.mimeType,
          pairedVideoUri: m.pairedVideoUri,
        }));

        let uploadResults;
        try {
          uploadResults = await uploadMultiple(mediaFiles);
        } catch {
          showToast("error", "Upload Failed", "Could not upload media. Please try again.");
          ui.setIsSubmitLocked(false);
          return;
        }

        const failedUploads = uploadResults.filter((r) => !r.success);
        if (failedUploads.length > 0) {
          showToast(
            "error",
            "Upload Error",
            `${failedUploads.length} file(s) failed to upload. Please try again.`,
          );
          ui.setIsSubmitLocked(false);
          return;
        }

        postMedia = uploadResults.map((r) => ({
          type: r.kind === "animated_video" || r.kind === "video" ? "video" : "image",
          url: r.url,
          mimeType:
            r.kind === "gif"
              ? "image/gif"
              : r.kind === "animated_video"
                ? "video/mp4+animated"
                : (r.mimeType ?? undefined),
          ...(r.thumbnail && { thumbnail: r.thumbnail }),
          ...(r.livePhotoVideoUrl && { livePhotoVideoUrl: r.livePhotoVideoUrl }),
        }));
      }

      createPost(
        {
          kind: isTextSubmission ? "text" : "media",
          textTheme: currentTextTheme,
          content: isTextSubmission ? textSlidesWithTags[0] : fullContent,
          slides: isTextSubmission
            ? serializeTextSlidesForMutation(
                textSlidesWithTags.map((content, order) => ({
                  id: `draft-${order}`,
                  order,
                  content,
                })),
              )
            : undefined,
          location: currentLocation,
          media: postMedia,
          isNSFW: isTextSubmission ? false : currentIsNSFW,
        },
        {
          onSuccess: () => {
            reset();
            router.push("/feed");
          },
          onError: (error: any) => {
            ui.setIsSubmitLocked(false);
            showToast(
              "error",
              "Error",
              error?.message || error?.error?.message || "Failed to create post. Please try again.",
            );
          },
        },
      );
    } catch (error: any) {
      ui.setIsSubmitLocked(false);
      showToast("error", "Error", error?.message || "Something went wrong. Please try again.");
    }
  };


  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button onClick={() => router.back()} className="text-white/80 active:opacity-60" aria-label="Close">
          <X size={22} />
        </button>
        <h1 className="text-[17px] font-semibold">New Post</h1>
        <button
          onClick={handlePost}
          disabled={!isValid || busy}
          className="rounded-xl px-4 py-2 text-[15px] font-bold bg-cyan-500 text-white disabled:bg-white/8 disabled:text-white/30"
        >
          {busy ? "Posting…" : "Share"}
        </button>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-32">
        {/* Post-type switch */}
        <div className="mt-4 flex gap-1.5 sm:gap-2.5 rounded-2xl border border-white/8 bg-[#0E1320] p-1.5">
          {[
            { key: "media" as const, label: "Media", icon: ImageIcon, description: "Photos or video" },
            { key: "text" as const, label: "Text", icon: TypeIcon, description: "Text only" },
            { key: "event" as const, label: "Event", icon: CalendarPlus, description: "Party, meetup, etc." },
          ].map((option) => {
            const Icon = option.icon;
            const isActive = postKind === option.key;
            return (
              <button
                key={option.key}
                onClick={() => {
                  if (option.key === "event") {
                    // Web parity with mobile: Event tab navigates out to the
                    // dedicated events flow rather than setting postKind.
                    router.push("/feed/events/create");
                    return;
                  }
                  handleSetPostKind(option.key);
                }}
                className={`flex-1 min-w-0 rounded-xl px-2 py-2.5 sm:py-3 text-left border ${
                  isActive ? "bg-cyan-500/16 border-cyan-400/40" : "border-transparent"
                }`}
              >
                <span className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <Icon size={18} className={`shrink-0 ${isActive ? "text-cyan-300" : "text-white/45"}`} />
                  <span className={`truncate text-sm sm:text-[15px] font-bold ${isActive ? "text-white" : "text-white/75"}`}>
                    {option.label}
                  </span>
                </span>
                <span
                  className={`mt-1.5 sm:mt-2 block truncate text-[11px] sm:text-xs leading-4 ${
                    isActive ? "text-white/80" : "text-white/45"
                  }`}
                >
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tags */}
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-white/15 bg-[#111] px-3 h-11">
              <Hash size={16} className="text-[#8A40CF]" strokeWidth={2.5} />
              <input
                value={ui.tagInput}
                onChange={(e) => ui.setTagInput(e.target.value.replace(/\s/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Add tag"
                autoCapitalize="none"
                autoCorrect="off"
                className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
              />
            </div>
            <button
              onClick={handleAddTag}
              className={`h-11 rounded-xl px-4 text-sm font-semibold text-white ${
                ui.tagInput.trim() ? "bg-[#8A40CF]" : "bg-white/15"
              }`}
            >
              Add
            </button>
          </div>
          {tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => removeTag(tag)}
                  className="flex items-center gap-1 rounded-lg border border-[#8A40CF]/25 bg-[#8A40CF]/12 px-2.5 py-1.5"
                >
                  <Hash size={11} className="text-[#8A40CF]" strokeWidth={2.5} />
                  <span className="text-[13px] font-semibold text-[#8A40CF]">{tag}</span>
                  <X size={12} className="text-[#8A40CF]" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Media intake buttons */}
        {!isTextPost && selectedMedia.length === 0 ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3.5 font-semibold text-white"
            >
              <ImagePlus size={20} />
              Add Photos
            </button>
            <button
              onClick={() => router.push("/feed/camera")}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-[#1a1a1a] py-3.5 font-semibold text-white"
            >
              <Camera size={20} />
              Camera
            </button>
          </div>
        ) : null}

        {/* Location */}
        <div className="mt-3">
          <input
            value={location}
            onChange={(e) => {
              const text = e.target.value;
              setLocationData(text ? { name: text } : null);
            }}
            placeholder="Add location"
            maxLength={100}
            className={inputCls}
          />
        </div>

        {/* Text-post composer */}
        {isTextPost ? (
          <div className="mt-4">
            {/* Theme picker */}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TEXT_POST_THEMES) as TextPostThemeKey[]).map((key) => {
                const t = TEXT_POST_THEMES[key];
                const isActive = key === textTheme;
                return (
                  <button
                    key={key}
                    onClick={() => setTextTheme(key)}
                    className={`h-9 rounded-xl px-3 text-[13px] font-semibold border ${
                      isActive ? "text-white" : "text-white/80"
                    }`}
                    style={{
                      backgroundImage: `linear-gradient(150deg, ${t.gradient.join(", ")})`,
                      borderColor: isActive ? t.accent : "rgba(255,255,255,0.12)",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Slide tabs + add/remove */}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[15px] font-bold text-white">
                Slide {activeTextSlideIndex + 1} of {textSlides.length}
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => removeTextSlide(activeTextSlideIndex)}
                  disabled={textSlides.length <= 1}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/4 text-white disabled:opacity-45"
                  aria-label="Remove slide"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={addTextSlide}
                  disabled={textSlides.length >= TEXT_POST_MAX_SLIDES}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/16 px-3.5 text-[13px] font-bold text-white disabled:border-white/6 disabled:bg-white/4 disabled:text-white/55"
                >
                  <Plus size={16} />
                  New Slide
                </button>
              </div>
            </div>

            <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
              {textSlides.map((slide, index) => {
                const isActive = index === activeTextSlideIndex;
                return (
                  <button
                    key={slide.id}
                    onClick={() => setActiveTextSlideIndex(index)}
                    className={`w-[76px] shrink-0 rounded-2xl border px-2.5 py-2.5 text-left ${
                      isActive ? "border-cyan-400/40 bg-cyan-500/18" : "border-white/8 bg-white/4"
                    }`}
                  >
                    <span className={`block text-xs font-bold ${isActive ? "text-white" : "text-white/85"}`}>
                      Slide {index + 1}
                    </span>
                    <span className="mt-2 block text-[11px] leading-[15px] text-white/55 line-clamp-2">
                      {slide.content.trim() || "Empty"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Plain editor — matches the mobile composer (white text on the dark
                screen, no themed box; the selected theme styles the PUBLISHED
                card, shown in the feed/detail, not the input). */}
            <textarea
              value={activeTextSlide?.content ?? ""}
              onChange={(e) => updateTextSlide(activeTextSlideIndex, e.target.value)}
              placeholder="Speak your mind…"
              maxLength={TEXT_POST_MAX_LENGTH}
              rows={6}
              className="mt-3 w-full resize-none bg-transparent text-white text-[18px] leading-7 outline-none placeholder:text-white/45"
            />
            <p
              className="mt-2 text-right text-xs"
              style={{
                color:
                  (activeTextSlide?.content.length ?? 0) > TEXT_POST_MAX_LENGTH ? "#FB7185" : "#64748B",
              }}
            >
              {activeTextSlide?.content.length ?? 0}/{TEXT_POST_MAX_LENGTH}
            </p>
          </div>
        ) : null}

        {/* Spicy / Sweet toggle (media posts with media) */}
        {!isTextPost && selectedMedia.length > 0 ? (
          <div
            className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 ${
              isNSFW ? "border-red-500/30 bg-red-500/10" : "border-white/15 bg-transparent"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{isNSFW ? "😈" : "😇"}</span>
              <div>
                <p className={`text-[15px] font-semibold ${isNSFW ? "text-red-500" : "text-white"}`}>
                  {isNSFW ? "Spicy" : "Sweet"}
                </p>
                <p className="text-xs text-white/45">
                  {isNSFW ? "Mature content warning" : "All audiences"}
                </p>
              </div>
            </div>
            <button
              role="switch"
              aria-checked={isNSFW}
              onClick={() => setIsNSFW(!isNSFW)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                isNSFW ? "bg-red-500" : "bg-white/20"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                  isNSFW ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        ) : null}

        {/* Media previews — rounded square tiles, reorderable */}
        {!isTextPost && selectedMedia.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {selectedMedia.map((media, index) => (
              <div
                key={media.id}
                className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-[#111]"
              >
                {media.type === "video" ? (
                  <video src={media.uri} muted loop playsInline className="h-full w-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media.uri} alt="" className="h-full w-full object-cover" />
                )}

                <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-xs font-semibold text-white">
                  {index + 1}
                </span>

                <button
                  onClick={() => handleRemoveMedia(media.id)}
                  className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/90 text-white"
                  aria-label="Remove"
                >
                  <Trash2 size={14} />
                </button>

                <div className="absolute bottom-2 right-2 flex gap-1.5">
                  <button
                    onClick={() => moveMedia(index, -1)}
                    disabled={index === 0}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => moveMedia(index, 1)}
                    disabled={index === selectedMedia.length - 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
            ))}

            {canAddMore ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-white/20 bg-[#111] text-white/40"
              >
                <Plus size={32} />
                <span className="text-xs">Add More</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Caption — media posts */}
        {!isTextPost ? (
          <div className="mt-4">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption (optional)"
              maxLength={2200}
              rows={3}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/6 px-3 py-2.5 text-[16px] text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60"
            />
            <p className="mt-1.5 text-right text-xs text-white/40">{caption.length}/2200</p>
          </div>
        ) : null}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onPickFiles}
      />

      {/* Upload / posting overlay */}
      {isUploading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="flex min-w-[280px] flex-col items-center gap-4 rounded-3xl bg-[#0E1320] p-8">
            <div className="h-2 w-48 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-cyan-500 transition-[width]"
                style={{ width: `${isCompressing ? compressionProgress : uploadProgress}%` }}
              />
            </div>
            <p className="text-lg font-semibold text-white">
              {isCompressing ? "Compressing Video…" : statusMessage || "Posting…"}
            </p>
            <p className="text-sm text-white/60">
              {isCompressing ? compressionProgress : uploadProgress}% complete
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
