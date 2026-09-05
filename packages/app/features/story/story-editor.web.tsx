"use client";

/**
 * Story overlay editor — WEB parts (feature-parity with the native editor).
 *
 * This module is the SHARED source of the web editor UI: the RightIslandMenu
 * rail, the tool sheets (Text / Draw / Stickers / Effects / Adjust), the
 * EditorStage, the overlay producers, and the export `bakeFrame`. The unified
 * story composer (`story-create.web.tsx`) imports these and hosts them INLINE —
 * the rail + sheets live on the create screen, Share bakes + uploads directly,
 * and there is no second /feed/story/editor screen and no result-store handoff.
 *
 * Native source of truth: app/(protected)/story/editor.tsx + src/stories-editor
 * (Skia canvas + gesture-handler + reanimated). Those native-graphics libs can't
 * run on web, so this is a SEPARATE browser-native implementation that drives the
 * SAME editor Zustand store the native editor uses:
 *   - useEditorStore  (features/stories-editor/stores/editor-store) — media +
 *     elements + drawing + filters + adjustments + backgrounds + tool UI state
 *
 * Web substrate (NO Skia / canvas-kit / reanimated / gesture-handler):
 *   - Drawing   → an HTML5 <canvas> 2D overlay; pointer strokes → addDrawingPath
 *                 (the SAME DrawingPath shape native uses). Strokes render from
 *                 store state so they persist and export.
 *   - Filters   → the LUT/effect 4×5 colour matrix + the adjustment matrix are
 *                 combined and applied live via an inline SVG feColorMatrix
 *                 (CSS `filter: url(#…)`), and baked per-pixel at export. This is
 *                 the SAME matrix math native runs, so output matches natively.
 *   - Backgrounds → setCanvasBackground rendered as the stage background.
 *   - Text v2   → font / size / colour / style / align / letter-spacing /
 *                 line-height / background pill, editing the store TextElement.
 *   - Stickers  → picker (tabs + search): emoji, DVNT + Ballroom image packs,
 *                 GIF, and DVNT-native interactive stickers (event / "I'm going"
 *                 ticket / mention / link) as metadata-bearing overlays.
 *
 * EXPORT CONTRACT (unchanged shape):
 *   The web path uploads the media + StoryOverlay[] (ratios 0..1 on 1080×1920);
 *   the shared StoryOverlayLayer re-renders text/sticker/emoji/gif at view time.
 *   Drawing + filters are NOT overlay kinds the viewer understands, so — exactly
 *   like native's makeImageSnapshot — they are BAKED into the exported image
 *   (media + filter + vignette + strokes flattened to a blob URL). Text and
 *   stickers stay as overlays (the pre-existing web contract). The
 *   StoryEditorResult shape is identical; only `uri` may now point at a baked
 *   frame instead of the raw media.
 *
 * HARD CONVENTIONS: NativeWind interop OFF — raw semantic HTML + Tailwind only,
 * no <View>/<Text>, no Skia / gesture-handler / reanimated. Business state =
 * Zustand; only ephemeral pointer/drag state lives in refs. useWindow
 * dimensions come from CSS (dvh/vw/cqw), never static Dimensions.
 */

import { useEffect, useRef, useState } from "react";
import {
  X,
  Type,
  Check,
  Trash2,
  Pencil,
  Smile,
  Sparkles,
  SlidersHorizontal,
  Palette,
  Undo2,
  Redo2,
  Search,
  Highlighter,
  Eraser,
  ArrowRight,
  PenLine,
  Brush,
  AtSign,
  Link as LinkIcon,
  Calendar,
  Ticket,
  Plus,
  Minus,
  RotateCw,
  ArrowLeft,
} from "lucide-react";
// eslint-disable-next-line no-restricted-imports -- deep store import: the stories-editor barrel re-exports EditorScreen (RN-only File.uri typing) which breaks apps/web's DOM-lib typecheck; route the store deep to keep web green.
import {
  useEditorStore,
  useSelectedElement,
} from "@dvnt/app/features/stories-editor/stores/editor-store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  LUT_FILTERS,
  EFFECT_FILTERS,
  STORY_BACKGROUNDS,
  TEXT_FONTS,
  TEXT_STYLE_PRESETS,
  EMOJI_STICKERS,
  IMAGE_STICKER_PACKS,
  DRAWING_COLORS,
  DRAWING_TOOL_CONFIG,
} from "@dvnt/app/features/stories-editor/constants";
import type {
  EffectFilter,
  StoryBackground,
} from "@dvnt/app/features/stories-editor/constants";
import type {
  CanvasElement,
  TextElement,
  StickerElement,
  DrawingPath,
  DrawingTool,
  FilterAdjustment,
  LUTFilter,
  Position,
  TextStylePreset,
} from "@dvnt/app/features/stories-editor/types";
// WS-4 interactive-sticker value entry: event/ticket search + @mention search.
// Verified sources — useEventSearch/useMyEvents return the `Event` shape
// (id/title/image/date/location); searchApi.searchUsers returns
// { docs: { id, username, avatar, name }[] }.
import { useQuery } from "@tanstack/react-query";
import { useEventSearch, useMyEvents } from "@dvnt/app/lib/hooks/use-events";
import { searchApi } from "@dvnt/app/lib/api/search";
// Single source of truth for image-sticker web URLs — shared with the story
// viewer / create-preview overlay renderer so the maps can't drift.
import { STICKER_WEB_URLS } from "@dvnt/app/components/story-overlays-layer.web";
import type {
  StoryOverlay,
  StoryAnimatedGifOverlay,
} from "@dvnt/app/lib/types";

// ── Brand tokens (docs/dvnt-design-system.md) ───────────────────────────
export const INK = "#06070d";
export const ACCENT = "#3FDCFF"; // cyan — primary accent
export const DANGER = "#FC253A";
export const DEVIANT_GRADIENT =
  "linear-gradient(100deg, #3FDCFF 0%, #8A40CF 52%, #FF5BFC 100%)";
export const SURFACE = "rgba(255,255,255,0.06)";
export const HAIRLINE = "rgba(255,255,255,0.10)";

/** The five tool modes the RightIslandMenu rail toggles. */
export type EditorToolMode =
  | "text"
  | "drawing"
  | "sticker"
  | "filter"
  | "adjust";

// Text/drawing colour palette — mirrors native color options.
const TEXT_COLORS = [
  "#FFFFFF",
  "#000000",
  ACCENT,
  "#FF5BFC",
  "#FFD43B",
  "#22C55E",
  "#FF6B6B",
  "#8A40CF",
];

// Web-local id gen (helpers.ts pulls RN Dimensions at module scope — keep it
// out of the web bundle by inlining the trivial generator).
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ============================================================
// Colour-matrix math (mirrors utils/helpers.ts — reimplemented here so the web
// bundle never imports the RN-Dimensions helpers module. Produces EXACTLY the
// same 4×5 matrix native applies, so filter output matches within rounding.)
// ============================================================

const IDENTITY_MATRIX = [
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
];

function multiplyColorMatrix(a: number[], b: number[]): number[] {
  const result = new Array(20).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[i * 5 + k] * b[k * 5 + j];
      if (j === 4) sum += a[i * 5 + 4];
      result[i * 5 + j] = sum;
    }
  }
  return result;
}

