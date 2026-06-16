/**
 * Email design tokens — the SINGLE source of truth for branded transactional
 * email. Mirrors the landing palette (packages/app/.../landing/theme.ts) and the
 * canonical ticket-tier accents (apps/mobile/lib/theme/tier-colors.ts), but
 * frozen here as plain hex strings because edge functions run in Deno and can't
 * import app code.
 *
 * Email reality drives every choice: tables + inline CSS, image logo (custom
 * fonts barely render in mail clients), gradients need a solid fallback, and
 * dark-mode clients must be told not to invert the brand.
 */

/** Where the hosted logo assets live. Overridable per-environment via the
 *  EMAIL_ASSET_BASE edge secret; defaults to the public `assets` Supabase
 *  Storage bucket (mirror also lives in apps/web/public/ for a future web
 *  deploy). The same PNGs are uploaded to both. */
const ASSET_BASE = (
  Deno.env.get("EMAIL_ASSET_BASE") ||
  "https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/email"
).replace(/\/+$/, "");

export const BRAND = {
  name: "DVNT",
  legalName: "Deviant LLC",
  tagline: "Where nightlife meets culture",
  society: "Counter Culture Society",
  /** Public-facing site for footer links. */
  site: "https://dvntapp.live",
  privacyUrl: "https://dvntapp.live/privacy",
  faqUrl: "https://dvntapp.live/faq",
} as const;

export const LOGO = {
  /** Retina white-gradient wordmark (540×207 source → render 180×69). */
  wordmarkUrl: `${ASSET_BASE}/dvnt-email-logo@2x.png`,
  wordmarkWidth: 180,
  wordmarkHeight: 69,
  /** Footer glyph (144×144 source → render 28×28). */
  glyphUrl: `${ASSET_BASE}/dvnt-email-glyph.png`,
  glyphWidth: 28,
  glyphHeight: 28,
} as const;

/** Surfaces & text — the glass slab, flattened for email. */
export const COLORS = {
  /** Outer canvas (the page behind the card). */
  canvas: "#0a0a0a",
  /** Card panel (the flattened glass). */
  panel: "#0f0f12",
  /** Hairline borders. */
  hairline: "#1f1f23",
  /** Nested panel (code block / info rows). */
  panelInset: "#141418",

  text: "#ffffff",
  textBody: "#a1a1aa",
  textMuted: "#71717a",
  textFaint: "#52525b",

  /** Core brand accents (match tier-colors.ts + landing theme). */
  cyan: "#3FDCFF",
  teal: "#379ed8",
  blueDeep: "#0f4961",
  purple: "#8A40CF",
  purpleDeep: "#5b2c81",
  purpleMid: "#874e9f",
  magenta: "#FF5BFC",
} as const;

/**
 * Brand gradients as CSS strings + solid fallbacks. Gradients are delivered via
 * `background-image`; the solid fallback is the `background-color` underneath so
 * clients that strip gradients still get an on-brand fill.
 */
export const GRADIENTS = {
  /** Primary CTA — teal-blue → purple (the wordmark's own ramp extended). */
  brand: {
    css: `linear-gradient(135deg, ${COLORS.teal} 0%, ${COLORS.purpleDeep} 100%)`,
    /** Outlook/VML & solid-fallback color. */
    solid: COLORS.teal,
    /** VML gradient endpoints (Outlook reads fillcolor + the <v:fill> stops). */
    vmlFrom: COLORS.teal,
    vmlTo: COLORS.purpleDeep,
  },
  /** Deviant — purple → magenta. Used for accents / secondary emphasis. */
  deviant: {
    css: `linear-gradient(135deg, ${COLORS.purple} 0%, ${COLORS.magenta} 100%)`,
    solid: COLORS.purple,
    vmlFrom: COLORS.purple,
    vmlTo: COLORS.magenta,
  },
  /** Thin header rule under the wordmark. */
  rule: {
    css: `linear-gradient(90deg, ${COLORS.blueDeep} 0%, ${COLORS.teal} 45%, ${COLORS.purpleMid} 100%)`,
    solid: COLORS.teal,
  },
} as const;

/**
 * Canonical ticket-tier accents. Mirrors apps/mobile/lib/theme/tier-colors.ts.
 * `grad` gives each tier a badge gradient; VIP/table lean into the brand ramps,
 * GA/free stay flatter — and a future "gold" comp tier is supported.
 */
export type TierLevel = "free" | "ga" | "vip" | "table" | "comp";

export const TIERS: Record<
  TierLevel,
  { accent: string; soft: string; grad: string; label: string }
> = {
  free: {
    accent: "#3FDCFF",
    soft: "#3FDCFF",
    grad: "linear-gradient(135deg, #3FDCFF 0%, #34A2DF 100%)",
    label: "FREE",
  },
  ga: {
    accent: "#34A2DF",
    soft: "#34A2DF",
    grad: "linear-gradient(135deg, #34A2DF 0%, #0f4961 100%)",
    label: "GA",
  },
  vip: {
    accent: "#8A40CF",
    soft: "#C084FC",
    grad: "linear-gradient(135deg, #8A40CF 0%, #5b2c81 100%)",
    label: "VIP",
  },
  table: {
    accent: "#FF5BFC",
    soft: "#FF5BFC",
    grad: "linear-gradient(135deg, #FF5BFC 0%, #8A40CF 100%)",
    label: "TABLE",
  },
  comp: {
    accent: "#E8C766",
    soft: "#F4E2A6",
    grad: "linear-gradient(135deg, #F4E2A6 0%, #C9A227 100%)",
    label: "COMP",
  },
};

/** Resolve a tier theme from a free-form tier string (case/whitespace tolerant). */
export function tierTheme(tier?: string | null) {
  const key = String(tier || "").trim().toLowerCase() as TierLevel;
  return TIERS[key] ?? TIERS.ga;
}

/** Body font stack — Inter where available, web-safe fallbacks everywhere else. */
export const FONTS = {
  body:
    "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  /** Display face is progressive enhancement only (the wordmark is an image). */
  display:
    "'Space Grotesk',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  mono: "'SFMono-Regular',ui-monospace,Menlo,Consolas,'Liberation Mono',monospace",
} as const;

export const SPACE = {
  cardPadding: 32,
  cardRadius: 16,
  panelRadius: 12,
} as const;

/** Minimal HTML escaping for any user-supplied string interpolated into email. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
