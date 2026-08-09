"use client";

/**
 * Story overlay editor — WEB variant (feature-parity with the native editor).
 *
 * Native source of truth: app/(protected)/story/editor.tsx + src/stories-editor
 * (Skia canvas + gesture-handler + reanimated). Those native-graphics libs can't
 * run on web, so this is a SEPARATE browser-native implementation that drives the
 * SAME Zustand stores the native editor uses:
 *   - useEditorStore  (features/stories-editor/stores/editor-store) — media +
 *     elements + drawing + filters + adjustments + backgrounds + tool UI state
 *   - useStoryFlowStore — the story-creation state machine
 *   - useStoryEditorResultStore — the hand-off back to story/create
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
import { useRouter, useSearchParams } from "solito/navigation";
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
  ChevronLeft,
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
  TextElement,
  StickerElement,
  DrawingPath,
  DrawingTool,
  FilterAdjustment,
  LUTFilter,
  Position,
  TextStylePreset,
} from "@dvnt/app/features/stories-editor/types";
import { useStoryFlowStore } from "@dvnt/app/lib/stores/story-flow-store";
import { useStoryEditorResultStore } from "@dvnt/app/lib/stores/story-editor-result-store";
import type {
  StoryOverlay,
  StoryAnimatedGifOverlay,
} from "@dvnt/app/lib/types";

// ── Brand tokens (docs/dvnt-design-system.md) ───────────────────────────
const INK = "#06070d";
const ACCENT = "#3FDCFF"; // cyan — primary accent
const DANGER = "#FC253A";
const DEVIANT_GRADIENT =
  "linear-gradient(100deg, #3FDCFF 0%, #8A40CF 52%, #FF5BFC 100%)";
const SURFACE = "rgba(255,255,255,0.06)";
const HAIRLINE = "rgba(255,255,255,0.10)";

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
// from apps/web/public/stickers/ and resolve by sticker id. Keep in sync with
// IMAGE_STICKER_PACKS (packages/app/features/stories-editor/constants).
const STICKER_WEB_URLS: Record<string, string> = {
  "dvnt-app": "/stickers/dvnt/DVNT-stickers_APP.png",
  "dvnt-afterhours": "/stickers/dvnt/DVNT-stickers_AfterHours.png",
  "dvnt-counterculture": "/stickers/dvnt/DVNT-stickers_CounterCulture.png",
  "dvnt-dayplay": "/stickers/dvnt/DVNT-stickers_DAYPLAY.png",
  "dvnt-deviant": "/stickers/dvnt/DVNT-stickers_Deviant.png",
  "dvnt-energycheck": "/stickers/dvnt/DVNT-stickers_EnergyCheck.png",
  "dvnt-ftc": "/stickers/dvnt/DVNT-stickers_FTC.png",
  "dvnt-outside": "/stickers/dvnt/DVNT-stickers_OUTSIDE.png",
  "dvnt-eatit": "/stickers/dvnt/eat-it.png",
  "ballroom-chop": "/stickers/ballroom/1-chop.png",
  "ballroom-serve1": "/stickers/ballroom/serve.png",
  "ballroom-serve2": "/stickers/ballroom/category-is.png",
  "ballroom-ate": "/stickers/ballroom/ate-that.png",
  "ballroom-tea": "/stickers/ballroom/tea.png",
};

// ============================================================
// Filter → CSS string for LIVE preview via feColorMatrix + vignette handled
// separately as an overlay (matches native's separate vignette layer).
// ============================================================

const LUT_FILTER_ID = "dvnt-story-lut";

// ============================================================
// Screen
// ============================================================

export function StoryEditorScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const uriParam = searchParams?.get("uri") ?? "";
  const typeParam = searchParams?.get("type") ?? "image";
  const initialMode = searchParams?.get("initialMode") ?? undefined;
  const indexParam = searchParams?.get("index") ?? "0";

  const mediaUri = uriParam ? decodeURIComponent(uriParam) : "";
  const mediaType: "image" | "video" =
    typeParam === "video" ? "video" : "image";

  // Editor store (the EXACT zustand store native uses).
  const elements = useEditorStore((s) => s.elements);
  const mode = useEditorStore((s) => s.mode);
  const storeMediaUri = useEditorStore((s) => s.mediaUri);
  const currentFilter = useEditorStore((s) => s.currentFilter);
  const adjustments = useEditorStore((s) => s.adjustments);
  const canvasBackground = useEditorStore((s) => s.canvasBackground);
  const undoStack = useEditorStore((s) => s.undoStack);
  const selected = useSelectedElement();

  const stageRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const textOnly = initialMode === "text";

  // [REGRESSION LOCK parity] Reset editor on mount, then seed media — clean
  // slate every session, same guarantee the native useLayoutEffect provides.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    const editor = useEditorStore.getState();
    editor.resetEditor();
    if (mediaUri) editor.setMedia(mediaUri, mediaType);
    if (initialMode === "text") editor.setTextOnlyMode(true);
  }, [mediaUri, mediaType, initialMode]);

  // Drive the story-flow state machine to the right editing state, mirroring
  // native (HUB → EDIT_IMAGE / EDIT_VIDEO / TEXT_ONLY).
  useEffect(() => {
    const targetState =
      initialMode === "text"
        ? "TEXT_ONLY"
        : mediaType === "video"
          ? "EDIT_VIDEO"
          : "EDIT_IMAGE";
    const flow = useStoryFlowStore.getState();
    if (flow.state === targetState) return;
    if (flow.state !== "HUB") {
      flow.forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
    }
    useStoryFlowStore.getState().transitionTo(targetState);
  }, [initialMode, mediaType]);

  const handleClose = () => {
    useStoryFlowStore.getState().transitionTo("HUB");
    router.back();
    setTimeout(() => useEditorStore.getState().resetEditor(), 350);
  };

  const handleDone = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const editor = useEditorStore.getState();
      const rawUri = editor.mediaUri ?? mediaUri;

      // Build overlays (text / emoji / image-sticker / ws4). Drawing + filters
      // are NOT overlays — they are baked into the frame below (native parity).
      const storyOverlays: StoryOverlay[] = [];
      const animatedGifOverlays: StoryAnimatedGifOverlay[] = [];
      for (const el of editor.elements) {
        if (el.type === "text") {
          storyOverlays.push(textElementToOverlay(el));
        } else if (el.type === "sticker") {
          if (isGif(el)) animatedGifOverlays.push(gifStickerToAnimatedOverlay(el));
          else if (isWs4(el)) storyOverlays.push(ws4StickerToOverlay(el));
          else storyOverlays.push(stickerElementToOverlay(el));
        }
      }

      // Bake media + filter + vignette + drawing into a flattened frame, the
      // same pixels native's makeImageSnapshot captures. Only for image / text
      // -only; video can't be re-encoded in-browser without heavy deps.
      let outUri = rawUri;
      const needsBake =
        editor.drawingPaths.length > 0 ||
        hasVisibleColorMatrix(editor.currentFilter, editor.adjustments) ||
        editor.adjustments.vignette !== 0 ||
        (textOnly && true);
      if (mediaType === "image" && needsBake) {
        const baked = await bakeFrame({
          mediaUri: textOnly ? null : rawUri,
          background: editor.canvasBackground,
          filter: editor.currentFilter,
          adjustments: editor.adjustments,
          drawingPaths: editor.drawingPaths,
        });
        if (baked) outUri = baked;
      }

      useStoryEditorResultStore.getState().setResult({
        uri: outUri || rawUri,
        index: Number.parseInt(indexParam, 10) || 0,
        mediaType,
        storyOverlays,
        animatedGifOverlays,
      });
      useStoryFlowStore.getState().transitionTo("HUB");
      router.push("/feed/story/create");
      setTimeout(() => useEditorStore.getState().resetEditor(), 300);
    } finally {
      setExporting(false);
    }
  };

  const resolvedMedia = storeMediaUri || mediaUri;
  const matrix = combinedColorMatrix(currentFilter, adjustments);
  const matrixValues = matrix.join(" ");
  const applyMatrix = hasVisibleColorMatrix(currentFilter, adjustments);

  // Persistent tool tabs (the RightIslandMenu nav anchor).
  const setMode = useEditorStore((s) => s.setMode);
  const toggleMode = (m: typeof mode) => setMode(mode === m ? "idle" : m);

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col text-white select-none"
      style={{ background: INK }}
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

      {/* Top bar — close / title / Share(Done). Matches Create Story chrome. */}
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
          aria-label="Close editor"
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95"
          style={{ background: SURFACE }}
        >
          <X size={18} color="#fff" />
        </button>
        <h1 className="text-[17px] font-semibold">Edit story</h1>
        <button
          onClick={handleDone}
          disabled={exporting}
          aria-label="Done"
          className="h-9 px-5 rounded-xl flex items-center gap-1.5 font-semibold text-black active:scale-95 disabled:opacity-60"
          style={{ background: DEVIANT_GRADIENT }}
        >
          <Check size={16} color={INK} strokeWidth={3} />
          {exporting ? "Saving…" : "Share"}
        </button>
      </header>

      {/* Stage + right island menu + tool panels */}
      <main className="flex-1 flex flex-col items-center px-3 py-4">
        <div className="relative flex items-start justify-center w-full">
          <EditorStage
            stageRef={stageRef}
            mediaUri={resolvedMedia}
            mediaType={mediaType}
            textOnly={textOnly}
            background={canvasBackground}
            applyMatrix={applyMatrix}
            vignette={adjustments.vignette}
          />

          {/* Right island menu — persistent nav anchor across tool modes */}
          <RightIslandMenu mode={mode} onSelect={toggleMode} />
        </div>

        {/* Selected-element quick controls (scale / rotate / delete) */}
        {selected ? <SelectionBar /> : null}

        <p className="text-white/40 text-xs text-center max-w-xs mt-3">
          {elements.length === 0
            ? "Pick a tool on the right, then Share when you're done."
            : `${elements.length} overlay${elements.length === 1 ? "" : "s"} · drag to reposition`}
        </p>
      </main>

      {/* Non-modal tool panels — canvas stays visible above them. */}
      {mode === "text" ? <TextPanel /> : null}
      {mode === "drawing" ? <DrawingPanel /> : null}
      {mode === "sticker" ? <StickerPanel /> : null}
      {mode === "filter" ? <FilterPanel mediaUri={resolvedMedia} /> : null}
      {mode === "adjust" ? <AdjustPanel /> : null}
      {(mode === "idle" || textOnly) && !resolvedMedia ? (
        <BackgroundStrip />
      ) : null}

      {/* Undo/Redo now live inside the RightIslandMenu rail (v1 parity). */}
    </div>
  );
}

