"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import {
  X,
  Image as ImageIcon,
  Type,
  Globe,
  Star,
  Trash2,
} from "lucide-react";
import { useCreateStoryStore } from "@dvnt/app/lib/stores/create-story-store";
import { useStoryEditorResultStore } from "@dvnt/app/lib/stores/story-editor-result-store";
import { useStoryFlowStore } from "@dvnt/app/lib/stores/story-flow-store";
import { useCreateStory } from "@dvnt/app/lib/hooks/use-stories";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { storyTagsApi } from "@dvnt/app/lib/api/stories";
import { TEXT_POST_THEMES } from "@dvnt/app/lib/posts/text-post";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import { detectMediaKind } from "@dvnt/app/lib/media/detect-media-kind";
import {
  useStoryCreateWebStore,
  STORY_TEXT_COLORS,
} from "@dvnt/app/lib/stores/story-create-web-store";

const MAX_STORY_ITEMS = 4;

/**
 * Story composer — web port of `(protected)/story/create.tsx`.
 *
 * Law 1 (data wiring is sacred): same portable state + mutation native uses.
 *   - Media + visibility + tags live in `useCreateStoryStore`.
 *   - Media is uploaded with `useMediaUpload({ folder: "stories" })`.
 *   - The story is published via the SAME `useCreateStory()` mutation.
 *   - Tags persisted with `storyTagsApi.addTags`.
 *
 * Native-only surfaces simplified for web:
 *   - expo-camera / expo-image-picker  → `<input type=file accept="image/*,video/*">`.
 *   - Skia/gesture text+sticker editor  → CSS-positioned draggable text overlays
 *     (`useStoryCreateWebStore`), serialized into the portable `StoryOverlay[]`
 *     text shape on publish. Drawing / stickers / effects / GIF overlays are
 *     native-only and intentionally omitted.
 *   - Text-only background stories      → `TEXT_POST_THEMES` gradient picker.
 */
