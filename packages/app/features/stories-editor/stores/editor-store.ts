// ============================================================
// Stories Editor - Zustand Store
// ============================================================
// Replaces useReducer-based state. Persists across navigations
// so stickers/drawings/text survive going back and re-entering.
// ============================================================

import { create } from "zustand";
import {
  EditorState,
  EditorMode,
  CanvasElement,
  TextElement,
  StickerElement,
  StickerInsertOptions,
  DrawingPath,
  DrawingTool,
  LUTFilter,
  FilterAdjustment,
  TextStylePreset,
  TextEditorTab,
  FilterMainTab,
  ExportSession,
  ExportArtifact,
  ExportStatus,
} from "../types";
import {
  DEFAULT_ADJUSTMENTS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  DEFAULT_TEXT_FONT_SIZE,
  MIN_TEXT_FONT_SIZE,
  DRAWING_COLORS,
  DRAWING_TOOL_CONFIG,
} from "../constants";
import { generateId, getNextZIndex } from "../utils/helpers";

// Default sticker size: ~26% of canvas width (280px on 1080w)
const DEFAULT_STICKER_SIZE = Math.round(CANVAS_WIDTH * 0.26);

// ---- Store Interface ----

interface EditorStore extends EditorState {
  // Mode
  setMode: (mode: EditorMode) => void;
  // Media
  setMedia: (uri: string, mediaType: "image" | "video") => void;
  // Elements
  addTextElement: (options?: Partial<TextElement>) => string;
  addStickerElement: (
    source: string | number,
    options?: StickerInsertOptions,
  ) => string;
  updateElement: (id: string, updates: Partial<CanvasElement>) => void;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  // Drawing
  addDrawingPath: (path: DrawingPath) => void;
  undoLastPath: () => void;
  clearDrawing: () => void;
  setDrawingTool: (tool: DrawingTool) => void;
  setDrawingColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  // Filters
  setFilter: (filter: LUTFilter | null) => void;
  setAdjustments: (adjustments: Partial<FilterAdjustment>) => void;
  resetAdjustments: () => void;
  setSelectedEffectId: (id: string | null) => void;
  setFilterMainTab: (tab: FilterMainTab) => void;
  setFilterEffectCategory: (category: string) => void;
  // Sticker UI
  setStickerActiveTab: (tab: string) => void;
  setStickerSearchQuery: (query: string) => void;
  // Text Editor UI
  setTextEditorTab: (tab: TextEditorTab) => void;
  setTextEditContent: (content: string) => void;
  setTextEditFont: (font: string) => void;
  setTextEditColor: (color: string) => void;
  setTextEditStyle: (style: string) => void;
  setTextEditAlign: (align: "left" | "center" | "right") => void;
  setTextEditFontSize: (size: number) => void;
  setTextEditLetterSpacing: (spacing: number) => void;
  setTextEditLineHeight: (lh: number) => void;
  setTextEditElementId: (id: string | null) => void;
  initTextEdit: (
    element?: {
      content?: string;
      fontFamily?: string;
      color?: string;
      style?: string;
      textAlign?: string;
      fontSize?: number;
      letterSpacing?: number;
      lineHeight?: number;
      id?: string;
    } | null,
  ) => void;
  // Text-only mode
  setTextOnlyMode: (enabled: boolean) => void;
  // Canvas background
  setCanvasBackground: (id: string) => void;
  // Drawing color picker
  toggleDrawingColorPicker: () => void;
  // Debug
  setShowPerfHUD: (show: boolean) => void;
  // Export session
  exportSession: ExportSession;
  setExportStatus: (status: ExportStatus) => void;
  setExportArtifact: (artifact: ExportArtifact | null) => void;
  setExportError: (error: string) => void;
  clearExport: () => void;
  // Video
  setVideoTime: (time: number) => void;
  setVideoDuration: (duration: number) => void;
  togglePlay: () => void;
  // History
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  // Reset (for new editing sessions)
  resetEditor: () => void;
}

// All element positions are in canvas coordinates (1080×1920).
// The Skia Canvas scales them to display size via a root Group transform.

// ---- Initial State (data only) ----