export default StoryEditorScreen;

// ============================================================
// Stage (the 9:16 canvas)
// ============================================================

function EditorStage({
  stageRef,
  mediaUri,
  mediaType,
  textOnly,
  background,
  applyMatrix,
  vignette,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  mediaUri: string;
  mediaType: "image" | "video";
  textOnly: boolean;
  background: string;
  applyMatrix: boolean;
  vignette: number;
}) {
  const elements = useEditorStore((s) => s.elements);
  const selectedId = useEditorStore((s) => s.selectedElementId);
  const mode = useEditorStore((s) => s.mode);

  const bg = STORY_BACKGROUNDS.find((b) => b.id === background);
  const bgStyle = backgroundToCss(bg);
  const mediaFilter = applyMatrix ? `url(#${LUT_FILTER_ID})` : undefined;

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
) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
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
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
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
  const drag = useDrag(element, stageRef);
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

// v1-mobile Dynamic-Island rail drawer: a magenta indicator tab flush on the
// right edge that slides the tool buttons (+ undo/redo) in/out. Tap the tab to
// toggle, tap a tool to select + collapse (the sheet opens below), tap outside
// to close. CSS-transition slide (no reanimated on web); spring feel via the
// same cubic-bezier the landing header uses. Buttons live in the drawer, per v1.
const RAIL_INDICATOR = "#FF5BFC";
function RightIslandMenu({
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
      {/* Click-outside scrim (only while open) */}
      {open ? (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="absolute right-0 top-1/2 z-20 flex items-center -translate-y-1/2">
        {/* Sliding panel — the drawer where the buttons live */}
        <nav
          className="flex flex-col gap-1.5 p-2 mr-1 rounded-2xl"
          style={{
            background: "rgba(0,0,0,0.72)",
            border: `1px solid ${HAIRLINE}`,
            backdropFilter: "blur(10px)",
            transform: open ? "translateX(0)" : "translateX(130%)",
            opacity: open ? 1 : 0,
            pointerEvents: open ? "auto" : "none",
            transition:
              "transform 0.34s cubic-bezier(0.22,1,0.36,1), opacity 0.2s ease",
          }}
        >
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
                title={t.label}
                className="flex items-center gap-2 h-10 pl-2 pr-3 rounded-xl active:scale-95"
                style={{ background: isActive ? DEVIANT_GRADIENT : SURFACE }}
              >
                <t.Icon size={18} color={isActive ? INK : "#fff"} />
                <span
                  className="text-xs font-semibold"
                  style={{ color: isActive ? INK : "#fff" }}
                >
                  {t.label}
                </span>
              </button>
            );
          })}

          {/* Undo / Redo live in the rail, like v1 */}
          <div className="flex gap-1.5 mt-1 pt-2" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
            <button
              onClick={() => useEditorStore.getState().undo()}
              disabled={!canUndo}
              aria-label="Undo"
              title="Undo"
              className="flex-1 h-9 rounded-xl flex items-center justify-center active:scale-95"
              style={{ background: SURFACE, opacity: canUndo ? 1 : 0.35 }}
            >
              <Undo2 size={16} color="#fff" />
            </button>
            <button
              onClick={() => useEditorStore.getState().redo()}
              disabled={!canRedo}
              aria-label="Redo"
              title="Redo"
              className="flex-1 h-9 rounded-xl flex items-center justify-center active:scale-95"
              style={{ background: SURFACE, opacity: canRedo ? 1 : 0.35 }}
            >
              <Redo2 size={16} color="#fff" />
            </button>
          </div>
        </nav>

        {/* Indicator tab — always visible, flush to the right edge */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close tools" : "Open tools"}
          className="flex items-center justify-center rounded-l-2xl active:scale-95"
          style={{
            width: 26,
            height: 100,
            background: RAIL_INDICATOR,
            boxShadow: "0 4px 20px rgba(255,91,252,0.35)",
          }}
        >
          <ChevronLeft
            size={18}
            color={INK}
            style={{
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.34s cubic-bezier(0.22,1,0.36,1)",
            }}
          />
        </button>
      </div>
    </>
  );
}

