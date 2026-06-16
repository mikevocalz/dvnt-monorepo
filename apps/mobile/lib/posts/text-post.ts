import type { TextPostSlide, TextPostThemeKey } from "@/lib/types";

export const TEXT_POST_MAX_SLIDES = 6;
export const TEXT_POST_MAX_LENGTH = 1500;
const TRAILING_HASHTAG_BLOCK_RE = /\n+(#[^\s#]+(?:\s+#[^\s#]+)*)\s*$/;

export interface TextPostTheme {
  key: TextPostThemeKey;
  label: string;
  gradient: [string, string, ...string[]];
  border: string;
  accent: string;
  glow: string;
  textPrimary: string;
  textSecondary: string;
}

export const TEXT_POST_THEMES: Record<TextPostThemeKey, TextPostTheme> = {
  graphite: {
    key: "graphite",
    label: "Graphite",
    gradient: ["#111111", "#1E293B", "#050816"],
    border: "rgba(255,255,255,0.08)",
    accent: "#9BD7FF",
    glow: "rgba(155,215,255,0.18)",
    textPrimary: "#F8FAFC",
    textSecondary: "rgba(226,232,240,0.74)",
  },
  deviant: {
    key: "deviant",
    label: "Deviant",
    gradient: ["#1A0A2E", "#8A40CF", "#34A2DF"],
    border: "rgba(255,91,252,0.22)",
    accent: "#FF5BFC",
    glow: "rgba(138,64,207,0.28)",
    textPrimary: "#F8FAFC",
    textSecondary: "rgba(63,220,255,0.82)",
  },
  cobalt: {
    key: "cobalt",
    label: "Cobalt",
    gradient: ["#071C3A", "#143A7B", "#0E7490"],
    border: "rgba(125,211,252,0.18)",
    accent: "#7DD3FC",
    glow: "rgba(14,165,233,0.22)",
    textPrimary: "#EFF6FF",
    textSecondary: "rgba(224,242,254,0.8)",
  },
  ember: {
    key: "ember",
    label: "Ember",
    gradient: ["#331315", "#7F1D1D", "#C2410C"],
    border: "rgba(254,202,202,0.16)",
    accent: "#FDBA74",
    glow: "rgba(251,146,60,0.2)",
    textPrimary: "#FFF7ED",
    textSecondary: "rgba(255,237,213,0.82)",
  },
  sage: {
    key: "sage",
    label: "Sage",
    gradient: ["#0B1F1A", "#1F4D45", "#365314"],
    border: "rgba(187,247,208,0.16)",
    accent: "#86EFAC",
    glow: "rgba(74,222,128,0.18)",
    textPrimary: "#F0FDF4",
    textSecondary: "rgba(220,252,231,0.82)",
  },
};

export function resolveTextPostTheme(
  theme?: TextPostThemeKey | string | null,
): TextPostTheme {
  if (!theme) return TEXT_POST_THEMES.graphite;
  return (
    TEXT_POST_THEMES[theme as TextPostThemeKey] || TEXT_POST_THEMES.graphite
  );
}

export function normalizeTextPostTheme(
  theme?: string | null,
): TextPostThemeKey {
  if (!theme) return "graphite";
  return (TEXT_POST_THEMES[theme as TextPostThemeKey]?.key ||
    "graphite") as TextPostThemeKey;
}

export function truncateTextPost(
  text: string | null | undefined,
  maxLength: number,
): string {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function createLocalSlideId() {
  return `slide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTextPostSlide(
  content: string = "",
  order = 0,
): TextPostSlide {
  return {
    id: createLocalSlideId(),
    order,
    content,
  };
}

export function normalizeTextPostSlides(
  input: Array<Partial<TextPostSlide>> | null | undefined,
  fallbackContent?: string | null,
): TextPostSlide[] {
  const normalized = Array.isArray(input)
    ? input
        .map((slide, index) => ({
          id:
            typeof slide.id === "string" && slide.id.length > 0
              ? slide.id
              : createLocalSlideId(),
          order:
            typeof slide.order === "number" && Number.isFinite(slide.order)
              ? slide.order
              : index,
          content: typeof slide.content === "string" ? slide.content : "",
        }))
        .sort((a, b) => a.order - b.order)
    : [];

  if (normalized.length > 0) {
    return normalized.map((slide, index) => ({
      ...slide,
      order: index,
    }));
  }

  return [createTextPostSlide(fallbackContent || "", 0)];
}

function splitTrailingHashtagCaption(
  content: string | null | undefined,
): { content: string; caption: string } {
  const value = typeof content === "string" ? content.trimEnd() : "";
  if (!value) {
    return { content: "", caption: "" };
  }

  const match = value.match(TRAILING_HASHTAG_BLOCK_RE);
  if (!match || typeof match.index !== "number") {
    return { content: value, caption: "" };
  }

  const nextContent = value.slice(0, match.index).trimEnd();
  if (!nextContent) {
    return { content: value, caption: "" };
  }

  return {
    content: nextContent,
    caption: match[1]?.trim() || "",
  };
}

export function getPrimaryTextPostContent(
  slides: Array<Pick<TextPostSlide, "content">> | null | undefined,
  fallbackContent?: string | null,
): string {
  const firstSlide = Array.isArray(slides)
    ? slides.find((slide) => typeof slide.content === "string")
    : null;
  const content = firstSlide?.content ?? fallbackContent ?? "";
  return typeof content === "string" ? content : "";
}

export interface TextPostPresentation {
  textSlides: TextPostSlide[];
  caption: string;
  previewText: string;
}

export function resolveRenderableTextPostPresentation(
  input: Array<Partial<TextPostSlide>> | null | undefined,
  caption?: string | null,
): TextPostPresentation {
  const parsedFromSlides = resolveTextPostPresentation(input, undefined);
  const explicitCaption = typeof caption === "string" ? caption.trim() : "";
  const previewText = getPrimaryTextPostContent(
    parsedFromSlides.textSlides,
    undefined,
  );
  const hasSeparateCaption =
    explicitCaption.length > 0 && explicitCaption !== previewText;

  if (parsedFromSlides.textSlides.length > 1 || hasSeparateCaption) {
    return {
      textSlides: parsedFromSlides.textSlides,
      caption: hasSeparateCaption ? explicitCaption : parsedFromSlides.caption,
      previewText,
    };
  }

  return resolveTextPostPresentation(input, caption);
}

export function resolveTextPostPresentation(
  input: Array<Partial<TextPostSlide>> | null | undefined,
  fallbackContent?: string | null,
): TextPostPresentation {
  const hasInputSlides =
    Array.isArray(input) &&
    input.some(
      (slide) =>
        typeof slide?.content === "string" && slide.content.trim().length > 0,
    );
  const hasFallbackContent =
    typeof fallbackContent === "string" && fallbackContent.trim().length > 0;

  if (!hasInputSlides && !hasFallbackContent) {
    return {
      textSlides: [],
      caption: "",
      previewText: "",
    };
  }

  const normalizedSlides = normalizeTextPostSlides(input, fallbackContent);
  if (normalizedSlides.length === 0) {
    return {
      textSlides: [],
      caption: "",
      previewText: "",
    };
  }

  const lastSlideIndex = normalizedSlides.length - 1;
  const lastSlide = normalizedSlides[lastSlideIndex];
  const splitLastSlide = splitTrailingHashtagCaption(lastSlide?.content);
  const textSlides = splitLastSlide.caption
    ? normalizedSlides.map((slide, index) =>
        index === lastSlideIndex
          ? { ...slide, content: splitLastSlide.content }
          : slide,
      )
    : normalizedSlides;

  return {
    textSlides,
    caption: splitLastSlide.caption,
    previewText: getPrimaryTextPostContent(textSlides, fallbackContent),
  };
}

export function serializeTextSlidesForMutation(
  slides: Array<Pick<TextPostSlide, "content">>,
): string[] {
  return slides.map((slide) => slide.content);
}