function buildAdjustmentMatrix(adj: FilterAdjustment): number[] {
  let m = [...IDENTITY_MATRIX];
  if (adj.brightness !== 0) {
    const b = adj.brightness / 100;
    m = multiplyColorMatrix(m, [1, 0, 0, 0, b, 0, 1, 0, 0, b, 0, 0, 1, 0, b, 0, 0, 0, 1, 0]);
  }
  if (adj.contrast !== 0) {
    const c = 1 + adj.contrast / 100;
    const t = -0.5 * c + 0.5;
    m = multiplyColorMatrix(m, [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0]);
  }
  if (adj.saturation !== 0) {
    const s = 1 + adj.saturation / 100;
    const sr = (1 - s) * 0.3086;
    const sg = (1 - s) * 0.6094;
    const sb = (1 - s) * 0.082;
    m = multiplyColorMatrix(m, [sr + s, sg, sb, 0, 0, sr, sg + s, sb, 0, 0, sr, sg, sb + s, 0, 0, 0, 0, 0, 1, 0]);
  }
  if (adj.temperature !== 0) {
    const t = (adj.temperature / 100) * 0.15;
    m = multiplyColorMatrix(m, [1, 0, 0, 0, t, 0, 1, 0, 0, 0, 0, 0, 1, 0, -t, 0, 0, 0, 1, 0]);
  }
  if (adj.tint !== 0) {
    const t = (adj.tint / 100) * 0.12;
    m = multiplyColorMatrix(m, [1, 0, 0, 0, 0, 0, 1, 0, 0, -t, 0, 0, 1, 0, t, 0, 0, 0, 1, 0]);
  }
  if (adj.fade !== 0) {
    const f = (adj.fade / 100) * 0.15;
    m = multiplyColorMatrix(m, [1, 0, 0, 0, f, 0, 1, 0, 0, f, 0, 0, 1, 0, f, 0, 0, 0, 1, 0]);
  }
  return m;
}

const ADJ_KEYS_IN_MATRIX: (keyof FilterAdjustment)[] = [
  "brightness",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "fade",
];

function combinedColorMatrix(
  filter: LUTFilter | null,
  adj: FilterAdjustment,
): number[] {
  const base =
    filter && filter.id !== "normal" ? filter.matrix : IDENTITY_MATRIX;
  return multiplyColorMatrix(buildAdjustmentMatrix(adj), base);
}

function hasVisibleColorMatrix(
  filter: LUTFilter | null,
  adj: FilterAdjustment,
): boolean {
  if (filter && filter.id !== "normal") return true;
  return ADJ_KEYS_IN_MATRIX.some((k) => adj[k] !== 0);
}

// ============================================================
// Export mappers — same ratios native uses (0..1 on 1080×1920).
// ============================================================

function textElementToOverlay(el: TextElement): StoryOverlay {
  return {
    id: el.id,
    type: "text",
    content: el.content,
    x: el.transform.translateX / CANVAS_WIDTH,
    y: el.transform.translateY / CANVAS_HEIGHT,
    scale: el.transform.scale,
    rotation: el.transform.rotation,
    opacity: el.opacity,
    color: el.color,
    backgroundColor: el.backgroundColor,
    fontFamily: el.fontFamily,
    fontSizeRatio: el.fontSize / CANVAS_WIDTH,
    maxWidthRatio: el.maxWidth / CANVAS_WIDTH,
    textAlign: el.textAlign,
    textStyle: el.style,
  };
}

// A DVNT interactive/WS-4 sticker (metadata-bearing) exports as a `text`
// overlay so the shared StoryOverlayLayer renders it, carrying its kind +
// metadata for the tappable region.
function ws4StickerToOverlay(el: StickerElement): StoryOverlay {
  return {
    id: el.id,
    type: "text",
    content: el.label ?? "",
    x: el.transform.translateX / CANVAS_WIDTH,
    y: el.transform.translateY / CANVAS_HEIGHT,
    scale: el.transform.scale,
    rotation: el.transform.rotation,
    opacity: el.opacity,
    color: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.55)",
    fontSizeRatio: (el.size * 0.22) / CANVAS_WIDTH,
    maxWidthRatio: 0.9,
    textAlign: "center",
    stickerKind: el.category,
    metadata: el.metadata,
  };
}

function stickerElementToOverlay(el: StickerElement): StoryOverlay {
  const src = typeof el.source === "string" ? el.source : "";
  const isEmoji =
    el.category === "emoji" && src.length > 0 && !src.includes("/");
  if (isEmoji) {
    return {
      id: el.id,
      type: "emoji",
      emoji: src,
      x: el.transform.translateX / CANVAS_WIDTH,
      y: el.transform.translateY / CANVAS_HEIGHT,
      sizeRatio: el.size / CANVAS_WIDTH,
      scale: el.transform.scale,
      rotation: el.transform.rotation,
      opacity: el.opacity,
    };
  }
  return {
    id: el.id,
    type: "sticker",
    x: el.transform.translateX / CANVAS_WIDTH,
    y: el.transform.translateY / CANVAS_HEIGHT,
    sizeRatio: el.size / CANVAS_WIDTH,
    scale: el.transform.scale,
    rotation: el.transform.rotation,
    opacity: el.opacity,
    source: el.assetId ? "asset" : "url",
    assetId: el.assetId,
    url: src || undefined,
    category: el.category,
    label: el.label,
    metadata: el.metadata,
  };
}

function gifStickerToAnimatedOverlay(
  el: StickerElement,
): StoryAnimatedGifOverlay {
  return {
    id: el.id,
    url: typeof el.source === "string" ? el.source : "",
    x: el.transform.translateX / CANVAS_WIDTH,
    y: el.transform.translateY / CANVAS_HEIGHT,
    sizeRatio: el.size / CANVAS_WIDTH,
    scale: el.transform.scale,
    rotation: el.transform.rotation,
  };
}

const isGif = (el: StickerElement) => el.category === "gif";
const isWs4 = (el: StickerElement) => el.metadata != null;

// Resolve a sticker asset `source` (a Metro require id on native, a webpack
// static import on web) to a browser URL. DVNT/Ballroom pack assets go through
// Next's asset pipeline → a string or `{ src }`; unresolved ids return "".
function assetToUrl(source: string | number): string {
  if (typeof source === "string") return source;
  const anySrc = source as unknown as { src?: string; default?: string };
  if (anySrc && typeof anySrc.src === "string") return anySrc.src;
  if (anySrc && typeof anySrc.default === "string") return anySrc.default;
  return "";
}

// Metro `require()` of the sticker PNGs doesn't resolve to a browser URL in the
// Next build (assetToUrl returns "" → blank cells), so on web we serve them
// from apps/web/public/stickers/ and resolve by sticker id. STICKER_WEB_URLS is
// now defined in the shared overlay renderer (story-overlays-layer.web) and
// imported above, so the editor and the viewer/preview share one map. Keep in
// sync with IMAGE_STICKER_PACKS (packages/app/features/stories-editor/constants).

// ============================================================
// Filter → CSS string for LIVE preview via feColorMatrix + vignette handled
// separately as an overlay (matches native's separate vignette layer).
// ============================================================

const LUT_FILTER_ID = "dvnt-story-lut";

// ============================================================
// Export helpers — shared by the unified create screen (story-create.web) so
// Share can bake + build overlays without a route hop / result-store handoff.
// ============================================================

/**
 * Build the portable overlay arrays (text / emoji / image-sticker / WS-4 →
 * storyOverlays; GIF → animatedGifOverlays) from a set of editor elements.
 * Same producer logic the standalone editor's Done used, so the publish shape
 * is unchanged.
 */
export function buildOverlaysFromElements(elements: CanvasElement[]): {
  storyOverlays: StoryOverlay[];
  animatedGifOverlays: StoryAnimatedGifOverlay[];
} {
  const storyOverlays: StoryOverlay[] = [];
  const animatedGifOverlays: StoryAnimatedGifOverlay[] = [];
  for (const el of elements) {
    if (el.type === "text") {
      storyOverlays.push(textElementToOverlay(el));
    } else if (el.type === "sticker") {
      if (isGif(el)) animatedGifOverlays.push(gifStickerToAnimatedOverlay(el));
      else if (isWs4(el)) storyOverlays.push(ws4StickerToOverlay(el));
      else storyOverlays.push(stickerElementToOverlay(el));
    }
  }
  return { storyOverlays, animatedGifOverlays };
}

/**
 * Whether an item's edits require an image bake (drawing / colour matrix /
 * vignette). Text / stickers stay as overlays and never force a bake.
 */