// ============================================================
// Selected element quick controls
// ============================================================

function SelectionBar() {
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
      className="fixed left-0 right-0 z-30 rounded-t-3xl"
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

function TextPanel() {
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

function DrawingPanel() {
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

function StickerPanel() {
  const activeTab = useEditorStore((s) => s.stickerActiveTab) as StickerTab;
  const setActiveTab = useEditorStore((s) => s.setStickerActiveTab);
  const query = useEditorStore((s) => s.stickerSearchQuery);
  const setQuery = useEditorStore((s) => s.setStickerSearchQuery);

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

      {/* DVNT-native interactive stickers */}
      {activeTab === "dvnt-native" ? (
        <div className="grid grid-cols-2 gap-2">
          {WS4_STICKERS.map((s) => (
            <button
              key={s.id}
              onClick={() =>
                addSticker(s.label, {
                  category: s.category,
                  label: s.label,
                  metadata: s.metadata,
                })
              }
              className="flex items-center gap-2 h-11 px-3 rounded-xl text-sm font-semibold"
              style={{ background: SURFACE, border: `1px solid ${HAIRLINE}` }}
            >
              <s.Icon size={16} color={ACCENT} />
              {s.label}
            </button>
          ))}
        </div>
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

// ---- Filter panel (LUT + effects) ----

function FilterPanel({ mediaUri }: { mediaUri: string }) {
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

function AdjustPanel() {
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

function BackgroundStrip() {
  const canvasBackground = useEditorStore((s) => s.canvasBackground);
  return (
    <div
      className="fixed left-0 right-0 z-20 px-4 py-3"
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

async function bakeFrame(opts: {
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
