// ============================================================
// Canvas Kit Element Layer — WS-1 Transformer swap scaffold
// ============================================================
// Renders the INTERACTIVE element + brush layer of the story editor through
// react-native-canvas-kit, driven entirely by props sourced from the Zustand
// editor-store (the single source of truth — this is a renderer, never a
// second store). Replaces ElementGestureOverlay + shared-element-transforms +
// useElementTransform + useGestures for image/emoji stickers.
//
// SCOPE (baseline §5/§6 — Image editor first, hybrid):
//   • image + emoji stickers  -> kit Image / kit Text nodes + Transformer
//   • drawing                 -> kit BrushLayer (pen/marker/highlighter/eraser)
//   • text elements           -> DELEGATED to EditorCanvas.TextElementRenderer
//                                (kit Text is single-line; rich text is a gap)
//   • GIF stickers            -> DELEGATED to AnimatedGifStickerLayer (RN overlay)
//   • media / filters / vignette / grain / EXPORT SNAPSHOT
//                             -> stay in the raw-Skia EditorCanvas (Stage has
//                                no snapshot handle — baseline §4 item 1)
//
// NOT yet wired into the live EditorScreen: the transform/gesture behavior is
// REGRESSION_LOCK-governed and needs on-device verification (INV-PERF-2,
// INV-RENDER-6, cancel/back matrices) that is impossible in this environment.
// This module compiles and is import-ready for that swap.
// ============================================================

import React, { useCallback } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  Stage,
  Group,
  Image as KitImage,
  Text as KitText,
  Transformer,
  BrushLayer,
} from "react-native-canvas-kit";
import type {
  BrushStrokeEvent,
  BrushTool,
  EventObject,
  TransformEvent,
} from "react-native-canvas-kit";
import type { CanvasElement, DrawingPath, Transform } from "../types";
import type { RenderSurface } from "../utils/geometry";
import {
  elementToNodeConfig,
  nodeHandleToTransform,
  transformResultToTransform,
  type ElementNodeSize,
} from "./mappers";
import { brushStrokeToDrawingPath } from "./brush-mapping";

export interface CanvasKitElementLayerProps {
  /** All store elements (unsorted OK — sorted by zIndex here). */
  elements: CanvasElement[];
  selectedElementId: string | null;
  /** Reactive canvas<->display geometry (useRenderSurface). */
  surface: RenderSurface;
  /**
   * Active kit brush tool, or null when not in drawing mode / when the store
   * tool has no kit brush (neon/arrow — see brush-mapping). When non-null,
   * the kit stage routes single-finger pans to the brush, so element drag is
   * naturally suppressed while drawing.
   */
  brushTool: BrushTool | null;
  drawingColor: string;
  /** Stroke width in canvas units. */
  strokeWidth: number;
  onSelect: (id: string | null) => void;
  onCommitTransform: (id: string, transform: Transform) => void;
  onCommitStroke: (path: DrawingPath) => void;
  style?: StyleProp<ViewStyle>;
}

/** Sticker node size in CANVAS units (square). */
function stickerNodeSize(size: number): ElementNodeSize {
  return { width: size, height: size };
}

/**
 * WS-1 element + brush layer. The Stage is sized to display pixels; element
 * nodes live inside one scaled Group so they stay in 1080×1920 canvas coords
 * (parity with EditorCanvas's root scale Group). The BrushLayer sits at the
 * Stage root so its live stroke is captured in display space, then converted
 * back to canvas coords on commit via `surface.scale`.
 */
export const CanvasKitElementLayer: React.FC<CanvasKitElementLayerProps> =
  React.memo(
    ({
      elements,
      selectedElementId,
      surface,
      brushTool,
      drawingColor,
      strokeWidth,
      onSelect,
      onCommitTransform,
      onCommitStroke,
      style,
    }) => {
      const handleStrokeEnd = useCallback(
        (stroke: BrushStrokeEvent) => {
          const path = brushStrokeToDrawingPath(stroke, {
            color: drawingColor,
            strokeWidth,
            scale: surface.scale,
          });
          onCommitStroke(path);
        },
        [drawingColor, strokeWidth, surface.scale, onCommitStroke],
      );

      const handleTransformEnd = useCallback(
        (evt: TransformEvent) => {
          if (!selectedElementId) return;
          onCommitTransform(
            selectedElementId,
            transformResultToTransform(evt),
          );
        },
        [selectedElementId, onCommitTransform],
      );

      // Only image + emoji stickers render as kit nodes in WS-1 (text/gif
      // delegated). Sort by zIndex so kit child order == store z-order.
      const nodes = [...elements]
        .filter(
          (el): el is Extract<CanvasElement, { type: "sticker" }> =>
            el.type === "sticker" && el.category !== "gif",
        )
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((el) => {
          const config = elementToNodeConfig(el, stickerNodeSize(el.size));
          const onDragEnd = (e: EventObject) =>
            onCommitTransform(el.id, nodeHandleToTransform(e.target));
          const onTap = () => onSelect(el.id);

          const src = el.source;
          const isImage =
            typeof src === "number" ||
            (typeof src === "string" && src.startsWith("http"));

          if (isImage) {
            return (
              <KitImage
                key={el.id}
                {...config}
                src={src}
                width={el.size}
                height={el.size}
                fit="contain"
                onDragEnd={onDragEnd}
                onTap={onTap}
              />
            );
          }

          // Emoji glyph via matchFont (single glyph — kit Text is fine here).
          return (
            <KitText
              key={el.id}
              {...config}
              text={String(src)}
              fontSize={el.size}
              onDragEnd={onDragEnd}
              onTap={onTap}
            />
          );
        });

      return (
        <Stage
          width={surface.displayW}
          height={surface.displayH}
          style={style}
        >
          <Group scaleX={surface.scale} scaleY={surface.scale}>
            {nodes}
            <Transformer
              node={selectedElementId}
              keepRatio
              onTransformEnd={handleTransformEnd}
            />
          </Group>
          <BrushLayer tool={brushTool} onStrokeEnd={handleStrokeEnd} />
        </Stage>
      );
    },
  );

CanvasKitElementLayer.displayName = "CanvasKitElementLayer";
