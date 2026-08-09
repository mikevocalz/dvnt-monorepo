"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { X, Image as ImageIcon, Type, Globe, Star, Check } from "lucide-react";
import { useCreateStoryStore } from "@dvnt/app/lib/stores/create-story-store";
import { useCreateStory } from "@dvnt/app/lib/hooks/use-stories";
import {
  useMediaUpload,
  type MediaFile,
} from "@dvnt/app/lib/hooks/use-media-upload";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { storyTagsApi } from "@dvnt/app/lib/api/stories";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import type {
  StoryOverlay,
  StoryAnimatedGifOverlay,
} from "@dvnt/app/lib/types";
import { detectMediaKind } from "@dvnt/app/lib/media/detect-media-kind";
// eslint-disable-next-line no-restricted-imports -- deep store import: the stories-editor barrel re-exports EditorScreen (RN-only File.uri typing) which breaks apps/web's DOM-lib typecheck; route the store deep to keep web green.
import {
  useEditorStore,
  useSelectedElement,
} from "@dvnt/app/features/stories-editor/stores/editor-store";
import { DEFAULT_ADJUSTMENTS } from "@dvnt/app/features/stories-editor/constants";
import type {
  CanvasElement,
  DrawingPath,
  FilterAdjustment,
  LUTFilter,
} from "@dvnt/app/features/stories-editor/types";
import {
  EditorStage,
  RightIslandMenu,
  SelectionBar,
  TextPanel,
  DrawingPanel,
  StickerPanel,
  FilterPanel,
  AdjustPanel,
  BackgroundStrip,
  bakeFrame,
  buildOverlaysFromElements,
  needsBake,
  INK,
  DEVIANT_GRADIENT,
  HAIRLINE,
  type EditorToolMode,
} from "./story-editor.web";

const MAX_STORY_ITEMS = 4;

/**
 * Story composer — the SINGLE story-creation screen (web). It hosts the v2
 * editor rail (RightIslandMenu) + tool sheets (Text / Draw / Stickers /
 * Effects / Adjust) INLINE, so the rail is present the moment media is added —
 * no "Edit" tap, no route hop to a second /feed/story/editor screen.
 *
 * Law 1 (data wiring is sacred): same portable state + mutation native uses.
 *   - Media + visibility + tags live in `useCreateStoryStore`.
 *   - The editor's tools operate on `useEditorStore` (the shared editor store)
 *     for the CURRENT item, in place. Per-item edits are snapshotted so
 *     switching between multi-story items restores each item's overlays.
 *   - Share = bake + DIRECT upload: for each item we bake the editor's
 *     drawing + filter + vignette into the image (video/GIF upload raw), then
 *     run the SAME `uploadMultiple` → `useCreateStory()` contract with the
 *     text / sticker / WS-4 overlays (→ storyOverlays) and GIF overlays
 *     (→ animatedGifOverlays). No `story-editor-result-store` handoff.
 *   - Text-only stories bake the background (+ drawing) to an image and go
 *     through the same media path (create-story requires media); text rides as
 *     a storyOverlay.
 */

// ── Per-item editor snapshot (web-local, keyed by the item's stable blob uri) ─

interface ItemEdit {
  elements: CanvasElement[];
  drawingPaths: DrawingPath[];
  currentFilter: LUTFilter | null;
  adjustments: FilterAdjustment;
  canvasBackground: string;
}

function snapshotEditor(): ItemEdit {
  const s = useEditorStore.getState();
  return {
    elements: s.elements,
    drawingPaths: s.drawingPaths,
    currentFilter: s.currentFilter,
    adjustments: s.adjustments,
    canvasBackground: s.canvasBackground,
  };
}

