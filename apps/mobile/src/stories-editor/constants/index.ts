// ============================================================
// Instagram Stories Editor - Constants & Presets
// ============================================================

import {
  LUTFilter,
  FilterAdjustment,
  ColorPalette,
  TextStylePreset,
} from "../types";

// ---- Screen Dimensions ----
// Story aspect ratio: 9:16
export const STORY_ASPECT_RATIO = 9 / 16;
export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1920;

// Default text font size in CANVAS units (not screen pts).
// At surface.scale ≈ 0.364 on iPhone, 120cu ≈ 44pts on screen.
export const DEFAULT_TEXT_FONT_SIZE = 120;
// Minimum allowed fontSize in canvas units — sanity floor
export const MIN_TEXT_FONT_SIZE = 40;

// ---- Color Palettes ----

export const EDITOR_COLORS = {
  background: "#000000",
  surface: "#1a1a1a",
  surfaceLight: "#2a2a2a",
  primary: "#0095F6",
  accent: "#FF3366",
  text: "#FFFFFF",
  textSecondary: "#8E8E93",
  border: "#333333",
  danger: "#FF3B30",
  success: "#34C759",
  overlay: "rgba(0,0,0,0.6)",
  gradient: {
    instagram: ["#F58529", "#DD2A7B", "#8134AF", "#515BD4"],
    sunset: ["#FF512F", "#DD2476"],
    ocean: ["#2193B0", "#6DD5ED"],
    forest: ["#134E5E", "#71B280"],
  },
};

export const DRAWING_COLORS: string[] = [
  "#FFFFFF",
  "#000000",
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#007AFF",
  "#5856D6",
  "#AF52DE",
  "#FF2D55",
  "#A2845E",
  "#8E8E93",
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#F1948A",
  "#82E0AA",
  "#F8C471",
  "#AED6F1",
  "#D7BDE2",
  "#A3E4D7",
];

export const COLOR_PALETTES: ColorPalette[] = [
  {
    id: "vibrant",
    name: "Vibrant",
    colors: ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#5856D6"],
  },
  {
    id: "pastel",
    name: "Pastel",
    colors: ["#FFB5B5", "#FFDAB5", "#FFFFB5", "#B5FFB5", "#B5D4FF", "#D4B5FF"],
  },
  {
    id: "earth",
    name: "Earth",
    colors: ["#8B4513", "#CD853F", "#DEB887", "#556B2F", "#2F4F4F", "#708090"],
  },
  {
    id: "neon",
    name: "Neon",
    colors: ["#FF073A", "#39FF14", "#00F0FF", "#FF61F6", "#FFE700", "#7B00FF"],
  },
  {
    id: "monochrome",
    name: "Mono",
    colors: ["#FFFFFF", "#D4D4D4", "#A0A0A0", "#6B6B6B", "#3A3A3A", "#000000"],
  },
];

// ---- Text Presets ----

// Font asset registry — maps fontFamily → bundled .ttf for Skia's useFont
export const FONT_ASSETS: Record<string, number> = {
  "Inter-Regular": require("@/assets/fonts/Inter-Regular.ttf"),
  "Inter-SemiBold": require("@/assets/fonts/Inter-SemiBold.ttf"),
  "Inter-Bold": require("@/assets/fonts/Inter-Bold.ttf"),
  "SpaceGrotesk-Regular": require("@/assets/fonts/SpaceGrotesk-Regular.ttf"),
  "SpaceGrotesk-Bold": require("@/assets/fonts/SpaceGrotesk-Bold.ttf"),
  "Republica-Minor": require("@/assets/fonts/Republica-Minor.ttf"),
  BraveGates: require("@/assets/fonts/BraveGates.ttf"),
  LightBrighter: require("@/assets/fonts/LightBrighter.ttf"),
  Oasis: require("@/assets/fonts/oasis.ttf"),
  RedHat: require("@/assets/fonts/redhat.ttf"),
};

export const TEXT_FONTS = [
  { id: "inter", name: "Classic", fontFamily: "Inter-Regular" },
  { id: "inter-bold", name: "Bold", fontFamily: "Inter-Bold" },
  { id: "space", name: "Space", fontFamily: "SpaceGrotesk-Regular" },
  { id: "space-bold", name: "Space Bold", fontFamily: "SpaceGrotesk-Bold" },
  { id: "republica", name: "Republica", fontFamily: "Republica-Minor" },
  { id: "brave", name: "Brave Gates", fontFamily: "BraveGates" },
  { id: "light", name: "Light", fontFamily: "LightBrighter" },
  { id: "oasis", name: "Oasis", fontFamily: "Oasis" },
  { id: "redhat", name: "Red Hat", fontFamily: "RedHat" },
];

