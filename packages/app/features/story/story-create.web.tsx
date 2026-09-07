"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "solito/navigation";
import {
  X,
  Image as ImageIcon,
  Type,
  Globe,
  Star,
  Check,
  Camera,
  UserPlus,
} from "lucide-react";
import { useCreateStoryStore } from "@dvnt/app/lib/stores/create-story-store";
import { useCreateStory } from "@dvnt/app/lib/hooks/use-stories";
import {
  useMediaUpload,
  type MediaFile,
} from "@dvnt/app/lib/hooks/use-media-upload";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { storyTagsApi } from "@dvnt/app/lib/api/stories";
import type { TaggedUser } from "@dvnt/app/features/stories";
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
  STORY_CANVAS_WIDTH_CSS,
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


// ============================================================
// Camera capture (web) — getUserMedia, the browser's own camera API.
// Mirrors the native Camera tool: shoot, confirm, and the frame joins the
// same media pipeline a gallery pick uses.
// ============================================================

function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() =>
        setError(
          "Camera unavailable. Check the site's camera permission, or use Gallery.",
        ),
      );
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        setBusy(false);
        if (!blob) return;
        onCapture(
          new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      role="dialog"
      aria-label="Camera"
    >
      <button
        onClick={onClose}
        aria-label="Close camera"
        className="absolute top-4 left-4 w-10 h-10 rounded-xl flex items-center justify-center text-white/80"
        style={{ background: "rgba(255,255,255,0.1)" }}
      >
        <X size={20} />
      </button>

      {error ? (
        <p className="px-8 text-center text-sm text-white/70">{error}</p>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="rounded-2xl bg-black"
            style={{ width: STORY_CANVAS_WIDTH_CSS, aspectRatio: "9 / 16", objectFit: "cover" }}
          />
          <button
            onClick={shoot}
            disabled={busy}
            aria-label="Take photo"
            className="mt-6 w-16 h-16 rounded-full border-4 border-white/80 disabled:opacity-40"
            style={{ background: "rgba(255,255,255,0.9)" }}
          />
        </>
      )}
    </div>
  );
}

// ============================================================
// Tag people (web) — the Mention tool. Writes the shared draft store's
// `taggedUsers`; story-create's success handler persists them via
// storyTagsApi.addTags, exactly as native does.
// ============================================================

function TagPeople({
  selected,
  onChange,
  onClose,
}: {
  selected: TaggedUser[];
  onChange: (users: TaggedUser[]) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<TaggedUser[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      storyTagsApi
        .searchUsers(q, 15)
        .then((users) => {
          if (!cancelled) setResults(users as TaggedUser[]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  const toggle = (u: TaggedUser) =>
    onChange(
      selected.some((s) => s.id === u.id)
        ? selected.filter((s) => s.id !== u.id)
        : [...selected, u],
    );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "rgba(0,0,0,0.92)" }}
      role="dialog"
      aria-label="Tag people"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white/80"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <X size={20} />
        </button>
        <h2 className="text-[15px] font-semibold text-white">Tag people</h2>
        <button
          onClick={onClose}
          className="h-9 px-4 rounded-xl text-sm font-semibold text-white"
          style={{ background: "rgba(255,255,255,0.12)" }}
        >
          Done
        </button>
      </div>

      <div className="mx-auto w-full max-w-md px-4">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by username…"
          autoFocus
          className="w-full h-11 px-3 rounded-xl bg-white/10 text-white text-sm outline-none placeholder:text-white/40"
        />

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {selected.map((u) => (
              <button
                key={u.id}
                onClick={() => toggle(u)}
                className="h-8 px-3 rounded-full text-xs font-semibold text-white"
                style={{ background: "rgba(62,164,229,0.25)" }}
              >
                @{u.username} ×
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 overflow-y-auto" style={{ maxHeight: "50dvh" }}>
          {searching && results.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/50">Searching…</p>
          ) : term.trim() && results.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/50">
              No one matches that username.
            </p>
          ) : (
            results.map((u) => {
              const on = selected.some((sel) => sel.id === u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u)}
                  className="w-full flex items-center gap-3 h-14 px-2 rounded-xl text-left"
                >
                  {u.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.avatar}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <span className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
                  )}
                  <span className="flex-1 text-sm text-white">
                    @{u.username}
                  </span>
                  {on ? <Check size={18} color="#3EA4E5" /> : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
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
    setTaggedUsers,
  } = useCreateStoryStore();

  // Camera + tag-people overlays. Local UI state: neither belongs in the
  // shared draft store, and both close without leaving anything behind.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);

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
  const addFiles = useCallback(
    (files: File[]) => {
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
  /** File-input adapter — the camera path calls `addFiles` directly. */
  const onPickFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ""; // allow re-picking the same file
      addFiles(files);
    },
    [addFiles],
  );

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
            className="aspect-[9/16] rounded-2xl bg-black flex flex-col items-center justify-center gap-3 text-white/45 border border-white/10"
            // Same rule as the live canvas: `max-w-md` with no height budget
            // forced a 796px box that pushed the rail below the fold.
            style={{ width: STORY_CANVAS_WIDTH_CSS }}
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
            onClick={() => setCameraOpen(true)}
            disabled={mediaAssets.length >= MAX_STORY_ITEMS || busy}
            className={`flex flex-col items-center gap-1 ${mediaAssets.length >= MAX_STORY_ITEMS || busy ? "opacity-40" : ""}`}
          >
            <span className="w-14 h-14 rounded-xl bg-white/8 flex items-center justify-center">
              <Camera size={24} color="#fff" />
            </span>
            <span className="text-white/55 text-xs">Camera</span>
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

          <button
            onClick={() => setTagOpen(true)}
            disabled={busy}
            className={`flex flex-col items-center gap-1 ${busy ? "opacity-40" : ""}`}
          >
            <span
              className="w-14 h-14 rounded-xl flex items-center justify-center"
              style={{
                background:
                  taggedUsers.length > 0
                    ? "rgba(62,164,229,0.2)"
                    : "rgba(255,255,255,0.08)",
              }}
            >
              <UserPlus
                size={24}
                color={taggedUsers.length > 0 ? "#3EA4E5" : "#fff"}
              />
            </span>
            <span
              className="text-xs"
              style={{
                color:
                  taggedUsers.length > 0 ? "#3EA4E5" : "rgba(255,255,255,0.55)",
              }}
            >
              {taggedUsers.length > 0 ? `${taggedUsers.length} Tag` : "Mention"}
            </span>
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

      {cameraOpen ? (
        <CameraCapture
          onCapture={(file) => addFiles([file])}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
      {tagOpen ? (
        <TagPeople
          selected={taggedUsers}
          onChange={setTaggedUsers}
          onClose={() => setTagOpen(false)}
        />
      ) : null}
    </div>
  );
}