export function needsBake(edit: {
  drawingPaths: DrawingPath[];
  currentFilter: LUTFilter | null;
  adjustments: FilterAdjustment;
}): boolean {
  return (
    edit.drawingPaths.length > 0 ||
    hasVisibleColorMatrix(edit.currentFilter, edit.adjustments) ||
    edit.adjustments.vignette !== 0
  );
}

// ============================================================
// Stage (the 9:16 canvas) — self-contained: reads media / filter / adjustments
// / background / elements straight off the editor store, and owns the hidden
// SVG colour-matrix filter def the media element references. `topOverlay`
// renders chrome (e.g. multi-item progress dots) inside the stage frame.
// ============================================================

export function EditorStage({
  stageRef,
  textOnly,
  topOverlay,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  textOnly: boolean;
  topOverlay?: React.ReactNode;
}) {
  const elements = useEditorStore((s) => s.elements);
  const selectedId = useEditorStore((s) => s.selectedElementId);
  const mode = useEditorStore((s) => s.mode);
  const mediaUri = useEditorStore((s) => s.mediaUri) ?? "";
  const mediaType = useEditorStore((s) => s.mediaType);
  const background = useEditorStore((s) => s.canvasBackground);
  const currentFilter = useEditorStore((s) => s.currentFilter);
  const adjustments = useEditorStore((s) => s.adjustments);

  const bg = STORY_BACKGROUNDS.find((b) => b.id === background);
  const bgStyle = backgroundToCss(bg);
  const applyMatrix = hasVisibleColorMatrix(currentFilter, adjustments);
  const matrixValues = combinedColorMatrix(currentFilter, adjustments).join(" ");
  const mediaFilter = applyMatrix ? `url(#${LUT_FILTER_ID})` : undefined;
  const vignette = adjustments.vignette;

  return (
    <div
      ref={stageRef}
      className="relative overflow-hidden rounded-2xl select-none"
      style={{
        aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
        width: "min(84vw, 400px)",
        maxHeight: "68dvh",
        touchAction: "none",
        containerType: "inline-size",
        background: INK,
        border: `1px solid ${HAIRLINE}`,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          useEditorStore.getState().selectElement(null);
        }
      }}
    >
      {/* Hidden SVG colour-matrix filter (LUT + adjustments) for live preview */}
      <svg
        aria-hidden
        width={0}
        height={0}
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <filter id={LUT_FILTER_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={matrixValues} />
        </filter>
      </svg>

      {/* Base: media (filtered) or background */}
      {!textOnly && mediaUri ? (
        mediaType === "video" ? (
          <video
            src={mediaUri}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: mediaFilter }}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUri}
            alt="Story media"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: mediaFilter }}
            draggable={false}
          />
        )
      ) : (
        <div className="absolute inset-0" style={bgStyle} />
      )}

      {/* Vignette overlay (matches native's separate vignette layer) */}
      {vignette !== 0 ? (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,${(vignette / 100) * 0.85}) 100%)`,
          }}
        />
      ) : null}

      {/* Drawing layer — pointer-active only in drawing mode */}
      <DrawingLayer stageRef={stageRef} active={mode === "drawing"} />

      {/* Overlays (text + stickers), sorted by zIndex, above drawing */}
      {elements
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((el) => {
          if (el.type === "text") {
            return (
              <TextOverlay
                key={el.id}
                element={el}
                stageRef={stageRef}
                selected={el.id === selectedId}
                interactive={mode !== "drawing"}
              />
            );
          }
          if (el.type === "sticker") {
            return (
              <StickerOverlay
                key={el.id}
                element={el}
                stageRef={stageRef}
                selected={el.id === selectedId}
                interactive={mode !== "drawing"}
              />
            );
          }
          return null;
        })}

      {/* Stage-top chrome (multi-item progress dots, etc.) */}
      {topOverlay}
    </div>
  );
}

function backgroundToCss(bg?: StoryBackground): React.CSSProperties {
  if (!bg) return { background: "#000" };
  if (bg.type === "solid") return { background: bg.color };
  const angle = bg.angle ?? 180;
  return {
    backgroundImage: `linear-gradient(${angle}deg, ${(bg.colors ?? []).join(", ")})`,
  };
}

// ============================================================
// Drawing layer (HTML5 <canvas> 2D)
// ============================================================

function drawStroke(ctx: CanvasRenderingContext2D, path: DrawingPath) {
  const pts = path.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = path.tool === "highlighter" ? "butt" : "round";
  ctx.lineWidth = path.strokeWidth;
  ctx.strokeStyle = path.color;
  ctx.globalAlpha = path.opacity;

  if (path.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
  } else if (path.tool === "neon") {
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = path.color;
    ctx.shadowBlur = path.strokeWidth * 2.2;
  } else {
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
  } else if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();

  // Arrowhead terminator for the arrow tool.
  if (path.tool === "arrow" && pts.length >= 2) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(24, path.strokeWidth * 6);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - head * Math.cos(ang - Math.PI / 6),
      b.y - head * Math.sin(ang - Math.PI / 6),
    );
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - head * Math.cos(ang + Math.PI / 6),
      b.y - head * Math.sin(ang + Math.PI / 6),
    );
    ctx.stroke();
  }
  ctx.restore();
}

function DrawingLayer({
  stageRef,
  active,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPaths = useEditorStore((s) => s.drawingPaths);
  const drawRef = useRef<DrawingPath | null>(null);

  const redraw = (extra?: DrawingPath | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const p of useEditorStore.getState().drawingPaths) drawStroke(ctx, p);
    if (extra) drawStroke(ctx, extra);
  };

  // Redraw whenever committed paths change (persist + undo/redo).
  useEffect(() => {
    redraw();
  }, [drawingPaths]);

  const toCanvas = (e: React.PointerEvent): Position => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (!active) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = useEditorStore.getState();
    const cfg = DRAWING_TOOL_CONFIG[s.drawingTool];
    drawRef.current = {
      id: genId(),
      points: [toCanvas(e)],
      color: s.drawingColor,
      strokeWidth: s.strokeWidth,
      tool: s.drawingTool,
      opacity: cfg.opacity,
    };
    redraw(drawRef.current);
  };

  const onMove = (e: React.PointerEvent) => {
    const path = drawRef.current;
    if (!path) return;
    const pt = toCanvas(e);
    const last = path.points[path.points.length - 1];
    if (last) {
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      if (dx * dx + dy * dy < 9) return; // decimate: skip <3px moves
    }
    path.points.push(pt);
    redraw(path);
  };

  const onUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const path = drawRef.current;
    drawRef.current = null;
    if (path && path.points.length > 0) {
      useEditorStore.getState().addDrawingPath(path);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="absolute inset-0 w-full h-full"
      style={{ touchAction: "none", pointerEvents: active ? "auto" : "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}

// ============================================================
// Draggable overlays
// ============================================================

function useDrag(
  element: { id: string; transform: TextElement["transform"] },
  stageRef: React.RefObject<HTMLDivElement | null>,
  onTap?: () => void,
) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    useEditorStore.getState().selectElement(element.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: element.transform.translateX,
      originY: element.transform.translateY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    // Below the tap threshold this is still a tap, not a drag — don't move the
    // element (a jittery tap shouldn't nudge it out from under the finger).
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5
    ) {
      return;
    }
    drag.moved = true;
    const rect = stage.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / rect.width) * CANVAS_WIDTH;
    const dy = ((e.clientY - drag.startY) / rect.height) * CANVAS_HEIGHT;
    const nextX = Math.max(0, Math.min(CANVAS_WIDTH, drag.originX + dx));
    const nextY = Math.max(0, Math.min(CANVAS_HEIGHT, drag.originY + dy));
    useEditorStore.getState().updateElement(element.id, {
      transform: { ...element.transform, translateX: nextX, translateY: nextY },
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // A press that never crossed the drag threshold is a tap → activate editing
    // for this specific item (the element is already selected from pointerDown).
    if (dragRef.current && !dragRef.current.moved) onTap?.();
    dragRef.current = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}

function textStyleCss(el: TextElement): React.CSSProperties {
  const s = el.style as TextStylePreset;
  const base: React.CSSProperties = {};
  switch (s) {
    case "neon":
      base.textShadow = `0 0 8px ${el.color}, 0 0 18px ${el.color}`;
      break;
    case "shadow":
    case "classic":
      base.textShadow = "0 2px 6px rgba(0,0,0,0.5)";
      break;
    case "outline":
      (base as Record<string, string>).WebkitTextStroke = "2px #FFFFFF";
      break;
    case "strong":
      (base as Record<string, string>).WebkitTextStroke = "1.5px #FFFFFF";
      break;
    case "gradient":
      base.backgroundImage = DEVIANT_GRADIENT;
      (base as Record<string, string>).WebkitBackgroundClip = "text";
      (base as Record<string, string>).backgroundClip = "text";
      (base as Record<string, string>).WebkitTextFillColor = "transparent";
      break;
    default:
      break;
  }
  return base;
}

function TextOverlay({
  element,
  stageRef,
  selected,
  interactive,
}: {
  element: TextElement;
  stageRef: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
  interactive: boolean;
}) {
  // Tap a text item → open the Text panel bound to this element (edit its
  // content / colour / style). It's already selected from pointerDown.
  const drag = useDrag(element, stageRef, () =>
    useEditorStore.getState().setMode("text"),
  );
  const leftPct = (element.transform.translateX / CANVAS_WIDTH) * 100;
  const topPct = (element.transform.translateY / CANVAS_HEIGHT) * 100;
  const fontSizeRatio = element.fontSize / CANVAS_WIDTH;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={interactive ? drag.onPointerDown : undefined}
      onPointerMove={interactive ? drag.onPointerMove : undefined}
      onPointerUp={interactive ? drag.onPointerUp : undefined}
      className="absolute cursor-grab active:cursor-grabbing"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: `translate(-50%, -50%) scale(${element.transform.scale}) rotate(${element.transform.rotation}deg)`,
        maxWidth: `${(element.maxWidth / CANVAS_WIDTH) * 100}%`,
        outline: selected ? `1.5px solid ${ACCENT}` : "none",
        outlineOffset: 4,
        borderRadius: 8,
        padding: "2px 6px",
        backgroundColor: element.backgroundColor ?? "transparent",
        pointerEvents: interactive ? "auto" : "none",
        opacity: element.opacity,
      }}
    >
      <span
        dir="ltr"
        className="whitespace-pre-wrap break-words font-bold leading-tight"
        style={{
          color: element.color,
          fontFamily: `"${element.fontFamily}", system-ui, sans-serif`,
          fontSize: `${fontSizeRatio * 100}cqw`,
          textAlign: element.textAlign,
          display: "block",
          letterSpacing: element.letterSpacing ?? 0,
          lineHeight: element.lineHeight ?? 1.2,
          direction: "ltr",
          unicodeBidi: "plaintext",
          ...textStyleCss(element),
        }}
      >
        {element.content || " "}
      </span>
    </div>
  );
}

function StickerOverlay({
  element,
  stageRef,
  selected,
  interactive,
}: {
  element: StickerElement;
  stageRef: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
  interactive: boolean;
}) {
  const drag = useDrag(element, stageRef);
  const leftPct = (element.transform.translateX / CANVAS_WIDTH) * 100;
  const topPct = (element.transform.translateY / CANVAS_HEIGHT) * 100;
  const sizeRatio = element.size / CANVAS_WIDTH;
  const src = typeof element.source === "string" ? element.source : "";
  const isEmoji =
    element.category === "emoji" && src.length > 0 && !src.includes("/");
  const ws4 = isWs4(element);

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={interactive ? drag.onPointerDown : undefined}
      onPointerMove={interactive ? drag.onPointerMove : undefined}
      onPointerUp={interactive ? drag.onPointerUp : undefined}
      className="absolute cursor-grab active:cursor-grabbing"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: ws4 ? undefined : `${sizeRatio * 100}%`,
        transform: `translate(-50%, -50%) scale(${element.transform.scale}) rotate(${element.transform.rotation}deg)`,
        outline: selected ? `1.5px solid ${ACCENT}` : "none",
        outlineOffset: 4,
        borderRadius: ws4 ? 999 : 8,
        opacity: element.opacity,
        pointerEvents: interactive ? "auto" : "none",
      }}
    >
      {ws4 ? (
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 font-semibold text-sm whitespace-nowrap"
          style={{
            background: "rgba(0,0,0,0.55)",
            borderRadius: 999,
            border: `1px solid ${HAIRLINE}`,
            backdropFilter: "blur(8px)",
          }}
        >
          <Ws4Icon category={element.category} />
          <span>{element.label}</span>
        </div>
      ) : isEmoji ? (
        <span
          className="block text-center"
          style={{ fontSize: `${sizeRatio * 100}cqw` }}
        >
          {src}
        </span>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="sticker" className="w-full h-auto" draggable={false} />
      ) : null}
    </div>
  );
}

function Ws4Icon({ category }: { category: StickerElement["category"] }) {
  if (category === "mention") return <AtSign size={15} color={ACCENT} />;
  if (category === "link") return <LinkIcon size={15} color={ACCENT} />;
  if (category === "location") return <Calendar size={15} color={ACCENT} />;
  return <Ticket size={15} color={ACCENT} />;
}

// ============================================================
// Right island menu (persistent nav)
// ============================================================

const TOOLS: {
  id: "text" | "drawing" | "sticker" | "filter" | "adjust";
  Icon: typeof Type;
  label: string;
}[] = [
  { id: "text", Icon: Type, label: "Text" },
  { id: "drawing", Icon: Pencil, label: "Draw" },
  { id: "sticker", Icon: Smile, label: "Stickers" },
  { id: "filter", Icon: Sparkles, label: "Effects" },
  { id: "adjust", Icon: SlidersHorizontal, label: "Adjust" },
];

// v1-mobile "Dynamic Island" rail drawer, matched to the native component
// (components/toolbar/RightIslandMenu.tsx): magenta indicator tab (26×100,
// #FF5BFC, thin white chevron arrow) hugging the panel's LEFT edge; the whole
// [indicator][panel] group slides — closed = translated right by the panel
// width so only the tab shows, open = flush. Panel is solid black w/ #555
// border; Undo/Redo circular row on top; tool options are icon-ABOVE-label,
// 72px tall; active = blue tint + 3px left border. CSS transition (no
// reanimated on web). Tap tab to toggle, tap tool to select + collapse.
const RAIL = {
  panelW: 140,
  indicatorW: 26,
  indicatorH: 100,
  optionH: 72,
  indicator: "#FF5BFC",
  bg: "#000",
  border: "#555",
  text: "#B3AFAF",
  activeBg: "rgba(59,130,246,0.25)",
  activeBar: "#3B82F6",
  activeIcon: "#fff",
  spring: "cubic-bezier(0.22,1,0.36,1)",
};

function RailArrow({ open }: { open: boolean }) {
  return (
    <svg
      width={12}
      height={20}
      viewBox="0 0 12 20"
      fill="none"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: `transform 0.34s ${RAIL.spring}`,
      }}
    >
      <path
        d="M10 2L2 10L10 18"
        stroke="#fff"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RightIslandMenu({
  mode,
  onSelect,
}: {
  mode: string;
  onSelect: (m: "text" | "drawing" | "sticker" | "filter" | "adjust") => void;
}) {
  const [open, setOpen] = useState(false);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  return (
    <>
      {/* Click-outside overlay (only while open) */}
      {open ? (
        <div
          className="fixed inset-0 z-[89]"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* Container ([indicator][panel]) translates as one, vertically centered */}
      <div
        className="absolute right-0 top-1/2 z-[90] flex flex-row items-stretch"
        style={{
          transform: `translate(${open ? 0 : RAIL.panelW}px, -50%)`,
          transition: `transform 0.34s ${RAIL.spring}`,
        }}
      >
        {/* Indicator tab — flush to the panel's left edge */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close tools" : "Open tools"}
          className="flex items-center justify-center self-center active:scale-95"
          style={{
            width: RAIL.indicatorW,
            height: RAIL.indicatorH,
            background: RAIL.indicator,
            borderTopLeftRadius: 14,
            borderBottomLeftRadius: 14,
            boxShadow: "-2px 0 10px rgba(255,91,252,0.35)",
          }}
        >
          <RailArrow open={open} />
        </button>

        {/* Panel */}
        <nav
          className="flex flex-col"
          style={{
            width: RAIL.panelW,
            background: RAIL.bg,
            borderTopLeftRadius: 20,
            borderBottomLeftRadius: 20,
            paddingTop: 16,
            paddingBottom: 16,
            border: `1px solid ${RAIL.border}`,
            borderRight: "none",
            boxShadow: "-4px 0 16px rgba(0,0,0,0.5)",
          }}
        >
          {/* Undo / Redo row (top) */}
          <div
            className="flex flex-row items-center justify-center gap-4"
            style={{
              height: RAIL.optionH,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <button
              onClick={() => useEditorStore.getState().undo()}
              disabled={!canUndo}
              aria-label="Undo"
              className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-95"
              style={{ background: "rgba(255,255,255,0.08)", opacity: canUndo ? 1 : 0.25 }}
            >
              <Undo2 size={18} color={RAIL.activeIcon} strokeWidth={2} />
            </button>
            <button
              onClick={() => useEditorStore.getState().redo()}
              disabled={!canRedo}
              aria-label="Redo"
              className="w-10 h-10 rounded-xl flex items-center justify-center active:scale-95"
              style={{ background: "rgba(255,255,255,0.08)", opacity: canRedo ? 1 : 0.25 }}
            >
              <Redo2 size={18} color={RAIL.activeIcon} strokeWidth={2} />
            </button>
          </div>

          {/* Tool options — icon above label, 72px tall */}
          {TOOLS.map((t) => {
            const isActive = mode === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  onSelect(t.id);
                  setOpen(false);
                }}
                aria-label={t.label}
                className="flex flex-col items-center justify-center gap-1"
                style={{
                  height: RAIL.optionH,
                  background: isActive ? RAIL.activeBg : "transparent",
                  borderLeft: `3px solid ${isActive ? RAIL.activeBar : "transparent"}`,
                }}
              >
                <t.Icon
                  size={22}
                  color={isActive ? RAIL.activeIcon : RAIL.text}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: isActive ? RAIL.activeIcon : RAIL.text }}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </>
  );
}

// ============================================================
// Selected element quick controls
// ============================================================

export function SelectionBar() {
  const selected = useSelectedElement();
  if (!selected) return null;
  const t = selected.transform;
  const set = (patch: Partial<typeof t>) =>
    useEditorStore
      .getState()
      .updateElement(selected.id, { transform: { ...t, ...patch } });

  return (
    <div
      className="mt-3 flex items-center gap-2 px-2 py-1.5 rounded-2xl"
      style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
    >
      <IconBtn label="Shrink" onClick={() => set({ scale: Math.max(0.3, t.scale - 0.1) })}>
        <Minus size={16} color="#fff" />
      </IconBtn>
      <IconBtn label="Grow" onClick={() => set({ scale: Math.min(4, t.scale + 0.1) })}>
        <Plus size={16} color="#fff" />
      </IconBtn>
      <IconBtn label="Rotate" onClick={() => set({ rotation: (t.rotation + 15) % 360 })}>
        <RotateCw size={16} color="#fff" />
      </IconBtn>
      <IconBtn
        label="Delete"
        onClick={() => useEditorStore.getState().removeElement(selected.id)}
      >
        <Trash2 size={16} color={DANGER} />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      {children}
    </button>
  );
}

// ============================================================
// Bottom tool panels (non-modal — canvas stays visible above)
// ============================================================

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 w-full max-w-3xl z-30 rounded-t-3xl"
      style={{
        bottom: 0,
        background: "#141414",
        borderTop: `1px solid ${HAIRLINE}`,
        paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        maxHeight: "48dvh",
        overflowY: "auto",
      }}
    >
      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button
          onClick={onClose ?? (() => useEditorStore.getState().setMode("idle"))}
          className="h-8 px-3 rounded-lg text-sm font-semibold"
          style={{ background: SURFACE }}
        >
          Done
        </button>
      </div>
      <div className="px-4 pb-2">{children}</div>
    </div>
  );
}

// ---- Text panel (full text v2) ----

export function TextPanel() {
  const selected = useSelectedElement();
  const el = selected && selected.type === "text" ? selected : null;

  const addText = () => {
    const editor = useEditorStore.getState();
    const id = editor.addTextElement({ content: "Tap to edit" });
    editor.selectElement(id);
  };

  if (!el) {
    return (
      <Panel title="Text">
        <button
          onClick={addText}
          className="w-full h-11 rounded-xl flex items-center justify-center gap-2 font-semibold"
          style={{ background: DEVIANT_GRADIENT, color: INK }}
        >
          <Type size={18} color={INK} /> Add text
        </button>
      </Panel>
    );
  }

  const update = (patch: Partial<TextElement>) =>
    useEditorStore.getState().updateElement(el.id, patch);

  return (
    <Panel title="Text">
      <textarea
        dir="ltr"
        value={el.content}
        onChange={(e) => update({ content: e.target.value })}
        rows={2}
        placeholder="Type something…"
        style={{ direction: "ltr", unicodeBidi: "plaintext" }}
        className="w-full resize-none rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-[#3FDCFF] mb-3"
      />

      {/* Colours */}
      <Label>Colour</Label>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {TEXT_COLORS.map((color) => {
          const active = el.color.toUpperCase() === color.toUpperCase();
          return (
            <button
              key={color}
              onClick={() => update({ color })}
              aria-label={`Text color ${color}`}
              className="w-8 h-8 rounded-lg active:scale-95"
              style={{
                backgroundColor: color,
                border: `${active ? 2 : 1}px solid ${active ? ACCENT : "rgba(255,255,255,0.2)"}`,
              }}
            />
          );
        })}
      </div>

      {/* Fonts */}
      <Label>Font</Label>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3">
        {TEXT_FONTS.map((f) => {
          const active = el.fontFamily === f.fontFamily;
          return (
            <button
              key={f.id}
              onClick={() => update({ fontFamily: f.fontFamily })}
              className="shrink-0 h-9 px-3 rounded-xl text-xs font-semibold"
              style={{
                background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                color: active ? ACCENT : "#fff",
                fontFamily: `"${f.fontFamily}", system-ui, sans-serif`,
              }}
            >
              {f.name}
            </button>
          );
        })}
      </div>

      {/* Styles */}
      <Label>Style</Label>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3">
        {TEXT_STYLE_PRESETS.map((p) => {
          const active = el.style === p.id;
          return (
            <button
              key={p.id}
              onClick={() =>
                update({
                  style: p.id,
                  backgroundColor: p.hasBackground
                    ? p.defaultBackgroundColor
                    : undefined,
                })
              }
              className="shrink-0 h-9 px-3 rounded-xl text-xs font-semibold"
              style={{
                background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                color: active ? ACCENT : "#fff",
              }}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Alignment */}
      <Label>Align</Label>
      <div className="flex items-center gap-2 mb-3">
        {(["left", "center", "right"] as const).map((align) => {
          const active = el.textAlign === align;
          return (
            <button
              key={align}
              onClick={() => update({ textAlign: align })}
              className="flex-1 h-9 rounded-xl text-xs font-semibold capitalize"
              style={{
                background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                color: active ? ACCENT : "#fff",
              }}
            >
              {align}
            </button>
          );
        })}
      </div>

      {/* Typography sliders */}
      <Slider
        label="Size"
        value={el.fontSize}
        min={40}
        max={320}
        onChange={(v) => update({ fontSize: v })}
      />
      <Slider
        label="Letter spacing"
        value={el.letterSpacing ?? 0}
        min={-5}
        max={30}
        onChange={(v) => update({ letterSpacing: v })}
      />
      <Slider
        label="Line height"
        value={Math.round((el.lineHeight ?? 1.2) * 100)}
        min={80}
        max={220}
        onChange={(v) => update({ lineHeight: v / 100 })}
      />
    </Panel>
  );
}

// ---- Drawing panel ----

const DRAW_TOOLS: { id: DrawingTool; Icon: typeof Pencil; label: string }[] = [
  { id: "pen", Icon: PenLine, label: "Pen" },
  { id: "marker", Icon: Brush, label: "Marker" },
  { id: "neon", Icon: Sparkles, label: "Neon" },
  { id: "highlighter", Icon: Highlighter, label: "Highlight" },
  { id: "eraser", Icon: Eraser, label: "Eraser" },
  { id: "arrow", Icon: ArrowRight, label: "Arrow" },
];

export function DrawingPanel() {
  const tool = useEditorStore((s) => s.drawingTool);
  const color = useEditorStore((s) => s.drawingColor);
  const strokeWidth = useEditorStore((s) => s.strokeWidth);
  const paths = useEditorStore((s) => s.drawingPaths);
  const cfg = DRAWING_TOOL_CONFIG[tool];

  return (
    <Panel title="Draw">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3">
        {DRAW_TOOLS.map((t) => {
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              onClick={() => useEditorStore.getState().setDrawingTool(t.id)}
              className="shrink-0 h-9 px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold"
              style={{
                background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                color: active ? ACCENT : "#fff",
              }}
            >
              <t.Icon size={15} color={active ? ACCENT : "#fff"} />
              {t.label}
            </button>
          );
        })}
      </div>

      <Slider
        label="Brush size"
        value={strokeWidth}
        min={cfg.minWidth}
        max={cfg.maxWidth}
        onChange={(v) => useEditorStore.getState().setStrokeWidth(v)}
      />

      <Label>Colour</Label>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-1">
        {DRAWING_COLORS.map((c) => {
          const active = color.toUpperCase() === c.toUpperCase();
          return (
            <button
              key={c}
              onClick={() => useEditorStore.getState().setDrawingColor(c)}
              aria-label={`Brush color ${c}`}
              className="shrink-0 w-8 h-8 rounded-lg active:scale-95"
              style={{
                backgroundColor: c,
                border: `${active ? 2 : 1}px solid ${active ? ACCENT : "rgba(255,255,255,0.2)"}`,
              }}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => useEditorStore.getState().undoLastPath()}
          disabled={paths.length === 0}
          className="flex-1 h-10 rounded-xl text-sm font-semibold disabled:opacity-40"
          style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
        >
          Undo stroke
        </button>
        <button
          onClick={() => useEditorStore.getState().clearDrawing()}
          disabled={paths.length === 0}
          className="flex-1 h-10 rounded-xl text-sm font-semibold disabled:opacity-40"
          style={{ background: SURFACE, border: `1px solid ${HAIRLINE}`, color: DANGER }}
        >
          Clear
        </button>
      </div>
    </Panel>
  );
}

// ---- Sticker panel (tabs + search) ----

type StickerTab = "dvnt-native" | "emoji" | string; // string = image pack id

const WS4_STICKERS: {
  id: string;
  label: string;
  category: StickerElement["category"];
  Icon: typeof Ticket;
  metadata: Record<string, string>;
}[] = [
  { id: "ws4-event", label: "Event", category: "location", Icon: Calendar, metadata: { kind: "event", eventId: "" } },
  { id: "ws4-going", label: "I'm going", category: "custom", Icon: Ticket, metadata: { kind: "ticket", eventId: "" } },
  { id: "ws4-mention", label: "@mention", category: "mention", Icon: AtSign, metadata: { kind: "mention", username: "" } },
  { id: "ws4-link", label: "Link", category: "link", Icon: LinkIcon, metadata: { kind: "link", url: "" } },
];

export function StickerPanel() {
  const activeTab = useEditorStore((s) => s.stickerActiveTab) as StickerTab;
  const setActiveTab = useEditorStore((s) => s.setStickerActiveTab);
  const query = useEditorStore((s) => s.stickerSearchQuery);
  const setQuery = useEditorStore((s) => s.setStickerSearchQuery);

  // Local UI ephemera (per the file's convention): which WS-4 "Tags" sticker is
  // currently being given a value via the inline sub-panel. null = show the grid.
  const [activeTag, setActiveTag] = useState<
    (typeof WS4_STICKERS)[number] | null
  >(null);

  const addSticker = (
    source: string,
    opts: {
      category: StickerElement["category"];
      assetId?: string;
      label?: string;
      metadata?: Record<string, string>;
      size?: number;
    },
  ) => {
    const editor = useEditorStore.getState();
    const id = editor.addStickerElement(source, {
      category: opts.category,
      assetId: opts.assetId,
      size: opts.size,
    });
    if (opts.label || opts.metadata) {
      editor.updateElement(id, { label: opts.label, metadata: opts.metadata });
    }
    editor.setMode("idle");
  };

  // Place a WS-4 sticker only once a real value is chosen. `label` is the pill
  // text the viewer shows; `metadata` carries the deep-link contract exactly as
  // ws4OverlayTarget (story-overlays-layer.web) reads it.
  const commitWs4 = (
    label: string,
    metadata: Record<string, string>,
    category: StickerElement["category"],
  ) => {
    addSticker(label, { category, label, metadata });
    setActiveTag(null);
  };

  const tabs: { id: StickerTab; label: string }[] = [
    // "Tags" = the WS-4 interactive stickers (event/ticket/mention/link);
    // the image pack below is the one actually named "DVNT" — don't collide.
    { id: "dvnt-native", label: "Tags" },
    ...IMAGE_STICKER_PACKS.map((p) => ({ id: p.id, label: p.name })),
    { id: "emoji", label: "Emoji" },
  ];

  const q = query.trim().toLowerCase();
  const imagePack = IMAGE_STICKER_PACKS.find((p) => p.id === activeTab);
  const emojis = EMOJI_STICKERS;

  return (
    <Panel title="Stickers">
      {/* Search + tabs — hidden while entering a WS-4 tag value so the inline
          picker owns the panel. */}
      {!activeTag && (
        <>
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 h-10 rounded-xl mb-3"
            style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
          >
            <Search size={16} color="rgba(255,255,255,0.5)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stickers…"
              className="flex-1 bg-transparent text-sm outline-none text-white"
            />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3">
            {tabs.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className="shrink-0 h-8 px-3 rounded-full text-xs font-semibold"
                  style={{
                    background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                    border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                    color: active ? ACCENT : "#fff",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* DVNT-native interactive stickers ("Tags") */}
      {activeTab === "dvnt-native" ? (
        activeTag ? (
          <Ws4ValuePanel
            tag={activeTag}
            onBack={() => setActiveTag(null)}
            onCommit={commitWs4}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {WS4_STICKERS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveTag(s)}
                className="flex items-center gap-2 h-11 px-3 rounded-xl text-sm font-semibold"
                style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
              >
                <s.Icon size={16} color={ACCENT} />
                {s.label}
              </button>
            ))}
          </div>
        )
      ) : imagePack ? (
        <div className="grid grid-cols-3 gap-2">
          {imagePack.stickers
            .filter((s) => (q ? s.label.toLowerCase().includes(q) : true))
            .map((s) => {
              const url = STICKER_WEB_URLS[s.id] ?? assetToUrl(s.source);
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    url &&
                    addSticker(url, { category: "custom", assetId: s.id })
                  }
                  className="aspect-square rounded-xl flex items-center justify-center p-2"
                  style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={s.label}
                      className="w-full h-full object-contain"
                      draggable={false}
                    />
                  ) : (
                    <span className="text-[10px] text-white/50">{s.label}</span>
                  )}
                </button>
              );
            })}
        </div>
      ) : (
        <div className="grid grid-cols-8 gap-1.5">
          {emojis.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              onClick={() => addSticker(emoji, { category: "emoji" })}
              className="aspect-square rounded-lg flex items-center justify-center text-2xl active:scale-90"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---- WS-4 "Tags" value-entry inline sub-panels ----
// Each populates the real metadata a WS-4 sticker deep-links on
// (ws4OverlayTarget in story-overlays-layer.web reads kind/eventId/username/url)
// and the pill `label` the viewer renders. No sticker is placed until a value
// is chosen — no more empty pills.

// Minimal view of the verified Event shape returned by useEventSearch /
// useMyEvents (id/title/image/date/location all present — see
// packages/app/lib/hooks/use-events.ts Event interface).
interface Ws4EventItem {
  id: string;
  title: string;
  image: string;
  date: string;
  location: string;
}

// Minimal view of a searchApi.searchUsers doc (id/username/avatar/name).
interface Ws4UserItem {
  id: string;
  username: string;
  avatar: string;
  name: string;
}

function Ws4EventPicker({ onPick }: { onPick: (e: Ws4EventItem) => void }) {
  const [q, setQ] = useState("");
  const term = q.trim();
  const searching = term.length >= 2;
  // useEventSearch is enabled only at length >= 2; before that, seed with the
  // host's own events (the common "I'm going" / promote case).
  const search = useEventSearch(term);
  const mine = useMyEvents();
  const events = ((searching ? search.data : mine.data) ?? []) as Ws4EventItem[];
  const loading = searching ? search.isLoading : mine.isLoading;

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 h-10 rounded-xl mb-3"
        style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
      >
        <Search size={16} color="rgba(255,255,255,0.5)" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search events…"
          autoFocus
          className="flex-1 bg-transparent text-sm outline-none text-white"
        />
      </div>
      {!searching ? <Label>Your events</Label> : null}
      {loading ? (
        <p className="text-sm text-white/50 py-4 text-center">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-white/50 py-4 text-center">
          {searching ? "No events found" : "No events yet — type to search"}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {events.map((ev) => (
            <button
              key={ev.id}
              onClick={() => onPick(ev)}
              className="flex items-center gap-3 h-14 px-2 rounded-xl text-left"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              {ev.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ev.image}
                  alt=""
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                  draggable={false}
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-lg shrink-0"
                  style={{ background: DEVIANT_GRADIENT }}
                />
              )}
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-white truncate">
                  {ev.title}
                </span>
                <span className="text-[11px] text-white/50 truncate">
                  {[ev.date, ev.location].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Ws4MentionPicker({ onPick }: { onPick: (u: Ws4UserItem) => void }) {
  const [q, setQ] = useState("");
  const term = q.trim();
  const users = useQuery({
    queryKey: ["ws4-user-search", term] as const,
    queryFn: () => searchApi.searchUsers(term, 20),
    enabled: term.length >= 1,
  });
  const docs = (users.data?.docs ?? []) as Ws4UserItem[];

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 h-10 rounded-xl mb-3"
        style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
      >
        <AtSign size={16} color="rgba(255,255,255,0.5)" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people…"
          autoFocus
          className="flex-1 bg-transparent text-sm outline-none text-white"
        />
      </div>
      {users.isLoading ? (
        <p className="text-sm text-white/50 py-4 text-center">Loading…</p>
      ) : term.length < 1 ? (
        <p className="text-sm text-white/50 py-4 text-center">
          Type a username to search
        </p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-white/50 py-4 text-center">No people found</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {docs.map((u) => (
            <button
              key={u.id}
              onClick={() => onPick(u)}
              className="flex items-center gap-3 h-14 px-2 rounded-xl text-left"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              {u.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={u.avatar}
                  alt=""
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                  draggable={false}
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center"
                  style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
                >
                  <AtSign size={16} color="rgba(255,255,255,0.5)" />
                </div>
              )}
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-white truncate">
                  @{u.username}
                </span>
                {u.name ? (
                  <span className="text-[11px] text-white/50 truncate">
                    {u.name}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// http(s)-only; prepend https:// when the user omits a scheme; reject anything
// that isn't a valid http/https URL.
function normalizeWs4Url(raw: string): { url: string; host: string } | null {
  const t = raw.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { url: u.toString(), host: u.hostname };
  } catch {
    return null;
  }
}

function Ws4LinkPicker({
  onPick,
}: {
  onPick: (url: string, host: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const parsed = normalizeWs4Url(raw);
  return (
    <div>
      <Label>Link URL</Label>
      <div
        className="flex items-center gap-2 px-3 h-11 rounded-xl mb-2"
        style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
      >
        <LinkIcon size={16} color="rgba(255,255,255,0.5)" />
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="example.com/tickets"
          autoFocus
          inputMode="url"
          className="flex-1 bg-transparent text-sm outline-none text-white"
        />
      </div>
      {raw.trim() && !parsed ? (
        <p className="text-[11px] mb-2" style={{ color: DANGER }}>
          Enter a valid http(s) link
        </p>
      ) : null}
      <button
        disabled={!parsed}
        onClick={() => parsed && onPick(parsed.url, parsed.host)}
        className="w-full h-11 rounded-xl flex items-center justify-center gap-2 font-semibold disabled:opacity-40"
        style={{ background: DEVIANT_GRADIENT, color: INK }}
      >
        <Check size={18} color={INK} /> Add link
      </button>
      {parsed ? (
        <p className="text-[11px] text-white/50 mt-2 text-center">
          Pill shows: {parsed.host}
        </p>
      ) : null}
    </div>
  );
}

function Ws4ValuePanel({
  tag,
  onBack,
  onCommit,
}: {
  tag: (typeof WS4_STICKERS)[number];
  onBack: () => void;
  onCommit: (
    label: string,
    metadata: Record<string, string>,
    category: StickerElement["category"],
  ) => void;
}) {
  const kind = tag.metadata.kind;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-95"
          style={{ background: SURFACE }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <span className="text-sm font-semibold text-white flex items-center gap-1.5">
          <tag.Icon size={15} color={ACCENT} /> {tag.label}
        </span>
      </div>
      {kind === "event" || kind === "ticket" ? (
        <Ws4EventPicker
          onPick={(ev) =>
            onCommit(ev.title, { kind, eventId: ev.id }, tag.category)
          }
        />
      ) : kind === "mention" ? (
        <Ws4MentionPicker
          onPick={(u) =>
            onCommit(
              `@${u.username}`,
              { kind: "mention", username: u.username },
              tag.category,
            )
          }
        />
      ) : (
        <Ws4LinkPicker
          onPick={(url, host) =>
            onCommit(host, { kind: "link", url }, tag.category)
          }
        />
      )}
    </div>
  );
}

// ---- Filter panel (LUT + effects) ----

export function FilterPanel({ mediaUri }: { mediaUri: string }) {
  const mainTab = useEditorStore((s) => s.filterMainTab);
  const setMainTab = useEditorStore((s) => s.setFilterMainTab);
  const effectCategory = useEditorStore((s) => s.filterEffectCategory);
  const setEffectCategory = useEditorStore((s) => s.setFilterEffectCategory);
  const currentFilter = useEditorStore((s) => s.currentFilter);
  const selectedEffectId = useEditorStore((s) => s.selectedEffectId);

  const categories = Array.from(new Set(EFFECT_FILTERS.map((e) => e.category)));
  const effects = EFFECT_FILTERS.filter((e) => e.category === effectCategory);

  const pickFilter = (f: LUTFilter) => {
    useEditorStore.getState().setFilter(f);
    useEditorStore.getState().setSelectedEffectId(null);
  };
  const pickEffect = (e: EffectFilter) => {
    // EffectFilter matches the LUTFilter shape (id/name/matrix/intensity).
    useEditorStore.getState().setFilter({
      id: e.id,
      name: e.name,
      matrix: e.matrix,
      intensity: e.intensity,
    });
    useEditorStore.getState().setSelectedEffectId(e.id);
  };

  return (
    <Panel title="Effects">
      <div className="flex items-center gap-2 mb-3">
        {(["filters", "effects"] as const).map((t) => {
          const active = mainTab === t;
          return (
            <button
              key={t}
              onClick={() => setMainTab(t)}
              className="flex-1 h-9 rounded-xl text-xs font-semibold capitalize"
              style={{
                background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                color: active ? ACCENT : "#fff",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {mainTab === "effects" ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-3">
          {categories.map((c) => {
            const active = effectCategory === c;
            return (
              <button
                key={c}
                onClick={() => setEffectCategory(c)}
                className="shrink-0 h-8 px-3 rounded-full text-xs font-semibold capitalize"
                style={{
                  background: active ? "rgba(63,220,255,0.15)" : SURFACE,
                  border: `1px solid ${active ? ACCENT : HAIRLINE}`,
                  color: active ? ACCENT : "#fff",
                }}
              >
                {c}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-3 overflow-x-auto pb-2">
        {mainTab === "filters"
          ? LUT_FILTERS.map((f) => (
              <FilterThumb
                key={f.id}
                name={f.name}
                matrix={f.matrix}
                mediaUri={mediaUri}
                active={currentFilter?.id === f.id}
                onClick={() => pickFilter(f)}
              />
            ))
          : effects.map((e) => (
              <FilterThumb
                key={e.id}
                name={e.name}
                matrix={e.matrix}
                mediaUri={mediaUri}
                active={selectedEffectId === e.id}
                onClick={() => pickEffect(e)}
              />
            ))}
      </div>
    </Panel>
  );
}

function FilterThumb({
  name,
  matrix,
  mediaUri,
  active,
  onClick,
}: {
  name: string;
  matrix: number[];
  mediaUri: string;
  active: boolean;
  onClick: () => void;
}) {
  const filterId = `thumb-${name.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <button onClick={onClick} className="shrink-0 flex flex-col items-center gap-1">
      <svg aria-hidden width={0} height={0} style={{ position: "absolute" }}>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="matrix" values={matrix.join(" ")} />
        </filter>
      </svg>
      <div
        className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center"
        style={{
          background: SURFACE,
          border: `2px solid ${active ? ACCENT : "transparent"}`,
        }}
      >
        {mediaUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUri}
            alt={name}
            className="w-full h-full object-cover"
            style={{ filter: `url(#${filterId})` }}
            draggable={false}
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ background: DEVIANT_GRADIENT, filter: `url(#${filterId})` }}
          />
        )}
      </div>
      <span className="text-[10px] text-white/70">{name}</span>
    </button>
  );
}

