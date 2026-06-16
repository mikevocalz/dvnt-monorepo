// ============================================================
// Instagram Stories Editor - Main Editor Screen
// ============================================================
//
// Orchestrates all editor components: canvas, toolbars, panels.
// Receives mediaUri + mediaType as props and manages the full
// editing workflow.
// ============================================================

import React, { useCallback, useRef, useMemo, useEffect, useState } from "react";
import { View, StatusBar, Alert, ActivityIndicator, Text } from "react-native";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useCanvasRef } from "@shopify/react-native-skia";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Haptics from "expo-haptics";
import { ImageFormat } from "@shopify/react-native-skia";
import {
  useEditorStore,
  useSelectedElement,
  useCanUndo,
  useCanRedo,
  useHasElements,
} from "../stores/editor-store";
import {
  EffectFilter,
  DRAWING_TOOL_CONFIG,
  STORY_BACKGROUNDS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "../constants";
import { ElementGestureOverlay } from "../components/gestures/ElementGestureOverlay";
import { AnimatedGifStickerLayer } from "../components/canvas/AnimatedGifStickerLayer";
import {
  EditorCanvas,
  RightIslandMenu,
  BottomActionBar,
  TopNavBar,
  DrawingToolbar,
  TextEditor,
  StickerPicker,
  FilterSelector,
  AdjustmentPanel,
  BackgroundPicker,
} from "../components";
import { AnimatedToolPanel } from "../components/panels/AnimatedToolPanel";
import { PerfHUD } from "../components/canvas/PerfHUD";
import {
  DrawingPath,
  Position,
  TextElement,
  StickerElement,
  FilterAdjustment,
  EditorMode,
} from "../types";
import { generateId } from "../utils/helpers";
import { useRenderSurface, screenToCanvas } from "../utils/geometry";
import type { StoryAnimatedGifOverlay, StoryOverlay } from "@dvnt/app/lib/types";

// ---- Props ----

interface EditorScreenProps {
  mediaUri: string;
  mediaType: "image" | "video";
  onClose: () => void;
  onSave?: (result: {
    editedUri: string;
    mediaType: "image" | "video";
    storyOverlays: StoryOverlay[];
    animatedGifOverlays: StoryAnimatedGifOverlay[];
  }) => void;
  initialMode?: EditorMode;
  autoCompleteTextOnly?: boolean;
}

function extractStoryOverlays(
  elements: Array<TextElement | StickerElement>,
): StoryOverlay[] {
  const overlays = elements
    .map<StoryOverlay | null>((element) => {
      if (element.type === "text") {
        return {
          id: element.id,
          type: "text" as const,
          content: element.content,
          x: Number((element.transform.translateX / CANVAS_WIDTH).toFixed(6)),
          y: Number((element.transform.translateY / CANVAS_HEIGHT).toFixed(6)),
          scale: Number(element.transform.scale.toFixed(6)),
          rotation: Number(element.transform.rotation.toFixed(3)),
          opacity: Number(element.opacity.toFixed(3)),
          color: element.color,
          backgroundColor: element.backgroundColor,
          fontFamily: element.fontFamily,
          fontSizeRatio: Number((element.fontSize / CANVAS_WIDTH).toFixed(6)),
          maxWidthRatio: Number((element.maxWidth / CANVAS_WIDTH).toFixed(6)),
          textAlign: element.textAlign,
        };
      }

      if (element.category === "gif" && typeof element.source === "string") {
        return {
          id: element.id,
          type: "animated_gif" as const,
          url: element.source,
          x: Number((element.transform.translateX / CANVAS_WIDTH).toFixed(6)),
          y: Number((element.transform.translateY / CANVAS_HEIGHT).toFixed(6)),
          sizeRatio: Number((element.size / CANVAS_WIDTH).toFixed(6)),
          scale: Number(element.transform.scale.toFixed(6)),
          rotation: Number(element.transform.rotation.toFixed(3)),
          opacity: Number(element.opacity.toFixed(3)),
        };
      }

      if (element.category === "emoji" && typeof element.source === "string") {
        return {
          id: element.id,
          type: "emoji" as const,
          emoji: element.source,
          x: Number((element.transform.translateX / CANVAS_WIDTH).toFixed(6)),
          y: Number((element.transform.translateY / CANVAS_HEIGHT).toFixed(6)),
          sizeRatio: Number((element.size / CANVAS_WIDTH).toFixed(6)),
          scale: Number(element.transform.scale.toFixed(6)),
          rotation: Number(element.transform.rotation.toFixed(3)),
          opacity: Number(element.opacity.toFixed(3)),
        };
      }

      if (typeof element.source === "number" && element.assetId) {
        return {
          id: element.id,
          type: "sticker" as const,
          source: "asset" as const,
          assetId: element.assetId,
          x: Number((element.transform.translateX / CANVAS_WIDTH).toFixed(6)),
          y: Number((element.transform.translateY / CANVAS_HEIGHT).toFixed(6)),
          sizeRatio: Number((element.size / CANVAS_WIDTH).toFixed(6)),
          scale: Number(element.transform.scale.toFixed(6)),
          rotation: Number(element.transform.rotation.toFixed(3)),
          opacity: Number(element.opacity.toFixed(3)),
        };
      }

      if (typeof element.source === "string" && element.source.startsWith("http")) {
        return {
          id: element.id,
          type: "sticker" as const,
          source: "url" as const,
          url: element.source,
          x: Number((element.transform.translateX / CANVAS_WIDTH).toFixed(6)),
          y: Number((element.transform.translateY / CANVAS_HEIGHT).toFixed(6)),
          sizeRatio: Number((element.size / CANVAS_WIDTH).toFixed(6)),
          scale: Number(element.transform.scale.toFixed(6)),
          rotation: Number(element.transform.rotation.toFixed(3)),
          opacity: Number(element.opacity.toFixed(3)),
        };
      }

      return null;
    });

  return overlays.filter((overlay): overlay is StoryOverlay => overlay !== null);
}

function extractAnimatedGifOverlays(
  overlays: StoryOverlay[],
): StoryAnimatedGifOverlay[] {
  return overlays
    .filter((overlay) => overlay.type === "animated_gif")
    .map((overlay) => ({
      id: overlay.id,
      url: overlay.url,
      x: overlay.x,
      y: overlay.y,
      sizeRatio: overlay.sizeRatio,
      scale: overlay.scale,
      rotation: overlay.rotation,
    }));
}

// ---- Component ----

export const EditorScreen: React.FC<EditorScreenProps> = ({
  mediaUri,
  mediaType,
  onClose,
  onSave,
  initialMode,
  autoCompleteTextOnly = false,
}) => {
  // Zustand store — persists across navigations
  const setMode = useEditorStore((s) => s.setMode);
  const setMedia = useEditorStore((s) => s.setMedia);
  const addTextElement = useEditorStore((s) => s.addTextElement);
  const addStickerElement = useEditorStore((s) => s.addStickerElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);
  const selectElement = useEditorStore((s) => s.selectElement);
  const addDrawingPath = useEditorStore((s) => s.addDrawingPath);
  const undoLastPath = useEditorStore((s) => s.undoLastPath);
  const clearDrawing = useEditorStore((s) => s.clearDrawing);
  const setFilter = useEditorStore((s) => s.setFilter);
  const setAdjustments = useEditorStore((s) => s.setAdjustments);
  const resetAdjustments = useEditorStore((s) => s.resetAdjustments);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const mode = useEditorStore((s) => s.mode);
  const elements = useEditorStore((s) => s.elements);
  const drawingPaths = useEditorStore((s) => s.drawingPaths);
  const currentFilter = useEditorStore((s) => s.currentFilter);
  const adjustments = useEditorStore((s) => s.adjustments);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const videoCurrentTime = useEditorStore((s) => s.videoCurrentTime);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const storeMediaUri = useEditorStore((s) => s.mediaUri);
  const storeMediaType = useEditorStore((s) => s.mediaType);
  const textOnlyMode = useEditorStore((s) => s.textOnlyMode);
  const setTextOnlyMode = useEditorStore((s) => s.setTextOnlyMode);
  const textEditContent = useEditorStore((s) => s.textEditContent);

  const selectedElement = useSelectedElement();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const hasElements = useHasElements();
  const stickerElements = useMemo(
    () =>
      elements.filter(
        (element): element is StickerElement => element.type === "sticker",
      ),
    [elements],
  );

  // All UI state from Zustand store (no useState)
  const selectedEffectId = useEditorStore((s) => s.selectedEffectId);
  const setSelectedEffectId = useEditorStore((s) => s.setSelectedEffectId);
  const canvasBackgroundId = useEditorStore((s) => s.canvasBackground);
  const setCanvasBackgroundId = useEditorStore((s) => s.setCanvasBackground);
  const showPerfHUD = useEditorStore((s) => s.showPerfHUD);

  // ---- Geometry: single source of truth (reactive to screen changes) ----
  const surface = useRenderSurface();

  const drawingTool = useEditorStore((s) => s.drawingTool);
  const setDrawingTool = useEditorStore((s) => s.setDrawingTool);
  const drawingColor = useEditorStore((s) => s.drawingColor);
  const setDrawingColor = useEditorStore((s) => s.setDrawingColor);
  const strokeWidth = useEditorStore((s) => s.strokeWidth);
  const setStrokeWidth = useEditorStore((s) => s.setStrokeWidth);

  // Resolve background object from ID
  const canvasBackground = useMemo(
    () =>
      STORY_BACKGROUNDS.find((b) => b.id === canvasBackgroundId) ??
      STORY_BACKGROUNDS[0],
    [canvasBackgroundId],
  );

  const handleSelectEffect = useCallback(
    (effect: EffectFilter) => {
      if (selectedEffectId === effect.id) {
        setSelectedEffectId(null);
        setFilter(null);
      } else {
        setSelectedEffectId(effect.id);
        setFilter({
          id: effect.id,
          name: effect.name,
          matrix: effect.matrix,
          intensity: effect.intensity,
        });
      }
    },
    [selectedEffectId, setFilter, setSelectedEffectId],
  );

  // Canvas ref for snapshot export
  const canvasRef = useCanvasRef();

  // Live stroke points — ref-based to avoid per-point React re-renders
  const currentPathPoints = useRef<Position[]>([]);
  const liveStrokePointsRef = useRef<Position[]>([]);
  // We need a render trigger for the canvas to pick up live stroke changes
  const liveStrokeVersion = useRef(0);
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);

  // Set initial media and text-only flag
  React.useEffect(() => {
    setMedia(mediaUri, mediaType);
    // Only enable text-only mode when explicitly opened from the
    // dedicated text-only entrypoint, never from regular media editing.
    setTextOnlyMode(initialMode === "text" && !mediaUri);
  }, [initialMode, mediaUri, mediaType, setMedia, setTextOnlyMode]);

  // [REGRESSION LOCK] Apply initialMode immediately after first layout frame.
  // rAF ensures layout is committed before mode change triggers panel mount.
  const initialModeApplied = useRef(false);
  React.useEffect(() => {
    if (initialMode && !initialModeApplied.current) {
      initialModeApplied.current = true;
      requestAnimationFrame(() => {
        useEditorStore.getState().setMode(initialMode);
      });
    }
  }, [initialMode]);

  // ---- Drawing Handlers ----

  const handlePathStart = useCallback((point: Position) => {
    currentPathPoints.current = [point];
    liveStrokePointsRef.current = [point];
    forceRender();
  }, []);

  const handlePathUpdate = useCallback((point: Position) => {
    const pts = currentPathPoints.current;
    // Point decimation: skip points within 3px (canvas coords) of last committed point
    if (pts.length > 0) {
      const last = pts[pts.length - 1];
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx * dx + dy * dy < 9) return; // 3px² threshold
    }
    pts.push(point);
    liveStrokePointsRef.current = pts;
    // Trigger canvas update every 5 points (reduced from 3 for fewer re-renders)
    if (pts.length % 5 === 0) {
      forceRender();
    }
  }, []);

  const handlePathEnd = useCallback(() => {
    liveStrokePointsRef.current = [];
    forceRender();
    if (currentPathPoints.current.length < 2) return;

    const {
      drawingTool: tool,
      drawingColor: color,
      strokeWidth: sw,
    } = useEditorStore.getState();
    const toolConfig = DRAWING_TOOL_CONFIG[tool];
    const path: DrawingPath = {
      id: generateId(),
      points: [...currentPathPoints.current],
      color: color,
      strokeWidth: sw,
      tool: tool,
      opacity: toolConfig.opacity,
    };

    addDrawingPath(path);
    currentPathPoints.current = [];
  }, [addDrawingPath]);

  // ---- Text Handlers ----

  const handleAddText = useCallback(
    (options: Partial<TextElement>) => {
      return addTextElement(options);
    },
    [addTextElement],
  );

  const handleUpdateText = useCallback(
    (id: string, updates: Partial<TextElement>) => {
      updateElement(id, updates);
    },
    [updateElement],
  );

  // ---- Sticker Handlers ----

  const handleSelectSticker = useCallback(
    (
      source: string | number,
      options?: {
        category?: StickerElement["category"];
      },
    ) => {
      console.log(
        "[Editor] Adding sticker:",
        typeof source === "string" ? source.substring(0, 60) : source,
      );
      addStickerElement(source, { category: options?.category });
      setMode("idle");
    },
    [addStickerElement, setMode],
  );

  const handleSelectImageSticker = useCallback(
    (source: number, id: string) => {
      console.log("[Editor] Adding image sticker (require ID):", source);
      addStickerElement(source, { assetId: id, category: "custom" });
      setMode("idle");
    },
    [addStickerElement, setMode],
  );

  // ---- Filter Handlers ----

  const handleAdjustmentChange = useCallback(
    (key: keyof FilterAdjustment, value: number) => {
      setAdjustments({ [key]: value });
    },
    [setAdjustments],
  );

  // ---- Media Picker ----

  const handlePickMedia = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      quality: 1,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const type = asset.type === "video" ? "video" : "image";
      setMedia(asset.uri, type as "image" | "video");
      setTextOnlyMode(false);
    }
  }, [setMedia, setTextOnlyMode]);

  // ---- Export / Save ----

  const setExportStatus = useEditorStore((s) => s.setExportStatus);
  const setExportArtifact = useEditorStore((s) => s.setExportArtifact);
  const setExportError = useEditorStore((s) => s.setExportError);
  const exportStatus = useEditorStore((s) => s.exportSession.status);
  const [captureMode, setCaptureMode] = useState<"idle" | "story-export">(
    "idle",
  );
  const [isAutoCompletingTextOnly, setIsAutoCompletingTextOnly] =
    useState(false);
  const autoCompleteProofTriggeredRef = useRef(false);

  /**
   * Capture the Skia canvas as a PNG file.
   * makeImageSnapshot() captures the FULL scene graph (media + filters +
   * adjustments + drawing + stickers + text) — it's WYSIWYG by definition
   * because it snapshots exactly what the Canvas component renders.
   */
  const captureCanvas = useCallback(async (): Promise<string | null> => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.warn("[Editor] Canvas ref not mounted");
      return null;
    }

    // Deselect so selection border doesn't appear in snapshot
    setCaptureMode("story-export");
    useEditorStore.getState().selectElement(null);

    try {
      // Give Skia + overlay state enough time to settle after hiding selection
      // chrome. This prevents selection/bounding artifacts from being captured
      // on slower devices when the user saves immediately after a transform.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => setTimeout(r, 180));

      const trySnapshot = () => {
        try {
          const image = canvas.makeImageSnapshot();
          if (!image) {
            console.warn("[Editor] makeImageSnapshot returned null");
            return null;
          }
          const w = image.width();
          const h = image.height();
          if (w === 0 || h === 0) {
            console.warn(`[Editor] Snapshot has zero dimensions: ${w}x${h}`);
            return null;
          }
          if (__DEV__) console.log(`[Editor] Snapshot OK: ${w}x${h}`);
          return image;
        } catch (e) {
          console.warn("[Editor] makeImageSnapshot threw:", e);
          return null;
        }
      };

      let image = trySnapshot();
      if (!image) {
        await new Promise<void>((r) => setTimeout(r, 200));
        image = trySnapshot();
      }
      if (!image) {
        console.warn("[Editor] makeImageSnapshot returned null after retry");
        return null;
      }

      let base64: string | null = null;
      try {
        base64 = image.encodeToBase64(ImageFormat.PNG, 100);
      } catch {
        try {
          base64 = image.encodeToBase64();
        } catch (e2) {
          console.warn("[Editor] encodeToBase64 threw:", e2);
        }
      }
      if (!base64 || base64.length === 0) {
        console.warn("[Editor] encodeToBase64 returned empty");
        return null;
      }

      const file = new FileSystem.File(
        FileSystem.Paths.cache,
        `story_${Date.now()}.png`,
      );
      file.write(base64, { encoding: "base64" });
      if (__DEV__) {
        console.log(
          "[Editor] Canvas captured to",
          file.uri,
          `(${image.width()}x${image.height()}, ${(base64.length / 1024).toFixed(0)}KB b64)`,
        );
      }
      return file.uri;
    } catch (err) {
      console.error("[Editor] Capture failed:", err);
      return null;
    } finally {
      setCaptureMode("idle");
    }
  }, [canvasRef]);

  /**
   * Render the final artifact and store it in the export session.
   * Used by both "Done" (navigate to review) and "Save" (direct save).
   */
  const renderFinalArtifact = useCallback(async () => {
    const currentStatus = useEditorStore.getState().exportSession.status;
    if (currentStatus === "rendering") return; // idempotent
    setExportStatus("rendering");
    try {
      const uri = await captureCanvas();
      if (!uri) {
        setExportError("Failed to capture canvas snapshot");
        return null;
      }
      const artifact = {
        uri,
        type: "image" as const,
        width: surface.displayW,
        height: surface.displayH,
      };
      setExportArtifact(artifact);
      return artifact;
    } catch (err) {
      setExportError((err as Error).message);
      return null;
    }
  }, [
    captureCanvas,
    surface,
    setExportStatus,
    setExportArtifact,
    setExportError,
  ]);

  /**
   * Save the current export artifact (or render one first) to the photo library.
   */
  const showToast = useUIStore((s) => s.showToast);

  const handleSaveToLibrary = useCallback(async () => {
    if (storeMediaType === "video") {
      showToast(
        "warning",
        "Video Save Unavailable",
        "Saving edited video stories to the library is not available yet.",
      );
      return;
    }
    let artifact = useEditorStore.getState().exportSession.artifact;
    if (!artifact) {
      const rendered = await renderFinalArtifact();
      if (!rendered) {
        showToast("error", "Error", "Failed to render story.");
        return;
      }
      artifact = rendered;
    }
    setExportStatus("saving");
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        showToast(
          "warning",
          "Permission",
          "Media library permission is required to save.",
        );
        setExportStatus("ready");
        return;
      }
      await MediaLibrary.saveToLibraryAsync(artifact.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setExportStatus("saved");
      showToast("success", "Saved", "Image saved to your gallery.");
    } catch (err) {
      console.error("[Editor] Save to gallery failed:", err);
      setExportError("Failed to save to gallery");
      showToast("error", "Error", "Failed to save image.");
    }
  }, [
    renderFinalArtifact,
    setExportStatus,
    setExportError,
    showToast,
    storeMediaType,
  ]);

  /**
   * "Done" / navigate back — renders artifact, passes URI to parent.
   */
  const handleSave = useCallback(async (): Promise<boolean> => {
    const allSerializableOverlays = extractStoryOverlays(
      useEditorStore
        .getState()
        .elements.filter(
          (element): element is TextElement | StickerElement =>
            element.type === "text" || element.type === "sticker",
        ),
    );
    const animatedGifOverlays =
      extractAnimatedGifOverlays(allSerializableOverlays);

    const hasUnsupportedVideoEdits =
      storeMediaType === "video" &&
      (drawingPaths.length > 0 ||
        currentFilter !== null ||
        Object.values(adjustments).some((value) => value !== 0));

    if (hasUnsupportedVideoEdits) {
      showToast(
        "warning",
        "Video Editing Limit",
        "Video stories currently support text, stickers, emoji, and GIF overlays only.",
      );
      return false;
    }

    if (storeMediaType === "video") {
      onSave?.({
        editedUri: storeMediaUri || mediaUri,
        mediaType: "video",
        storyOverlays: allSerializableOverlays,
        animatedGifOverlays,
      });
      return true;
    }

    const rendered = await renderFinalArtifact();
    if (!rendered) {
      showToast(
        "error",
        "Export Failed",
        "Could not render your story. Try again.",
      );
      return false;
    }

    onSave?.({
      editedUri: rendered.uri,
      mediaType: "image",
      storyOverlays: allSerializableOverlays.filter(
        (overlay) => overlay.type === "animated_gif",
      ),
      animatedGifOverlays,
    });
    return true;
  }, [
    adjustments,
    currentFilter,
    drawingPaths.length,
    mediaUri,
    onSave,
    renderFinalArtifact,
    showToast,
    storeMediaType,
    storeMediaUri,
  ]);

  const handleTextEditorDone = useCallback(() => {
    if (!textOnlyMode || !!storeMediaUri) {
      setMode("idle");
      return;
    }

    if (isAutoCompletingTextOnly) {
      return;
    }

    setIsAutoCompletingTextOnly(true);
    setMode("idle");

    requestAnimationFrame(() => {
      setTimeout(() => {
        void handleSave().then((didSave) => {
          setIsAutoCompletingTextOnly(false);
          if (!didSave) {
            setMode("text");
          }
        });
      }, 0);
    });
  }, [
    handleSave,
    isAutoCompletingTextOnly,
    setMode,
    storeMediaUri,
    textOnlyMode,
  ]);

  useEffect(() => {
    if (
      !autoCompleteTextOnly ||
      autoCompleteProofTriggeredRef.current ||
      mode !== "text" ||
      !textOnlyMode ||
      !!storeMediaUri ||
      !textEditContent.trim()
    ) {
      return;
    }

    autoCompleteProofTriggeredRef.current = true;
    const timer = setTimeout(() => {
      handleTextEditorDone();
    }, 320);

    return () => clearTimeout(timer);
  }, [
    autoCompleteTextOnly,
    handleTextEditorDone,
    mode,
    storeMediaUri,
    textEditContent,
    textOnlyMode,
  ]);

  useEffect(() => {
    if (
      storeMediaType === "video" &&
      (mode === "drawing" || mode === "filter" || mode === "adjust")
    ) {
      setMode("idle");
    }
  }, [mode, setMode, storeMediaType]);

  // ---- Close ----

  const hasAnyEdits =
    hasElements ||
    currentFilter !== null ||
    Object.values(adjustments).some((v) => v !== 0);

  const handleClose = useCallback(() => {
    if (hasAnyEdits) {
      Alert.alert("Discard Changes?", "You have unsaved edits.", [
        { text: "Keep Editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onClose },
      ]);
    } else {
      onClose();
    }
  }, [hasAnyEdits, onClose]);

  // ---- Drawing-only gesture (canvas-wide pan for freehand drawing) ----

  // Wrappers that convert screen→canvas coords on JS thread
  const onDrawStart = useCallback(
    (sx: number, sy: number) => {
      handlePathStart(screenToCanvas(sx, sy, surface));
    },
    [handlePathStart, surface],
  );
  const onDrawUpdate = useCallback(
    (sx: number, sy: number) => {
      handlePathUpdate(screenToCanvas(sx, sy, surface));
    },
    [handlePathUpdate, surface],
  );

  const drawingPanGesture = Gesture.Pan()
    .enabled(mode === "drawing")
    .minDistance(0)
    .onStart((e) => {
      "worklet";
      runOnJS(onDrawStart)(e.x, e.y);
    })
    .onUpdate((e) => {
      "worklet";
      runOnJS(onDrawUpdate)(e.x, e.y);
    })
    .onEnd(() => {
      "worklet";
      runOnJS(handlePathEnd)();
    });

  // Tap on canvas background deselects any selected element
  const deselectIfIdle = useCallback(() => {
    if (useEditorStore.getState().mode === "idle") {
      selectElement(null);
    }
  }, [selectElement]);

  const deselectTap = Gesture.Tap().onEnd(() => {
    "worklet";
    runOnJS(deselectIfIdle)();
  });

  const canvasGesture = Gesture.Race(drawingPanGesture, deselectTap);

  // ---- Per-element gesture overlay handlers ----
  const handleElementTransformEnd = useCallback(
    (
      id: string,
      transform: {
        translateX: number;
        translateY: number;
        scale: number;
        rotation: number;
      },
    ) => {
      updateElement(id, { transform } as any);
      // Keep the element selected after pinch/rotate so the user retains
      // control (Instagram/Snap behavior). Tapping the canvas background
      // deselects via `deselectTap` — that's the right release point, not
      // every gesture end.
    },
    [updateElement],
  );

  const handleElementDoubleTap = useCallback(
    (id: string) => {
      const el = elements.find((e) => e.id === id);
      if (el?.type === "text") {
        selectElement(id);
        setMode("text");
      }
    },
    [elements, selectElement, setMode],
  );

  // Compute element sizes for gesture overlay hit areas
  // CRITICAL: Enforce minimum so pinch/rotate is always possible
  const MIN_HIT = 200; // canvas-px — ~72px on screen, comfortable for 2-finger gestures
  const getElementSize = useCallback((el: (typeof elements)[0]) => {
    if (el.type === "sticker") {
      const size = Math.max((el as any).size || 250, MIN_HIT);
      return { width: size, height: size };
    }
    if (el.type === "text") {
      const maxW = (el as any).maxWidth || 400;
      const fontSize = (el as any).fontSize || 48;
      return {
        width: Math.max(maxW, MIN_HIT),
        height: Math.max(fontSize * 2, MIN_HIT),
      };
    }
    return { width: MIN_HIT, height: MIN_HIT };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar hidden />

      {/* ---- Main Canvas ---- */}
      <GestureDetector gesture={canvasGesture}>
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <EditorCanvas
            canvasRef={canvasRef}
            mediaUri={storeMediaUri}
            mediaType={storeMediaType}
            elements={elements}
            drawingPaths={drawingPaths}
            currentFilter={currentFilter}
            adjustments={adjustments}
            selectedElementId={selectedElementId}
            videoCurrentTime={videoCurrentTime}
            isPlaying={isPlaying}
            canvasBackground={canvasBackground}
            liveStrokePoints={liveStrokePointsRef.current}
            liveStrokeColor={drawingColor}
            liveStrokeWidth={strokeWidth}
            showDebugOverlay={showPerfHUD}
            hideSelection={captureMode !== "idle"}
          />
        </View>
      </GestureDetector>

      <AnimatedGifStickerLayer
        elements={stickerElements}
        surface={surface}
        selectedElementId={selectedElementId}
        showSelection={captureMode === "idle"}
      />

      {/* ---- Per-element gesture overlays (wcandillon pattern) ---- */}
      {/* Active in all modes except drawing (so you can move stickers while panels are open) */}
      {mode !== "drawing" &&
        mode !== "text" &&
        elements.map((el) => {
          const size = getElementSize(el);
          return (
            <ElementGestureOverlay
              key={el.id}
              elementId={el.id}
              elementType={el.type}
              elementWidth={size.width}
              elementHeight={size.height}
              surface={surface}
              isSelected={el.id === selectedElementId}
              initialTransform={el.transform}
              onSelect={selectElement}
              onTransformEnd={handleElementTransformEnd}
              onDoubleTap={handleElementDoubleTap}
              onDelete={removeElement}
            />
          );
        })}

      {/* ---- Top Navigation ---- */}
      {!isAutoCompletingTextOnly && (
        <TopNavBar
          onClose={handleClose}
          mode={mode}
          onDone={mode === "drawing" ? () => setMode("idle") : undefined}
        />
      )}

      {/* ---- Perf HUD (dev only) ---- */}
      <PerfHUD
        visible={showPerfHUD}
        elementCount={elements.length}
        drawingPathCount={drawingPaths.length}
        drawingPointCount={drawingPaths.reduce(
          (sum, p) => sum + p.points.length,
          0,
        )}
      />

      {/* ---- Right Island Menu — ALWAYS visible (not just idle) ---- */}
      {!isAutoCompletingTextOnly && (
        <RightIslandMenu
          mode={mode}
          onModeChange={setMode}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          allowedModes={
            storeMediaType === "video" ? ["text", "sticker"] : undefined
          }
        />
      )}

      {/* ---- Drawing Toolbar (overlay at bottom — thin bar) ---- */}
      {mode === "drawing" && (
        <DrawingToolbar
          selectedTool={drawingTool}
          selectedColor={drawingColor}
          strokeWidth={strokeWidth}
          onToolChange={(tool: string) => {
            setDrawingTool(tool as any);
          }}
          onColorChange={setDrawingColor}
          onStrokeWidthChange={setStrokeWidth}
          onUndo={undoLastPath}
          onClear={clearDrawing}
          onDone={() => setMode("idle")}
        />
      )}

      {/* ---- Text Editor (fullscreen overlay) ---- */}
      {mode === "text" && (
        <TextEditor
          element={
            selectedElement?.type === "text"
              ? (selectedElement as TextElement)
              : null
          }
          onAdd={handleAddText}
          onUpdate={handleUpdateText}
          onRemove={removeElement}
          onDone={handleTextEditorDone}
          onCancel={() => setMode("idle")}
        />
      )}

      {/* ---- Sticker Panel (animated overlay — no touch interception above) ---- */}
      <AnimatedToolPanel
        visible={mode === "sticker"}
        onDismiss={() => setMode("idle")}
        heightRatio={0.62}
        visualStyle="glass"
      >
        <StickerPicker
          onSelectSticker={handleSelectSticker}
          onSelectImageSticker={handleSelectImageSticker}
          onClose={() => setMode("idle")}
        />
      </AnimatedToolPanel>

      {/* ---- Filter Panel (animated overlay) ---- */}
      <AnimatedToolPanel
        visible={mode === "filter"}
        onDismiss={() => setMode("idle")}
        heightRatio={0.42}
      >
        <FilterSelector
          currentFilter={currentFilter}
          onSelectFilter={(f) => {
            setSelectedEffectId(null);
            setFilter(f);
          }}
          onSelectEffect={handleSelectEffect}
          selectedEffectId={selectedEffectId}
          mediaUri={storeMediaUri}
          onDone={() => setMode("idle")}
        />
      </AnimatedToolPanel>

      {/* ---- Adjustment Panel (animated overlay) ---- */}
      <AnimatedToolPanel
        visible={mode === "adjust"}
        onDismiss={() => setMode("idle")}
        heightRatio={0.55}
      >
        <AdjustmentPanel
          adjustments={adjustments}
          onAdjustmentChange={handleAdjustmentChange}
          onReset={resetAdjustments}
          onDone={() => setMode("idle")}
        />
      </AnimatedToolPanel>

      {/* ---- Background Picker (ONLY for explicit text-only stories) ---- */}
      {mode === "idle" && textOnlyMode && !isAutoCompletingTextOnly && (
        <BackgroundPicker
          selectedId={canvasBackground.id}
          onSelect={(bg: any) => setCanvasBackgroundId(bg.id)}
        />
      )}

      {/* ---- Bottom Action Bar ---- */}
      {!isAutoCompletingTextOnly && (
        <BottomActionBar
          mode={mode}
          onDone={handleSave}
          onPickMedia={handlePickMedia}
          onSaveToLibrary={handleSaveToLibrary}
          hasMedia={!!storeMediaUri}
          hasElements={hasElements}
        />
      )}

      {isAutoCompletingTextOnly && (
        <View
          pointerEvents="auto"
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.84)",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
            zIndex: 200,
          }}
        >
          <View
            style={{
              minWidth: 220,
              borderRadius: 24,
              backgroundColor: "rgba(14,14,18,0.96)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              paddingHorizontal: 22,
              paddingVertical: 20,
              alignItems: "center",
              gap: 10,
            }}
          >
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 17,
                fontWeight: "700",
              }}
            >
              Finishing story
            </Text>
            <Text
              style={{
                color: "rgba(255,255,255,0.68)",
                fontSize: 13,
                textAlign: "center",
                lineHeight: 18,
              }}
            >
              Saving your text story without dropping back into the editor.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
};