const initialEditorData: EditorState = {
  mode: "idle",
  elements: [],
  selectedElementId: null,
  drawingPaths: [],
  currentFilter: null,
  adjustments: DEFAULT_ADJUSTMENTS,
  mediaUri: null,
  mediaType: "image",
  videoDuration: 0,
  videoCurrentTime: 0,
  isPlaying: false,
  canvasSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  undoStack: [],
  redoStack: [],
  // Drawing UI
  drawingTool: "pen",
  drawingColor: DRAWING_COLORS[0],
  strokeWidth: DRAWING_TOOL_CONFIG.pen.defaultWidth,
  // Filter/Effect UI
  selectedEffectId: null,
  filterMainTab: "filters",
  filterEffectCategory: "film",
  // Sticker UI
  stickerActiveTab: "dvnt",
  stickerSearchQuery: "",
  // Text Editor UI
  textEditorTab: "style",
  textEditContent: "",
  textEditFont: "Inter-Regular",
  textEditColor: "#FFFFFF",
  textEditStyle: "classic" as const,
  textEditAlign: "center" as const,
  textEditFontSize: DEFAULT_TEXT_FONT_SIZE,
  textEditLetterSpacing: 0,
  textEditLineHeight: 1.25,
  textEditElementId: null,
  // Text-only stories
  textOnlyMode: false,
  // Canvas background
  canvasBackground: "black",
  // Drawing color picker
  showDrawingColorPicker: false,
  // Debug
  showPerfHUD: false,
};