export interface TextStyleConfig {
  id: TextStylePreset;
  name: string;
  hasBackground: boolean;
  hasStroke: boolean;
  hasShadow: boolean;
  hasGradient: boolean;
  defaultBackgroundColor?: string;
  defaultStrokeColor?: string;
  defaultStrokeWidth?: number;
  defaultShadowColor?: string;
  defaultShadowBlur?: number;
}

export const TEXT_STYLE_PRESETS: TextStyleConfig[] = [
  {
    id: "classic",
    name: "Classic",
    hasBackground: false,
    hasStroke: false,
    hasShadow: true,
    hasGradient: false,
    defaultShadowColor: "rgba(0,0,0,0.5)",
    defaultShadowBlur: 4,
  },
  {
    id: "modern",
    name: "Modern",
    hasBackground: true,
    hasStroke: false,
    hasShadow: false,
    hasGradient: false,
    defaultBackgroundColor: "rgba(0,0,0,0.7)",
  },
  {
    id: "neon",
    name: "Neon",
    hasBackground: false,
    hasStroke: false,
    hasShadow: true,
    hasGradient: false,
    defaultShadowColor: "#FF00FF",
    defaultShadowBlur: 20,
  },
  {
    id: "typewriter",
    name: "Typewriter",
    hasBackground: true,
    hasStroke: false,
    hasShadow: false,
    hasGradient: false,
    defaultBackgroundColor: "#FFFFFF",
  },
  {
    id: "strong",
    name: "Strong",
    hasBackground: true,
    hasStroke: true,
    hasShadow: false,
    hasGradient: false,
    defaultBackgroundColor: "#FF3B30",
    defaultStrokeColor: "#FFFFFF",
    defaultStrokeWidth: 2,
  },
  {
    id: "outline",
    name: "Outline",
    hasBackground: false,
    hasStroke: true,
    hasShadow: false,
    hasGradient: false,
    defaultStrokeColor: "#FFFFFF",
    defaultStrokeWidth: 3,
  },
  {
    id: "shadow",
    name: "Shadow",
    hasBackground: false,
    hasStroke: false,
    hasShadow: true,
    hasGradient: false,
    defaultShadowColor: "#000000",
    defaultShadowBlur: 10,
  },
  {
    id: "gradient",
    name: "Gradient",
    hasBackground: false,
    hasStroke: false,
    hasShadow: false,
    hasGradient: true,
  },
];

// ---- LUT Filters (Color Matrices) ----
// 4x5 color matrices for Skia's ColorFilter.MakeMatrix

export const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
];