// ---- Adjust panel ----

const ADJUSTMENTS: {
  key: keyof FilterAdjustment;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "temperature", label: "Warmth", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
  { key: "fade", label: "Fade", min: 0, max: 100 },
  { key: "vignette", label: "Vignette", min: 0, max: 100 },
];

export function AdjustPanel() {
  const adjustments = useEditorStore((s) => s.adjustments);
  return (
    <Panel title="Adjust">
      {ADJUSTMENTS.map((a) => (
        <Slider
          key={a.key}
          label={a.label}
          value={adjustments[a.key]}
          min={a.min}
          max={a.max}
          onChange={(v) =>
            useEditorStore.getState().setAdjustments({ [a.key]: v })
          }
        />
      ))}
      <button
        onClick={() => useEditorStore.getState().resetAdjustments()}
        className="w-full h-10 rounded-xl text-sm font-semibold mt-2"
        style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
      >
        Reset
      </button>
    </Panel>
  );
}

// ---- Background strip (text-only + no media) ----

export function BackgroundStrip() {
  const canvasBackground = useEditorStore((s) => s.canvasBackground);
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 w-full max-w-3xl z-20 px-4 py-3"
      style={{
        bottom: 0,
        background: "rgba(6,7,13,0.9)",
        borderTop: `1px solid ${HAIRLINE}`,
        paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)",
      }}
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        <Palette size={18} color="rgba(255,255,255,0.5)" className="shrink-0" />
        {STORY_BACKGROUNDS.map((bg) => {
          const active = canvasBackground === bg.id;
          return (
            <button
              key={bg.id}
              onClick={() => useEditorStore.getState().setCanvasBackground(bg.id)}
              aria-label={bg.id}
              className="shrink-0 w-9 h-9 rounded-xl active:scale-95"
              style={{
                ...backgroundToCss(bg),
                border: `2px solid ${active ? ACCENT : HAIRLINE}`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Small UI primitives
// ============================================================

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-white/45 uppercase tracking-wide mb-1.5">
      {children}
    </p>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-white/45 uppercase tracking-wide">
          {label}
        </span>
        <span className="text-[11px] text-white/60 tabular-nums">
          {Math.round(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#3FDCFF]"
      />
    </div>
  );
}

// ============================================================
// Export bake — flatten media + filter + vignette + drawing to a blob URL.
// This produces the SAME baked pixels native's makeImageSnapshot captures for
// drawing + filters. Text / stickers stay as overlays (the existing web
// contract). Returns null on failure (e.g. a cross-origin-tainted canvas) so
// the caller falls back to the raw media uri.
// ============================================================

export async function bakeFrame(opts: {
  mediaUri: string | null;
  background: string;
  filter: LUTFilter | null;
  adjustments: FilterAdjustment;
  drawingPaths: DrawingPath[];
}): Promise<string | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    if (opts.mediaUri) {
      const img = await loadImage(opts.mediaUri);
      // object-cover crop into 1080×1920.
      const scale = Math.max(CANVAS_WIDTH / img.width, CANVAS_HEIGHT / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (CANVAS_WIDTH - dw) / 2, (CANVAS_HEIGHT - dh) / 2, dw, dh);
      // Bake colour matrix (LUT + adjustments) per-pixel for exact parity.
      if (hasVisibleColorMatrix(opts.filter, opts.adjustments)) {
        applyColorMatrix(ctx, combinedColorMatrix(opts.filter, opts.adjustments));
      }
    } else {
      // Text-only background.
      const bg = STORY_BACKGROUNDS.find((b) => b.id === opts.background);
      paintBackground(ctx, bg);
    }

    // Vignette (matches the live overlay).
    if (opts.adjustments.vignette !== 0) {
      const v = (opts.adjustments.vignette / 100) * 0.85;
      const grad = ctx.createRadialGradient(
        CANVAS_WIDTH / 2,
        CANVAS_HEIGHT / 2,
        CANVAS_WIDTH * 0.28,
        CANVAS_WIDTH / 2,
        CANVAS_HEIGHT / 2,
        CANVAS_HEIGHT * 0.62,
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${v})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Drawing strokes (in canvas coords already).
    for (const p of opts.drawingPaths) drawStroke(ctx, p);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn("[story-editor.web] bakeFrame failed, using raw media:", err);
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  bg?: StoryBackground,
) {
  if (!bg) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    return;
  }
  if (bg.type === "solid") {
    ctx.fillStyle = bg.color ?? "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    return;
  }
  const angle = ((bg.angle ?? 180) * Math.PI) / 180;
  const x = Math.cos(angle - Math.PI / 2);
  const y = Math.sin(angle - Math.PI / 2);
  const grad = ctx.createLinearGradient(
    CANVAS_WIDTH / 2 - (x * CANVAS_WIDTH) / 2,
    CANVAS_HEIGHT / 2 - (y * CANVAS_HEIGHT) / 2,
    CANVAS_WIDTH / 2 + (x * CANVAS_WIDTH) / 2,
    CANVAS_HEIGHT / 2 + (y * CANVAS_HEIGHT) / 2,
  );
  const colors = bg.colors ?? ["#000", "#000"];
  colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

function applyColorMatrix(ctx: CanvasRenderingContext2D, m: number[]) {
  const img = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const a = d[i + 3] / 255;
    const nr = m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4];
    const ng = m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9];
    const nb = m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14];
    const na = m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19];
    d[i] = Math.max(0, Math.min(255, nr * 255));
    d[i + 1] = Math.max(0, Math.min(255, ng * 255));
    d[i + 2] = Math.max(0, Math.min(255, nb * 255));
    d[i + 3] = Math.max(0, Math.min(255, na * 255));
  }
  ctx.putImageData(img, 0, 0);
}