// ---- Store ----

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialEditorData,

  // ---- Mode ----
  setMode: (mode) => {
    if (__DEV__) {
      console.log(
        `[Store] setMode "${mode}" elements=${get().elements.length} selected=${get().selectedElementId?.slice(0, 6) ?? "null"}`,
      );
    }
    set({
      mode,
      selectedElementId: mode === "drawing" ? null : get().selectedElementId,
    });
  },

  // ---- Media ----
  setMedia: (uri, mediaType) => set({ mediaUri: uri, mediaType }),

  // ---- Elements ----
  addTextElement: (options) => {
    const id = generateId();
    const element: TextElement = {
      id,
      type: "text",
      content: "Tap to edit",
      fontFamily: "Inter-Regular",
      fontSize: DEFAULT_TEXT_FONT_SIZE, // Canvas units (70 for 1080w)
      color: "#FFFFFF",
      textAlign: "center",
      style: "classic" as TextStylePreset,
      maxWidth: CANVAS_WIDTH * 0.8,
      opacity: 1,
      zIndex: getNextZIndex(get().elements),
      transform: {
        translateX: CANVAS_WIDTH / 2,
        translateY: CANVAS_HEIGHT / 2,
        scale: 1,
        rotation: 0,
      },
      ...options,
    };
    // Sanity check: if fontSize ended up below minimum, bump it
    if (element.fontSize < MIN_TEXT_FONT_SIZE) {
      if (__DEV__) {
        console.warn(
          `[Store] addTextElement: fontSize ${element.fontSize} < ${MIN_TEXT_FONT_SIZE} canvas units — bumping to default (${DEFAULT_TEXT_FONT_SIZE}). Check caller.`,
        );
      }
      element.fontSize = DEFAULT_TEXT_FONT_SIZE;
    }
    if (__DEV__) {
      console.log(
        `[Store] addTextElement id=${id.slice(0, 6)} content="${element.content.slice(0, 20)}" elements_before=${get().elements.length}`,
      );
    }
    set((s) => ({
      elements: [...s.elements, element],
      selectedElementId: null,
      undoStack: [
        ...s.undoStack,
        { elements: s.elements, drawingPaths: s.drawingPaths },
      ],
      redoStack: [],
    }));
    if (__DEV__) {
      console.log(
        `[Store] addTextElement DONE elements_after=${get().elements.length}`,
      );
    }
    return id;
  },

  addStickerElement: (source, options) => {
    const id = generateId();
    const size = options?.size ?? DEFAULT_STICKER_SIZE;
    const element: StickerElement = {
      id,
      type: "sticker",
      source,
      category: options?.category ?? "emoji",
      size,
      assetId: options?.assetId,
      opacity: 1,
      zIndex: getNextZIndex(get().elements),
      transform: {
        translateX: CANVAS_WIDTH / 2,
        translateY: CANVAS_HEIGHT / 2,
        scale: 1,
        rotation: 0,
      },
    };
    set((s) => ({
      elements: [...s.elements, element],
      selectedElementId: id,
      undoStack: [
        ...s.undoStack,
        { elements: s.elements, drawingPaths: s.drawingPaths },
      ],
      redoStack: [],
    }));
    return id;
  },

  updateElement: (id, updates) => {
    if (__DEV__ && (updates as any).content !== undefined) {
      console.log(
        `[Store] updateElement id=${id.slice(0, 6)} content="${String((updates as any).content).slice(0, 20)}"`,
      );
    }
    set((s) => ({
      elements: s.elements.map((el) =>
        el.id === id ? ({ ...el, ...updates } as CanvasElement) : el,
      ),
    }));
  },

  removeElement: (id) => {
    if (__DEV__) {
      const el = get().elements.find((e) => e.id === id);
      console.log(
        `[Store] removeElement id=${id.slice(0, 6)} type=${el?.type} elements_before=${get().elements.length}`,
      );
    }
    set((s) => ({
      elements: s.elements.filter((el) => el.id !== id),
      selectedElementId:
        s.selectedElementId === id ? null : s.selectedElementId,
      undoStack: [
        ...s.undoStack,
        { elements: s.elements, drawingPaths: s.drawingPaths },
      ],
      redoStack: [],
    }));
    if (__DEV__) {
      console.log(
        `[Store] removeElement DONE elements_after=${get().elements.length}`,
      );
    }
  },

  selectElement: (id) => set({ selectedElementId: id }),

  // ---- Drawing ----
  addDrawingPath: (path) =>
    set((s) => ({
      drawingPaths: [...s.drawingPaths, path],
      undoStack: [
        ...s.undoStack,
        { elements: s.elements, drawingPaths: s.drawingPaths },
      ],
      redoStack: [],
    })),

  undoLastPath: () =>
    set((s) => ({
      drawingPaths: s.drawingPaths.slice(0, -1),
    })),

  clearDrawing: () => set({ drawingPaths: [] }),
  setDrawingTool: (tool) =>
    set({
      drawingTool: tool,
      strokeWidth: DRAWING_TOOL_CONFIG[tool].defaultWidth,
    }),
  setDrawingColor: (color) => set({ drawingColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),

  // ---- Filters ----
  setFilter: (filter) => set({ currentFilter: filter }),

  setAdjustments: (adj) =>
    set((s) => ({
      adjustments: { ...s.adjustments, ...adj },
    })),

  resetAdjustments: () => set({ adjustments: DEFAULT_ADJUSTMENTS }),
  setSelectedEffectId: (id) => set({ selectedEffectId: id }),
  setFilterMainTab: (tab) => set({ filterMainTab: tab }),
  setFilterEffectCategory: (category) =>
    set({ filterEffectCategory: category }),

  // ---- Sticker UI ----
  setStickerActiveTab: (tab) => set({ stickerActiveTab: tab }),
  setStickerSearchQuery: (query) => set({ stickerSearchQuery: query }),

  // ---- Text Editor UI ----
  setTextEditorTab: (tab) => set({ textEditorTab: tab }),
  setTextEditContent: (content) => set({ textEditContent: content }),
  setTextEditFont: (font) => set({ textEditFont: font }),
  setTextEditColor: (color) => set({ textEditColor: color }),
  setTextEditStyle: (style) => set({ textEditStyle: style as any }),
  setTextEditAlign: (align) => set({ textEditAlign: align }),
  setTextEditFontSize: (size) => set({ textEditFontSize: size }),
  setTextEditLetterSpacing: (spacing) =>
    set({ textEditLetterSpacing: spacing }),
  setTextEditLineHeight: (lh) => set({ textEditLineHeight: lh }),
  setTextEditElementId: (id) => set({ textEditElementId: id }),
  initTextEdit: (element) =>
    set({
      textEditContent: element?.content || "",
      textEditFont: element?.fontFamily || "Inter-Regular",
      textEditColor: element?.color || "#FFFFFF",
      textEditStyle: (element?.style as any) || "classic",
      textEditAlign: (element?.textAlign as any) || "center",
      textEditFontSize: element?.fontSize || DEFAULT_TEXT_FONT_SIZE,
      textEditLetterSpacing: element?.letterSpacing ?? 0,
      textEditLineHeight: element?.lineHeight ?? 1.25,
      textEditElementId: element?.id || null,
      textEditorTab: "style",
    }),

  // ---- Text-only mode ----
  setTextOnlyMode: (enabled) => set({ textOnlyMode: enabled }),

  // ---- Canvas background ----
  setCanvasBackground: (id) => set({ canvasBackground: id }),

  // ---- Drawing color picker ----
  toggleDrawingColorPicker: () =>
    set((s) => ({ showDrawingColorPicker: !s.showDrawingColorPicker })),

  // ---- Debug ----
  setShowPerfHUD: (show) => set({ showPerfHUD: show }),

  // ---- Export Session ----
  exportSession: { status: "idle", artifact: null },
  setExportStatus: (status) =>
    set((s) => ({ exportSession: { ...s.exportSession, status } })),
  setExportArtifact: (artifact) =>
    set({ exportSession: { status: "ready", artifact, error: undefined } }),
  setExportError: (error) =>
    set({ exportSession: { status: "error", artifact: null, error } }),
  clearExport: () => set({ exportSession: { status: "idle", artifact: null } }),

  // ---- Video ----
  setVideoTime: (time) => set({ videoCurrentTime: time }),
  setVideoDuration: (duration) => set({ videoDuration: duration }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  // ---- History ----
  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return s;
      const prev = s.undoStack[s.undoStack.length - 1];
      return {
        elements: prev.elements,
        drawingPaths: prev.drawingPaths,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [
          ...s.redoStack,
          { elements: s.elements, drawingPaths: s.drawingPaths },
        ],
      };
    }),

  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return s;
      const next = s.redoStack[s.redoStack.length - 1];
      return {
        elements: next.elements,
        drawingPaths: next.drawingPaths,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [
          ...s.undoStack,
          { elements: s.elements, drawingPaths: s.drawingPaths },
        ],
      };
    }),

  clearAll: () =>
    set((s) => ({
      ...initialEditorData,
      mediaUri: s.mediaUri,
      mediaType: s.mediaType,
    })),

  // ---- Full Reset (new session) ----
  // [REGRESSION LOCK] Synchronous, deterministic reset.
  // After this call, store MUST match initialEditorData exactly.
  resetEditor: () => {
    set({
      ...initialEditorData,
      exportSession: { status: "idle", artifact: null },
    });

    if (__DEV__) {
      const s = get();
      const violations: string[] = [];
      if (s.mode !== "idle") violations.push(`mode=${s.mode}`);
      if (s.elements.length !== 0)
        violations.push(`elements=${s.elements.length}`);
      if (s.drawingPaths.length !== 0)
        violations.push(`drawingPaths=${s.drawingPaths.length}`);
      if (s.selectedElementId !== null)
        violations.push(`selectedElementId=${s.selectedElementId}`);
      if (s.mediaUri !== null) violations.push(`mediaUri=${s.mediaUri}`);
      if (violations.length > 0) {
        console.error(
          "[STOP-THE-LINE] resetEditor failed — state not clean:",
          violations.join(", "),
        );
      }
    }
  },
}));

// ---- Derived selectors (use outside component or with useEditorStore) ----

export const useSelectedElement = () =>
  useEditorStore(
    (s) => s.elements.find((el) => el.id === s.selectedElementId) ?? null,
  );

export const useCanUndo = () => useEditorStore((s) => s.undoStack.length > 0);

export const useCanRedo = () => useEditorStore((s) => s.redoStack.length > 0);

export const useHasElements = () =>
  useEditorStore((s) => s.elements.length > 0 || s.drawingPaths.length > 0);