export const LUT_FILTERS: LUTFilter[] = [
  {
    id: "normal",
    name: "Normal",
    matrix: IDENTITY_MATRIX,
    intensity: 1.0,
  },
  {
    id: "clarendon",
    name: "Clarendon",
    matrix: [
      1.2, 0, 0, 0, 0.039, 0, 1.2, 0, 0, 0.039, 0, 0, 1.3, 0, 0.078, 0, 0, 0, 1,
      0,
    ],
    intensity: 1.0,
  },
  {
    id: "gingham",
    name: "Gingham",
    matrix: [
      1.05, 0.1, 0.05, 0, 0.039, 0.05, 1.05, 0.05, 0, 0.039, 0.05, 0.1, 1.0, 0,
      0.059, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "moon",
    name: "Moon",
    matrix: [
      0.33, 0.33, 0.33, 0, 0.078, 0.33, 0.33, 0.33, 0, 0.078, 0.33, 0.33, 0.33,
      0, 0.078, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "lark",
    name: "Lark",
    matrix: [
      1.2, 0.1, 0, 0, 0.059, 0, 1.1, 0.05, 0, 0.039, 0, 0.05, 0.9, 0, 0.02, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "reyes",
    name: "Reyes",
    matrix: [
      1.1, 0, 0, 0, 0.118, 0, 1.05, 0, 0, 0.098, 0, 0, 0.95, 0, 0.078, 0, 0, 0,
      0.85, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "juno",
    name: "Juno",
    matrix: [1.3, 0, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 1, 0],
    intensity: 1.0,
  },
  {
    id: "slumber",
    name: "Slumber",
    matrix: [
      0.9, 0.1, 0.1, 0, 0.039, 0.1, 0.85, 0.1, 0, 0.039, 0.1, 0.1, 0.9, 0,
      0.078, 0, 0, 0, 0.9, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "crema",
    name: "Crema",
    matrix: [
      1.1, 0.05, 0, 0, 0.059, 0, 1.05, 0.05, 0, 0.039, 0, 0, 0.95, 0, 0.02, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "ludwig",
    name: "Ludwig",
    matrix: [
      1.15, 0, 0, 0, -0.039, 0, 1.05, 0, 0, -0.02, 0, 0, 0.9, 0, 0, 0, 0, 0, 1,
      0,
    ],
    intensity: 1.0,
  },
  {
    id: "aden",
    name: "Aden",
    matrix: [
      0.95, 0.1, 0.05, 0, 0.078, 0.05, 0.95, 0.1, 0, 0.059, 0, 0, 0.85, 0,
      0.039, 0, 0, 0, 0.9, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "perpetua",
    name: "Perpetua",
    matrix: [
      1.05, 0, 0.15, 0, 0.039, 0, 1.1, 0.05, 0, 0.039, 0, 0.1, 1.0, 0, 0.078, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "valencia",
    name: "Valencia",
    matrix: [
      1.2, 0.1, 0, 0, 0.039, 0, 1.0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "xpro2",
    name: "X-Pro II",
    matrix: [
      1.3, 0, 0.1, 0, -0.039, 0, 1.0, 0.1, 0, 0, -0.1, 0, 1.2, 0, 0.039, 0, 0,
      0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "lofi",
    name: "Lo-Fi",
    matrix: [
      1.4, 0, 0, 0, -0.078, 0, 1.4, 0, 0, -0.078, 0, 0, 1.4, 0, -0.078, 0, 0, 0,
      1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "inkwell",
    name: "Inkwell",
    matrix: [
      0.299, 0.587, 0.114, 0, 0, 0.299, 0.587, 0.114, 0, 0, 0.299, 0.587, 0.114,
      0, 0, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "earlybird",
    name: "Earlybird",
    matrix: [
      1.2, 0.15, 0, 0, 0.078, 0, 1.0, 0.1, 0, 0.039, 0, 0, 0.7, 0, 0, 0, 0, 0,
      0.9, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "nashville",
    name: "Nashville",
    matrix: [
      1.2, 0.15, 0, 0, 0.098, 0, 1.05, 0, 0, 0.059, -0.1, 0, 0.8, 0, 0.118, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
];

// ---- Default Adjustments ----

export const DEFAULT_ADJUSTMENTS: FilterAdjustment = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  vignette: 0,
  sharpen: 0,
  fade: 0,
  grain: 0,
};

// ---- Drawing Tool Configs ----

export const DRAWING_TOOL_CONFIG = {
  pen: {
    minWidth: 2,
    maxWidth: 20,
    defaultWidth: 4,
    opacity: 1,
    blendMode: "srcOver" as const,
  },
  marker: {
    minWidth: 8,
    maxWidth: 40,
    defaultWidth: 15,
    opacity: 0.6,
    blendMode: "srcOver" as const,
  },
  neon: {
    minWidth: 4,
    maxWidth: 25,
    defaultWidth: 8,
    opacity: 1,
    blendMode: "screen" as const,
  },
  eraser: {
    minWidth: 10,
    maxWidth: 60,
    defaultWidth: 25,
    opacity: 1,
    blendMode: "clear" as const,
  },
  arrow: {
    minWidth: 2,
    maxWidth: 10,
    defaultWidth: 4,
    opacity: 1,
    blendMode: "srcOver" as const,
  },
  highlighter: {
    minWidth: 15,
    maxWidth: 50,
    defaultWidth: 25,
    opacity: 0.4,
    blendMode: "srcOver" as const,
  },
};

// ---- Sticker Categories ----

export const EMOJI_STICKERS = [
  "😀",
  "😂",
  "🥰",
  "😎",
  "🤩",
  "😍",
  "🥳",
  "😱",
  "🔥",
  "❤️",
  "💕",
  "✨",
  "🌟",
  "⭐",
  "💫",
  "🎉",
  "🎊",
  "🎈",
  "🎁",
  "🏆",
  "👑",
  "💎",
  "🦋",
  "🌈",
  "☀️",
  "🌙",
  "⚡",
  "💥",
  "💯",
  "🎵",
  "🎶",
  "🎭",
  "🍕",
  "🍔",
  "🍦",
  "🍩",
  "☕",
  "🍷",
  "🥂",
  "🍾",
  "📸",
  "🎬",
  "🎤",
  "🎧",
  "💻",
  "📱",
  "🚀",
  "✈️",
  "🌍",
  "🏖️",
  "🏔️",
  "🌸",
  "🌺",
  "🌻",
  "🍀",
  "🌴",
  "🐶",
  "🐱",
  "🦁",
  "🦄",
  "🐝",
  "🦋",
  "🐙",
  "🦊",
  "👍",
  "👎",
  "✌️",
  "🤞",
  "👏",
  "🙌",
  "💪",
  "🤝",
  "💋",
  "💌",
  "💝",
  "💘",
  "🏳️‍🌈",
  "🎯",
  "🧿",
  "🪬",
];

export const INTERACTIVE_STICKERS = [
  { id: "poll", icon: "📊", name: "Poll" },
  { id: "question", icon: "❓", name: "Question" },
  { id: "quiz", icon: "🧠", name: "Quiz" },
  { id: "countdown", icon: "⏰", name: "Countdown" },
  { id: "slider", icon: "🎚️", name: "Emoji Slider" },
  { id: "location", icon: "📍", name: "Location" },
  { id: "mention", icon: "@", name: "Mention" },
  { id: "hashtag", icon: "#", name: "Hashtag" },
  { id: "music", icon: "🎵", name: "Music" },
  { id: "link", icon: "🔗", name: "Link" },
  { id: "gif", icon: "🎞️", name: "GIF" },
  { id: "time", icon: "🕐", name: "Time" },
  { id: "weather", icon: "🌤️", name: "Weather" },
  { id: "selfie", icon: "🤳", name: "Selfie" },
];

// ---- Custom Image Sticker Packs (bundled local assets) ----

export interface ImageStickerPack {
  id: string;
  name: string;
  icon: string;
  stickers: { id: string; label: string; source: number }[];
}

export const IMAGE_STICKER_PACKS: ImageStickerPack[] = [
  {
    id: "dvnt",
    name: "DVNT",
    icon: "🖤",
    stickers: [
      {
        id: "dvnt-app",
        label: "App",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_APP.png"),
      },
      {
        id: "dvnt-afterhours",
        label: "After Hours",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_AfterHours.png"),
      },
      {
        id: "dvnt-counterculture",
        label: "Counter Culture",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_CounterCulture.png"),
      },
      {
        id: "dvnt-dayplay",
        label: "Day Play",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_DAYPLAY.png"),
      },
      {
        id: "dvnt-deviant",
        label: "Deviant",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_Deviant.png"),
      },
      {
        id: "dvnt-energycheck",
        label: "Energy Check",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_EnergyCheck.png"),
      },
      {
        id: "dvnt-ftc",
        label: "FTC",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_FTC.png"),
      },
      {
        id: "dvnt-outside",
        label: "Outside",
        source: require("@/assets/images/stickers/dvnt/DVNT-stickers_OUTSIDE.png"),
      },
      {
        id: "dvnt-eatit",
        label: "Eat It",
        source: require("@/assets/images/stickers/dvnt/eat-it.png"),
      },
    ],
  },
  {
    id: "ballroom",
    name: "Ballroom",
    icon: "💃",
    stickers: [
      {
        id: "ballroom-chop",
        label: "Chop",
        source: require("@/assets/images/stickers/ballroom/1-chop.png"),
      },
      {
        id: "ballroom-serve1",
        label: "Serve",
        source: require("@/assets/images/stickers/ballroom/serve.png"),
      },
      {
        id: "ballroom-serve2",
        label: "Category Is",
        source: require("@/assets/images/stickers/ballroom/category-is.png"),
      },
      {
        id: "ballroom-ate",
        label: "Ate That",
        source: require("@/assets/images/stickers/ballroom/ate-that.png"),
      },
      {
        id: "ballroom-tea",
        label: "Tea",
        source: require("@/assets/images/stickers/ballroom/tea.png"),
      },
    ],
  },
];

const IMAGE_STICKERS_BY_ID = new Map(
  IMAGE_STICKER_PACKS.flatMap((pack) =>
    pack.stickers.map((sticker) => [sticker.id, sticker.source] as const),
  ),
);

export function getImageStickerSourceById(id: string): number | null {
  return IMAGE_STICKERS_BY_ID.get(id) ?? null;
}

// ---- Effect Filters (Skia ColorMatrix) ----
// Pure Skia ColorMatrix-based effects — no .cube file parsing needed.
// Each uses a 4×5 color matrix, same as LUT_FILTERS above.

export interface EffectFilter {
  id: string;
  name: string;
  category: "film" | "fujifilm" | "vivid" | "cinematic" | "log";
  matrix: number[];
  intensity: number;
}

export const EFFECT_FILTERS: EffectFilter[] = [
  // ── Film ──────────────────────────────────────────────────────────
  {
    id: "film-look",
    name: "Film Look",
    category: "film",
    matrix: [
      1.1, 0.05, 0.02, 0, 0.02, 0, 1.0, 0.05, 0, 0.01, -0.02, 0.05, 0.95, 0,
      0.02, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "vintage-color",
    name: "Vintage",
    category: "film",
    matrix: [
      1.0, 0.15, 0, 0, 0.06, 0, 0.95, 0.1, 0, 0.04, 0, 0, 0.8, 0, 0.04, 0, 0, 0,
      0.85, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "faded-print",
    name: "Faded Print",
    category: "film",
    matrix: [
      0.9, 0.1, 0.05, 0, 0.06, 0.05, 0.9, 0.1, 0, 0.05, 0, 0.08, 0.85, 0, 0.06,
      0, 0, 0, 0.9, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "kodak-gold",
    name: "Kodak Gold",
    category: "film",
    matrix: [
      1.15, 0.08, 0, 0, 0.04, 0, 1.05, 0.04, 0, 0.02, -0.05, 0, 0.85, 0, 0, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "portra-400",
    name: "Portra 400",
    category: "film",
    matrix: [
      1.05, 0.06, 0.02, 0, 0.02, 0.02, 1.02, 0.04, 0, 0.01, -0.02, 0.02, 0.95,
      0, 0.03, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },

  // ── Fujifilm ──────────────────────────────────────────────────────
  {
    id: "fuji-provia",
    name: "Provia",
    category: "fujifilm",
    matrix: [
      1.15, 0, 0, 0, 0.01, 0, 1.1, 0, 0, 0.01, 0, 0, 1.15, 0, 0, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-velvia",
    name: "Velvia",
    category: "fujifilm",
    matrix: [
      1.35, -0.05, 0, 0, -0.02, 0, 1.25, -0.05, 0, -0.02, 0, -0.05, 1.35, 0, 0,
      0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-astia",
    name: "Astia",
    category: "fujifilm",
    matrix: [
      1.08, 0.04, 0, 0, 0.01, 0.02, 1.06, 0.02, 0, 0.01, 0, 0.02, 1.05, 0, 0.02,
      0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-classic-chrome",
    name: "Classic Chrome",
    category: "fujifilm",
    matrix: [
      1.05, 0.05, 0.02, 0, 0.01, 0.02, 0.95, 0.05, 0, 0.01, 0, 0.02, 0.88, 0,
      0.02, 0, 0, 0, 0.95, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-classic-neg",
    name: "Classic Neg",
    category: "fujifilm",
    matrix: [
      1.1, 0.08, 0, 0, 0.04, 0, 0.95, 0.08, 0, 0.02, -0.05, 0.05, 0.9, 0, 0.04,
      0, 0, 0, 0.92, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-eterna",
    name: "Eterna",
    category: "fujifilm",
    matrix: [
      0.92, 0.06, 0.04, 0, 0.02, 0.04, 0.92, 0.06, 0, 0.02, 0.02, 0.05, 0.9, 0,
      0.03, 0, 0, 0, 0.95, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-eterna-bb",
    name: "Eterna BB",
    category: "fujifilm",
    matrix: [
      0.85, 0.15, 0.1, 0, -0.02, 0.1, 0.85, 0.1, 0, -0.02, 0.05, 0.1, 0.82, 0,
      0, 0, 0, 0, 0.9, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-acros",
    name: "Acros",
    category: "fujifilm",
    matrix: [
      0.35, 0.55, 0.15, 0, -0.02, 0.3, 0.55, 0.2, 0, -0.02, 0.25, 0.5, 0.25, 0,
      -0.02, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-reala",
    name: "Reala Ace",
    category: "fujifilm",
    matrix: [
      1.06, 0.02, 0, 0, 0.01, 0, 1.04, 0.02, 0, 0.01, 0, 0, 1.02, 0, 0.01, 0, 0,
      0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-pro-neg",
    name: "Pro Neg Std",
    category: "fujifilm",
    matrix: [
      1.02, 0.04, 0.02, 0, 0.02, 0.02, 0.98, 0.04, 0, 0.02, 0, 0.02, 0.96, 0,
      0.03, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },

  // ── Vivid ─────────────────────────────────────────────────────────
  {
    id: "vivid-1",
    name: "Vivid I",
    category: "vivid",
    matrix: [
      1.25, 0, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, 1.25, 0, 0, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "vivid-2",
    name: "Vivid II",
    category: "vivid",
    matrix: [
      1.3, -0.05, 0, 0, 0.02, 0, 1.25, -0.05, 0, 0.02, -0.05, 0, 1.35, 0, 0, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "vivid-3",
    name: "Vivid III",
    category: "vivid",
    matrix: [
      1.15, 0.1, 0, 0, 0, -0.05, 1.3, 0, 0, 0, 0, -0.05, 1.4, 0, 0, 0, 0, 0, 1,
      0,
    ],
    intensity: 1.0,
  },
  {
    id: "vivid-4",
    name: "Vivid IV",
    category: "vivid",
    matrix: [
      1.4, -0.1, 0, 0, 0, 0, 1.15, -0.1, 0, 0, -0.1, 0, 1.4, 0, 0.02, 0, 0, 0,
      1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "vivid-5",
    name: "Vivid V",
    category: "vivid",
    matrix: [
      1.5, -0.15, -0.05, 0, 0, -0.05, 1.35, -0.1, 0, 0, -0.1, -0.05, 1.5, 0, 0,
      0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },

  // ── Cinematic ─────────────────────────────────────────────────────
  {
    id: "cine-k25",
    name: "K25",
    category: "cinematic",
    matrix: [
      1.2, 0.05, 0, 0, 0.02, 0.03, 1.05, 0, 0, 0.01, 0, 0.02, 0.9, 0, 0.02, 0,
      0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "cine-k64",
    name: "K64",
    category: "cinematic",
    matrix: [
      1.18, 0.08, -0.02, 0, 0.01, 0, 1.08, 0.02, 0, 0.01, -0.04, 0.02, 0.95, 0,
      0.03, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "cine-k99",
    name: "K99",
    category: "cinematic",
    matrix: [
      1.15, 0.1, 0, 0, 0.03, 0, 0.98, 0.06, 0, 0.02, -0.05, 0, 0.88, 0, 0.04, 0,
      0, 0, 0.95, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "arri-709",
    name: "ARRI 709",
    category: "cinematic",
    matrix: [
      1.08, 0.04, 0.02, 0, -0.01, 0.02, 1.05, 0.03, 0, -0.01, 0, 0.02, 1.02, 0,
      0.01, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "kodak-2383",
    name: "Kodak 2383",
    category: "cinematic",
    matrix: [
      1.12, 0.06, 0, 0, 0.03, 0, 1.0, 0.04, 0, 0.01, -0.04, 0, 0.88, 0, 0.01, 0,
      0, 0, 0.95, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "fuji-3513",
    name: "Fuji 3513",
    category: "cinematic",
    matrix: [
      1.05, 0.02, 0.04, 0, 0.01, 0, 1.02, 0.06, 0, 0.01, 0.02, 0.04, 1.0, 0,
      0.02, 0, 0, 0, 0.98, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "red-film",
    name: "RED Film",
    category: "cinematic",
    matrix: [
      1.1, 0.05, 0.02, 0, 0.02, 0, 1.05, 0.05, 0, 0, -0.02, 0.02, 0.92, 0, 0.01,
      0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "red-bleach",
    name: "Bleach Bypass",
    category: "cinematic",
    matrix: [
      0.9, 0.2, 0.1, 0, -0.03, 0.1, 0.9, 0.15, 0, -0.03, 0.05, 0.15, 0.85, 0,
      -0.02, 0, 0, 0, 0.9, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "red-bw",
    name: "Cinema B&W",
    category: "cinematic",
    matrix: [
      0.33, 0.56, 0.11, 0, 0.02, 0.33, 0.56, 0.11, 0, 0.02, 0.33, 0.56, 0.11, 0,
      0.02, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },

  // ── Log ───────────────────────────────────────────────────────────
  {
    id: "log-soft",
    name: "Soft Contrast",
    category: "log",
    matrix: [
      0.92, 0.04, 0.02, 0, 0.04, 0.02, 0.92, 0.04, 0, 0.04, 0.02, 0.02, 0.92, 0,
      0.04, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "log-classic",
    name: "Classic",
    category: "log",
    matrix: [
      1.08, 0.04, 0, 0, 0.02, 0, 1.04, 0.02, 0, 0.02, 0, 0, 0.98, 0, 0.03, 0, 0,
      0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "log-natural",
    name: "Natural",
    category: "log",
    matrix: [
      1.02, 0.02, 0, 0, 0.01, 0, 1.02, 0.02, 0, 0.01, 0, 0, 1.0, 0, 0.02, 0, 0,
      0, 1, 0,
    ],
    intensity: 1.0,
  },
  {
    id: "log-709",
    name: "Rec 709",
    category: "log",
    matrix: [
      1.1, 0.02, 0, 0, 0, 0, 1.06, 0.02, 0, 0, 0, 0, 1.04, 0, 0, 0, 0, 0, 1, 0,
    ],
    intensity: 1.0,
  },
];

// ---- Story Background Presets (Instagram-style) ----

export interface StoryBackground {
  id: string;
  type: "solid" | "gradient";
  color?: string;
  colors?: string[];
  /** Gradient angle in degrees (0 = top-to-bottom) */
  angle?: number;
}

export const STORY_BACKGROUNDS: StoryBackground[] = [
  // Solids
  { id: "black", type: "solid", color: "#000000" },
  { id: "white", type: "solid", color: "#FFFFFF" },
  { id: "dark-gray", type: "solid", color: "#1a1a2e" },
  { id: "navy", type: "solid", color: "#16213e" },
  { id: "forest", type: "solid", color: "#1b4332" },
  { id: "wine", type: "solid", color: "#590d22" },
  { id: "plum", type: "solid", color: "#3c096c" },
  // Gradients
  {
    id: "sunset",
    type: "gradient",
    colors: ["#F77062", "#FE5196"],
    angle: 135,
  },
  {
    id: "ocean",
    type: "gradient",
    colors: ["#2193B0", "#6DD5ED"],
    angle: 180,
  },
  {
    id: "instagram",
    type: "gradient",
    colors: ["#F58529", "#DD2A7B", "#8134AF", "#515BD4"],
    angle: 135,
  },
  {
    id: "midnight",
    type: "gradient",
    colors: ["#0F2027", "#203A43", "#2C5364"],
    angle: 180,
  },
  {
    id: "peach",
    type: "gradient",
    colors: ["#FFDEE9", "#B5FFFC"],
    angle: 180,
  },
  {
    id: "aurora",
    type: "gradient",
    colors: ["#A9F1DF", "#FFBBBB"],
    angle: 135,
  },
  {
    id: "neon",
    type: "gradient",
    colors: ["#08AEEA", "#2AF598"],
    angle: 0,
  },
  {
    id: "fire",
    type: "gradient",
    colors: ["#F12711", "#F5AF19"],
    angle: 135,
  },
  {
    id: "purple-haze",
    type: "gradient",
    colors: ["#7F00FF", "#E100FF"],
    angle: 135,
  },
  {
    id: "deep-space",
    type: "gradient",
    colors: ["#000000", "#434343"],
    angle: 180,
  },
];

// ---- Animation ----

export const ANIMATION_DURATION = 250;
export const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
  mass: 1,
};

// ---- Export Presets ----

export const EXPORT_PRESETS = {
  story: {
    width: 1080,
    height: 1920,
    fps: 30,
    bitrate: 8000000,
  },
  reel: {
    width: 1080,
    height: 1920,
    fps: 30,
    bitrate: 10000000,
  },
  post: {
    width: 1080,
    height: 1080,
    fps: 30,
    bitrate: 8000000,
  },
};