export function StoryCreateScreen() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const showToast = useUIStore((s) => s.showToast);
  const currentUser = useAuthStore((s) => s.user);

  const {
    reset: resetStore,
    currentIndex,
    setCurrentIndex,
    mediaAssets,
    setMediaAssets,
    isSharing,
    setIsSharing,
    visibility,
    setVisibility,
    taggedUsers,
  } = useCreateStoryStore();

  const { mutate: createStoryMutate, isPending: isCreateStoryPending } =
    useCreateStory();
  const {
    uploadMultiple,
    progress: uploadProgress,
    statusMessage: uploadStatus,
  } = useMediaUpload({ folder: "stories", userId: currentUser?.id });

  const {
    overlays,
    editingId,
    textTheme,
    addTextOverlay,
    updateOverlayContent,
    updateOverlayPosition,
    updateOverlayColor,
    removeOverlay,
    setEditingId,
    setDraggingId,
    setTextTheme,
    toStoryOverlays,
    reset: resetWeb,
  } = useStoryCreateWebStore();

  // Editor → create hand-off: the story editor writes the edited media +
  // overlays into the shared result store, then routes back here; consume it.
  const consumeEditorResult = useStoryEditorResultStore((s) => s.consumeResult);
  const forceIdleFlow = useStoryFlowStore((s) => s.forceIdle);
  useEffect(() => {
    const r = consumeEditorResult();
    if (r?.uri) {
      const assets = useCreateStoryStore.getState().mediaAssets;
      const next = assets.map((a, i) =>
        i === r.index ? ({ ...a, uri: r.uri, type: r.mediaType } as MediaAsset) : a,
      );
      // If the editor produced media but the composer had none, seed it.
      setMediaAssets(
        next.length
          ? next
          : ([{ uri: r.uri, type: r.mediaType }] as unknown as MediaAsset[]),
      );
    }
  }, [consumeEditorResult, setMediaAssets]);

  // Reset transient web editing state + the flow state machine on leave.
  useEffect(() => () => {
    resetWeb();
    forceIdleFlow();
  }, [resetWeb, forceIdleFlow]);

  const currentAsset = mediaAssets[currentIndex];
  const isTextStory = mediaAssets.length === 0 && overlays.length > 0;
  const isValid = mediaAssets.length > 0 || overlays.length > 0;
  const busy = isSharing || isCreateStoryPending;

  // ── Media intake (file input) ───────────────────────────────────────
  const onPickFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ""; // allow re-picking the same file
      if (files.length === 0) return;

      const room = MAX_STORY_ITEMS - mediaAssets.length;
      if (room <= 0) {
        showToast(
          "warning",
          "Story Limit",
          `You can add up to ${MAX_STORY_ITEMS} items per story.`,
        );
        return;
      }
      if (files.length > room) {
        showToast(
          "warning",
          "Story Limit",
          `You can add up to ${MAX_STORY_ITEMS} items per story.`,
        );
      }

      const next: MediaAsset[] = files.slice(0, room).map((file) => {
        const isVideo = file.type.startsWith("video/");
        const uri = URL.createObjectURL(file);
        const type: "image" | "video" = isVideo ? "video" : "image";
        return {
          id: `${uri}-${file.name}`,
          uri,
          type,
          kind: detectMediaKind(type, file.type, file.name),
          mimeType: file.type,
          fileSize: file.size,
        };
      });

      const updated = [...mediaAssets, ...next];
      setMediaAssets(updated);
      setCurrentIndex(mediaAssets.length === 0 ? 0 : mediaAssets.length);
    },
    [mediaAssets, setMediaAssets, setCurrentIndex, showToast],
  );

  const handleRemoveMedia = useCallback(
    (index: number) => {
      const updated = mediaAssets.filter((_, i) => i !== index);
      setMediaAssets(updated);
      if (currentIndex >= updated.length && updated.length > 0) {
        setCurrentIndex(updated.length - 1);
      } else if (updated.length === 0) {
        setCurrentIndex(0);
      }
    },
    [mediaAssets, currentIndex, setMediaAssets, setCurrentIndex],
  );

  // ── Text-overlay drag (pointer) ─────────────────────────────────────
  const beginDrag = useCallback(
    (id: string) => (e: React.PointerEvent) => {
      e.stopPropagation();
      setDraggingId(id);
      setEditingId(id);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [setDraggingId, setEditingId],
  );

  const onStagePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const draggingId = useStoryCreateWebStore.getState().draggingId;
      if (!draggingId || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      updateOverlayPosition(draggingId, x, y);
    },
    [updateOverlayPosition],
  );

  const endDrag = useCallback(() => setDraggingId(null), [setDraggingId]);

  // ── Publish ─────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    if (busy) return;
    if (!isValid) {
      showToast("warning", "Empty Story", "Please add media to your story");
      return;
    }

    setIsSharing(true);

    try {
      const webTextOverlays = toStoryOverlays();

      // Text-only story (no media): publish as a themed text item.
      if (mediaAssets.length === 0) {
        const theme = TEXT_POST_THEMES[textTheme];
        const storyItems = [
          {
            type: "text",
            text: overlays.map((o) => o.content).join("\n"),
            textColor: theme.textPrimary,
            backgroundColor: theme.gradient[1] ?? theme.gradient[0],
            storyOverlays: webTextOverlays,
            animatedGifOverlays: [],
          },
        ];
        createStoryMutate(
          { items: storyItems, visibility },
          {
            onSuccess: () => {
              setIsSharing(false);
              showToast("success", "Success", "Story shared successfully!");
              resetStore();
              resetWeb();
              router.replace("/feed");
            },
            onError: (error: any) => {
              setIsSharing(false);
              showToast(
                "error",
                "Error",
                error?.message || "Failed to share story.",
              );
            },
          },
        );
        return;
      }

      // Media story: upload assets, then publish.
      const mediaFiles = mediaAssets.map((m) => ({
        uri: m.uri,
        type: m.type as "image" | "video",
        kind: m.kind,
        mimeType: m.mimeType,
      }));

      const uploadResults = await uploadMultiple(mediaFiles);
      const failed = uploadResults.filter((r) => !r.success);
      if (failed.length > 0) {
        setIsSharing(false);
        showToast(
          "error",
          "Upload Error",
          failed[0]?.error || "Failed to upload media.",
        );
        return;
      }

      const storyItems = uploadResults.map((r, index) => ({
        type: r.kind ?? r.type,
        url: r.url,
        ...(r.path && { storageKey: r.path }),
        thumbnail: r.thumbnail,
        ...(r.thumbnailPath && { thumbnailKey: r.thumbnailPath }),
        ...(r.mimeType && { mimeType: r.mimeType }),
        // Text overlays apply to the first (active) media item on web.
        storyOverlays: index === currentIndex ? webTextOverlays : [],
        animatedGifOverlays: [],
      }));

      createStoryMutate(
        { items: storyItems, visibility },
        {
          onSuccess: (newStory: any) => {
            if (taggedUsers.length > 0 && newStory?.id) {
              const tags = taggedUsers.map((u) => ({
                userId: u.id,
                x: 0.5,
                y: 0.5,
              }));
              storyTagsApi
                .addTags(String(newStory.id), tags)
                .catch(() => undefined);
            }
            setIsSharing(false);
            showToast("success", "Success", "Story shared successfully!");
            resetStore();
            resetWeb();
            router.replace("/feed");
          },
          onError: (error: any) => {
            setIsSharing(false);
            showToast(
              "error",
              "Error",
              error?.message || "Failed to share story.",
            );
          },
        },
      );
    } catch (error: any) {
      setIsSharing(false);
      showToast("error", "Error", error?.message || "Something went wrong.");
    }
  }, [
    busy,
    isValid,
    mediaAssets,
    overlays,
    textTheme,
    currentIndex,
    visibility,
    taggedUsers,
    toStoryOverlays,
    uploadMultiple,
    createStoryMutate,
    setIsSharing,
    showToast,
    resetStore,
    resetWeb,
    router,
  ]);

  const handleClose = useCallback(() => {
    resetStore();
    resetWeb();
    router.back();
  }, [resetStore, resetWeb, router]);

  const stageBackground =
    isTextStory && mediaAssets.length === 0
      ? `linear-gradient(160deg, ${TEXT_POST_THEMES[textTheme].gradient.join(", ")})`
      : "#000";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white flex flex-col">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={handleClose}
          aria-label="Close"
          className="w-9 h-9 flex items-center justify-center rounded-xl text-white/80 active:opacity-60"
        >
          <X size={22} strokeWidth={2.5} />
        </button>
        <h1 className="text-[17px] font-semibold">New Story</h1>
        <button
          onClick={handleShare}
          disabled={busy || !isValid}
          className="text-[16px] font-semibold text-cyan-400 disabled:text-white/40"
        >
          {busy ? "Sharing…" : "Share"}
        </button>
      </div>

      <div className="mx-auto w-full max-w-md flex-1 flex flex-col items-center px-4 py-5">
        {/* Upload progress */}
        {busy && (
          <div className="w-full mb-4 rounded-2xl bg-black/80 p-4">
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400 rounded-full transition-[width]"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-white/80 text-sm text-center mt-3">
              {uploadStatus ||
                (uploadProgress < 100
                  ? `Uploading… ${uploadProgress}%`
                  : "Processing…")}
            </p>
          </div>
        )}

        {/* Portrait 9:16 stage */}
        <div
          ref={stageRef}
          onPointerMove={onStagePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-black select-none touch-none"
          style={{ background: stageBackground }}
        >
          {currentAsset ? (
            currentAsset.type === "video" ? (
              <video
                key={currentAsset.uri}
                src={currentAsset.uri}
                className="absolute inset-0 w-full h-full object-cover"
                controls
                playsInline
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentAsset.uri}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            )
          ) : !isTextStory ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/45"
            >
              <ImageIcon size={48} />
              <span className="text-base">Add media to get started</span>
            </button>
          ) : null}

          {/* Text overlays (draggable) */}
          {overlays.map((o) => (
            <div
              key={o.id}
              onPointerDown={beginDrag(o.id)}
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-move px-2 py-1 max-w-[90%]"
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%` }}
            >
              <div
                contentEditable
                suppressContentEditableWarning
                onPointerDown={(e) => e.stopPropagation()}
                onFocus={() => setEditingId(o.id)}
                onInput={(e) =>
                  updateOverlayContent(
                    o.id,
                    (e.target as HTMLDivElement).innerText,
                  )
                }
                className="text-center font-bold text-2xl leading-tight outline-none whitespace-pre-wrap"
                style={{
                  color: o.color,
                  textShadow: "0 1px 4px rgba(0,0,0,0.6)",
                }}
              >
                {o.content}
              </div>
            </div>
          ))}

          {/* Slide progress + thumbnail dots */}
          {mediaAssets.length > 1 && (
            <div className="absolute top-3 left-3 right-3 flex gap-1">
              {mediaAssets.map((_, idx) => (
                <div
                  key={idx}
                  className={`flex-1 h-0.5 rounded-full ${idx === currentIndex ? "bg-white" : "bg-white/30"}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Active overlay controls */}
        {editingId && (
          <div className="w-full mt-3 flex items-center justify-center gap-3">
            {STORY_TEXT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => updateOverlayColor(editingId, c)}
                aria-label={`Text color ${c}`}
                className="w-7 h-7 rounded-lg border border-white/20"
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              onClick={() => removeOverlay(editingId)}
              aria-label="Delete text"
              className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white/70"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {/* Media thumbnails */}
        {mediaAssets.length > 0 && (
          <div className="w-full mt-4 flex gap-2 overflow-x-auto pb-1">
            {mediaAssets.map((asset, idx) => (
              <button
                key={asset.id}
                onClick={() => setCurrentIndex(idx)}
                className={`relative shrink-0 w-14 h-14 rounded-lg overflow-hidden ${idx === currentIndex ? "ring-2 ring-cyan-400" : ""}`}
              >
                {asset.type === "video" ? (
                  <video
                    src={asset.uri}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.uri}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveMedia(idx);
                  }}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center"
                >
                  <X size={10} />
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Text-story theme picker (only when no media) */}
        {mediaAssets.length === 0 && (
          <div className="w-full mt-4 flex items-center justify-center gap-2">
            {Object.values(TEXT_POST_THEMES).map((theme) => (
              <button
                key={theme.key}
                onClick={() => setTextTheme(theme.key)}
                aria-label={theme.label}
                className={`w-9 h-9 rounded-xl border ${textTheme === theme.key ? "border-cyan-400" : "border-white/15"}`}
                style={{
                  background: `linear-gradient(160deg, ${theme.gradient.join(", ")})`,
                }}
              />
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Visibility toggle */}
        <div className="w-full flex justify-center mt-5 mb-4">
          <button
            onClick={() =>
              setVisibility(
                visibility === "public" ? "close_friends" : "public",
              )
            }
            className="flex items-center gap-2 px-4 py-2 rounded-xl border"
            style={{
              backgroundColor:
                visibility === "close_friends"
                  ? "rgba(252,37,58,0.15)"
                  : "rgba(255,255,255,0.08)",
              borderColor:
                visibility === "close_friends"
                  ? "rgba(252,37,58,0.4)"
                  : "rgba(255,255,255,0.1)",
            }}
          >
            {visibility === "public" ? (
              <Globe size={14} color="rgba(255,255,255,0.7)" />
            ) : (
              <Star size={14} color="#FC253A" fill="#FC253A" />
            )}
            <span
              className="text-[13px] font-bold"
              style={{
                color:
                  visibility === "close_friends"
                    ? "#FC253A"
                    : "rgba(255,255,255,0.7)",
              }}
            >
              {visibility === "public" ? "Everyone" : "Close Friends"}
            </span>
          </button>
        </div>

        {/* Action buttons */}
        <div className="w-full flex justify-center gap-8 pb-6">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={mediaAssets.length >= MAX_STORY_ITEMS || busy}
            className={`flex flex-col items-center gap-1 ${mediaAssets.length >= MAX_STORY_ITEMS || busy ? "opacity-40" : ""}`}
          >
            <span className="w-14 h-14 rounded-xl bg-white/8 flex items-center justify-center">
              <ImageIcon size={24} color="#fff" />
            </span>
            <span className="text-white/55 text-xs">
              Gallery
              {mediaAssets.length > 0
                ? ` (${mediaAssets.length}/${MAX_STORY_ITEMS})`
                : ""}
            </span>
          </button>

          <button
            onClick={addTextOverlay}
            disabled={busy}
            className={`flex flex-col items-center gap-1 ${busy ? "opacity-40" : ""}`}
          >
            <span className="w-14 h-14 rounded-xl bg-white/8 flex items-center justify-center">
              <Type size={24} color="#fff" />
            </span>
            <span className="text-white/55 text-xs">Text</span>
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onPickFiles}
      />
    </div>
  );
}