// Load an item's saved edits into the editor store (or a fresh slate) and point
// the store at that item's media. Direct setState (web-only) so switching items
// doesn't churn the undo history — it's a load, not an edit.
function loadEditorForItem(asset: MediaAsset | undefined, edit?: ItemEdit) {
  useEditorStore.setState({
    elements: edit?.elements ?? [],
    drawingPaths: edit?.drawingPaths ?? [],
    currentFilter: edit?.currentFilter ?? null,
    adjustments: edit?.adjustments ?? DEFAULT_ADJUSTMENTS,
    canvasBackground: edit?.canvasBackground ?? "black",
    selectedElementId: null,
    undoStack: [],
    redoStack: [],
    mediaUri: asset?.uri ?? null,
    mediaType: (asset?.type as "image" | "video") ?? "image",
  });
}

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

  // Editor store — the rail's tools drive this, operating on the current item.
  const mode = useEditorStore((s) => s.mode);
  const setMode = useEditorStore((s) => s.setMode);
  const textOnlyMode = useEditorStore((s) => s.textOnlyMode);
  const editorMediaUri = useEditorStore((s) => s.mediaUri) ?? "";
  const elements = useEditorStore((s) => s.elements);
  const selected = useSelectedElement();

  const currentAsset = mediaAssets[currentIndex];
  const hasMedia = mediaAssets.length > 0;
  const textOnly = !hasMedia && textOnlyMode;
  const showEditor = hasMedia || textOnly;
  const isValid = hasMedia || (textOnly && elements.length > 0);
  const busy = isSharing || isCreateStoryPending;

  // Per-item editor snapshots (keyed by the item's stable blob uri) + the uri
  // currently loaded into the editor store.
  const perItemEdits = useRef<Record<string, ItemEdit>>({});
  const loadedUriRef = useRef<string | null>(null);

  // [REGRESSION LOCK parity] Clean slate on mount; the seeding effect then
  // loads the current item (if any).
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    useEditorStore.getState().resetEditor();
    loadedUriRef.current = null;
  }, []);

  // Seed / re-seed the editor store from the CURRENT media item, saving the
  // outgoing item's edits so switching between items restores each one.
  useEffect(() => {
    const curUri = currentAsset?.uri ?? null;
    if (loadedUriRef.current === curUri) return;
    if (loadedUriRef.current) {
      perItemEdits.current[loadedUriRef.current] = snapshotEditor();
    }
    if (curUri) {
      loadEditorForItem(currentAsset, perItemEdits.current[curUri]);
    } else if (!useEditorStore.getState().textOnlyMode) {
      // No media and not a text-only story → clean editor.
      useEditorStore.getState().resetEditor();
    }
    loadedUriRef.current = curUri;
  }, [currentAsset]);

  // Reset editor + create state on leave.
  useEffect(
    () => () => {
      useEditorStore.getState().resetEditor();
    },
    [],
  );

  const toggleMode = useCallback(
    (m: EditorToolMode) => setMode(mode === m ? "idle" : m),
    [mode, setMode],
  );

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

      // Adding media leaves any text-only draft behind.
      if (useEditorStore.getState().textOnlyMode) {
        useEditorStore.setState({ textOnlyMode: false });
      }

      const firstNewIndex = mediaAssets.length;
      const updated = [...mediaAssets, ...next];
      setMediaAssets(updated);
      setCurrentIndex(firstNewIndex);
      // The rail + tool sheets are already present inline; the seeding effect
      // seeds the editor store for the new current item. No route hop.
    },
    [mediaAssets, setMediaAssets, setCurrentIndex, showToast],
  );

  const handleRemoveMedia = useCallback(
    (index: number) => {
      const removed = mediaAssets[index];
      if (removed) delete perItemEdits.current[removed.uri];
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

  const startTextStory = useCallback(() => {
    useEditorStore.getState().resetEditor();
    useEditorStore.setState({ textOnlyMode: true });
    useEditorStore.getState().setMode("text");
    loadedUriRef.current = null;
  }, []);

  // ── Publish (bake + direct upload — no route hop, no result-store) ──────
  const handleShare = useCallback(async () => {
    if (busy) return;
    if (!isValid) {
      showToast("warning", "Empty Story", "Please add media to your story");
      return;
    }

    setIsSharing(true);

    const finishSuccess = (newStory?: { id?: string | number }) => {
      if (taggedUsers.length > 0 && newStory?.id) {
        const tags = taggedUsers.map((u) => ({ userId: u.id, x: 0.5, y: 0.5 }));
        storyTagsApi
          .addTags(String(newStory.id), tags)
          .catch(() => undefined);
      }
      setIsSharing(false);
      showToast("success", "Success", "Story shared successfully!");
      resetStore();
      useEditorStore.getState().resetEditor();
      router.replace("/feed");
    };
    const finishError = (error: { message?: string } | null) => {
      setIsSharing(false);
      showToast("error", "Error", error?.message || "Failed to share story.");
    };

    try {
      // Snapshot the currently-loaded item so its live edits are included.
      if (loadedUriRef.current) {
        perItemEdits.current[loadedUriRef.current] = snapshotEditor();
      }

      // ── Text-only: bake the background (+ drawing) to an image so it goes
      //    through the same media path; text rides as a storyOverlay.
      if (!hasMedia) {
        const edit = snapshotEditor();
        const { storyOverlays, animatedGifOverlays } =
          buildOverlaysFromElements(edit.elements);
        const baked = await bakeFrame({
          mediaUri: null,
          background: edit.canvasBackground,
          filter: edit.currentFilter,
          adjustments: edit.adjustments,
          drawingPaths: edit.drawingPaths,
        });
        if (!baked) {
          setIsSharing(false);
          showToast("error", "Error", "Could not render your text story.");
          return;
        }
        const uploadResults = await uploadMultiple([
          { uri: baked, type: "image", kind: "image", mimeType: "image/jpeg" },
        ]);
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
        const r = uploadResults[0];
        const storyItems = [
          {
            type: r.kind ?? r.type,
            url: r.url,
            ...(r.path && { storageKey: r.path }),
            thumbnail: r.thumbnail,
            ...(r.thumbnailPath && { thumbnailKey: r.thumbnailPath }),
            ...(r.mimeType && { mimeType: r.mimeType }),
            storyOverlays,
            animatedGifOverlays,
          },
        ];
        createStoryMutate(
          { items: storyItems, visibility },
          { onSuccess: finishSuccess, onError: finishError },
        );
        return;
      }

      // ── Media story: bake each image item (drawing + filter + vignette),
      //    collect that item's overlays, upload directly, then create-story.
      const overlaysPerIndex: Record<
        number,
        {
          storyOverlays: StoryOverlay[];
          animatedGifOverlays: StoryAnimatedGifOverlay[];
        }
      > = {};
      const mediaFiles: MediaFile[] = [];
      for (let i = 0; i < mediaAssets.length; i++) {
        const asset = mediaAssets[i];
        const edit = perItemEdits.current[asset.uri];
        overlaysPerIndex[i] = buildOverlaysFromElements(edit?.elements ?? []);

        let uri = asset.uri;
        let kind = asset.kind;
        let mimeType = asset.mimeType;
        const bakeable =
          asset.type === "image" &&
          asset.kind !== "gif" &&
          !!edit &&
          needsBake(edit);
        if (bakeable) {
          const baked = await bakeFrame({
            mediaUri: asset.uri,
            background: edit.canvasBackground,
            filter: edit.currentFilter,
            adjustments: edit.adjustments,
            drawingPaths: edit.drawingPaths,
          });
          if (baked) {
            uri = baked;
            kind = "image";
            mimeType = "image/jpeg";
          }
        }
        mediaFiles.push({
          uri,
          type: asset.type as "image" | "video",
          kind,
          mimeType,
        });
      }

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

      const storyItems = uploadResults.map((r, index) => {
        const ov = overlaysPerIndex[index];
        return {
          type: r.kind ?? r.type,
          url: r.url,
          ...(r.path && { storageKey: r.path }),
          thumbnail: r.thumbnail,
          ...(r.thumbnailPath && { thumbnailKey: r.thumbnailPath }),
          ...(r.mimeType && { mimeType: r.mimeType }),
          storyOverlays: ov?.storyOverlays ?? [],
          animatedGifOverlays: ov?.animatedGifOverlays ?? [],
        };
      });

      createStoryMutate(
        { items: storyItems, visibility },
        { onSuccess: finishSuccess, onError: finishError },
      );
    } catch (error: any) {
      setIsSharing(false);
      showToast("error", "Error", error?.message || "Something went wrong.");
    }
  }, [
    busy,
    isValid,
    hasMedia,
    mediaAssets,
    visibility,
    taggedUsers,
    uploadMultiple,
    createStoryMutate,
    setIsSharing,
    showToast,
    resetStore,
    router,
  ]);

  const handleClose = useCallback(() => {
    resetStore();
    useEditorStore.getState().resetEditor();
    router.back();
  }, [resetStore, router]);

  const progressDots =
    mediaAssets.length > 1 ? (
      <div className="absolute top-3 left-3 right-3 flex gap-1 z-10">
        {mediaAssets.map((_, idx) => (
          <div
            key={idx}
            className={`flex-1 h-0.5 rounded-full ${idx === currentIndex ? "bg-white" : "bg-white/30"}`}
          />
        ))}
      </div>
    ) : null;

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col text-white select-none"
      style={{ background: INK }}
    >
      {/* Sticky header — close / title / gradient Share */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-3"
        style={{
          borderBottom: `1px solid ${HAIRLINE}`,
          background: "rgba(6,7,13,0.85)",
          backdropFilter: "saturate(160%) blur(18px)",
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
        }}
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
          aria-label="Share"
          className="h-9 px-5 rounded-xl flex items-center gap-1.5 font-semibold text-black active:scale-95 disabled:opacity-40"
          style={{ background: DEVIANT_GRADIENT }}
        >
          <Check size={16} color={INK} strokeWidth={3} />
          {busy ? "Sharing…" : "Share"}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center px-3 py-4 w-full">
        {/* Upload progress */}
        {busy && (
          <div className="w-full max-w-md mb-4 rounded-2xl bg-black/80 p-4">
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

        {showEditor ? (
          <>
            {/* Stage + persistent rail (RightIslandMenu) + inline tool sheets */}
            <div className="relative flex items-start justify-center w-full">
              <EditorStage
                stageRef={stageRef}
                textOnly={textOnly}
                topOverlay={progressDots}
              />
              <RightIslandMenu mode={mode} onSelect={toggleMode} />
            </div>

            {/* Selected-element quick controls (scale / rotate / delete) */}
            {selected ? <SelectionBar /> : null}

            <p className="text-white/40 text-xs text-center max-w-xs mt-3">
              {elements.length === 0
                ? "Pick a tool on the right, then Share when you're done."
                : `${elements.length} overlay${elements.length === 1 ? "" : "s"} · drag to reposition`}
            </p>
          </>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full max-w-md aspect-[9/16] rounded-2xl bg-black flex flex-col items-center justify-center gap-3 text-white/45 border border-white/10"
          >
            <ImageIcon size={48} />
            <span className="text-base">Add media to get started</span>
          </button>
        )}

        {/* Media thumbnails */}
        {hasMedia && (
          <div className="w-full max-w-md mt-4 flex gap-2 overflow-x-auto pb-1">
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

        <div className="flex-1" />

        {/* Visibility toggle */}
        <div className="w-full max-w-md flex justify-center mt-5 mb-4">
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

        {/* Action buttons — Gallery + Text (text starts a text-only story) */}
        <div className="w-full max-w-md flex justify-center gap-8 pb-6">
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
            onClick={startTextStory}
            disabled={busy || hasMedia}
            className={`flex flex-col items-center gap-1 ${busy || hasMedia ? "opacity-40" : ""}`}
          >
            <span className="w-14 h-14 rounded-xl bg-white/8 flex items-center justify-center">
              <Type size={24} color="#fff" />
            </span>
            <span className="text-white/55 text-xs">Text</span>
          </button>
        </div>
      </main>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onPickFiles}
      />

      {/* Non-modal tool sheets — canvas stays visible above them. */}
      {mode === "text" ? <TextPanel /> : null}
      {mode === "drawing" ? <DrawingPanel /> : null}
      {mode === "sticker" ? <StickerPanel /> : null}
      {mode === "filter" ? <FilterPanel mediaUri={editorMediaUri} /> : null}
      {mode === "adjust" ? <AdjustPanel /> : null}
      {textOnly && mode === "idle" ? <BackgroundStrip /> : null}
    </div>
  );
}
