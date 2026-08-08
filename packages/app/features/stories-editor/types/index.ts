// ============================================================
// Instagram Stories Editor - Type Definitions
// ============================================================

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Transform {
  translateX: number;
  translateY: number;
  scale: number;
  rotation: number;
}

// ---- Canvas Elements ----

export type ElementType = "sticker" | "text" | "drawing" | "image";

export interface BaseElement {
  id: string;
  type: ElementType;
  transform: Transform;
  zIndex: number;
  opacity: number;
  timestamp?: number; // for video timeline
}

export interface StickerElement extends BaseElement {
  type: "sticker";
  source: string | number; // emoji, URL, or require() asset ID
  category: StickerCategory;
  size: number;
  assetId?: string;
}

export interface StickerInsertOptions {
  category?: StickerCategory;
  size?: number;
  assetId?: string;
}

export type StickerCategory =
  | "emoji"
  | "gif"
  | "location"
  | "mention"
  | "hashtag"
  | "poll"
  | "question"
  | "countdown"
  | "music"
  | "link"
  | "custom";

export interface TextElement extends BaseElement {
  type: "text";
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor?: string;
  textAlign: "left" | "center" | "right";
  style: TextStylePreset;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  letterSpacing?: number;
  lineHeight?: number;
  maxWidth: number;
}

export type TextStylePreset =
  | "classic"
  | "modern"
  | "neon"
  | "typewriter"
  | "strong"
  | "outline"
  | "shadow"
  | "gradient";

export interface DrawingPath {
  id: string;
  points: Position[];
  color: string;
  strokeWidth: number;
  tool: DrawingTool;
  opacity: number;
}

export type DrawingTool =
  | "pen"
  | "marker"
  | "neon"
  | "eraser"
  | "arrow"
  | "highlighter";

export interface DrawingElement extends BaseElement {
  type: "drawing";
  paths: DrawingPath[];
}

export interface ImageElement extends BaseElement {
  type: "image";
  uri: string;
  size: Size;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
}

export type CanvasElement =
  | StickerElement
  | TextElement
  | DrawingElement
  | ImageElement;

// ---- Filters / LUTs ----

export interface LUTFilter {
  id: string;
  name: string;
  icon?: string;
  // Color matrix values for Skia ColorFilter
  matrix: number[];
  intensity: number;
}

export interface FilterAdjustment {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vignette: number;
  sharpen: number;
  fade: number;
  grain: number;
}

// ---- Editor State ----

export type EditorMode =
  | "idle"
  | "text"
  | "drawing"
  | "sticker"
  | "filter"
  | "adjust"
  | "crop"
  | "trim"
  | "export";

export type TextEditorTab = "style" | "font" | "color" | "typography";
export type FilterMainTab = "filters" | "effects";

export interface EditorState {
  mode: EditorMode;
  elements: CanvasElement[];
  selectedElementId: string | null;
  drawingPaths: DrawingPath[];
  currentFilter: LUTFilter | null;
  adjustments: FilterAdjustment;
  mediaUri: string | null;
  mediaType: "image" | "video";
  videoDuration: number;
  videoCurrentTime: number;
  isPlaying: boolean;
  canvasSize: Size;
  undoStack: { elements: CanvasElement[]; drawingPaths: DrawingPath[] }[];
  redoStack: { elements: CanvasElement[]; drawingPaths: DrawingPath[] }[];
  // ---- Drawing UI ----
  drawingTool: DrawingTool;
  drawingColor: string;
  strokeWidth: number;
  // ---- Filter/Effect UI ----
  selectedEffectId: string | null;
  filterMainTab: FilterMainTab;
  filterEffectCategory: string;
  // ---- Sticker UI ----
  stickerActiveTab: string;
  stickerSearchQuery: string;
  // ---- Text Editor UI ----
  textEditorTab: TextEditorTab;
  textEditContent: string;
  textEditFont: string;
  textEditColor: string;
  textEditStyle: TextStylePreset;
  textEditAlign: "left" | "center" | "right";
  textEditFontSize: number;
  textEditLetterSpacing: number;
  textEditLineHeight: number;
  textEditElementId: string | null;
  // ---- Text-only stories ----
  textOnlyMode: boolean; // true ONLY when user explicitly creates a text-only story
  canvasBackground: string; // StoryBackground id
  // ---- Drawing color picker ----
  showDrawingColorPicker: boolean;
  // ---- Debug ----
  showPerfHUD: boolean;
}

// ---- Export ----

export interface ExportOptions {
  format: "video" | "image";
  quality: "low" | "medium" | "high";
  resolution: Size;
  fps: number;
  duration: number;
  includeAudio: boolean;
}

export interface ExportProgress {
  progress: number;
  status: "preparing" | "rendering" | "encoding" | "saving" | "done" | "error";
  message: string;
}

export interface ExportArtifact {
  uri: string;
  type: "image" | "video";
  width: number;
  height: number;
  duration?: number;
}

export type ExportStatus =
  | "idle"
  | "rendering"
  | "ready"
  | "saving"
  | "saved"
  | "error";

export interface ExportSession {
  status: ExportStatus;
  artifact: ExportArtifact | null;
  error?: string;
}

// ---- Color Palette ----

export interface ColorPalette {
  id: string;
  name: string;
  colors: string[];
}

// ---- Gesture State ----

export interface GestureState {
  isPinching: boolean;
  isRotating: boolean;
  isDragging: boolean;
  initialScale: number;
  initialRotation: number;
  initialPosition: Position;
}
