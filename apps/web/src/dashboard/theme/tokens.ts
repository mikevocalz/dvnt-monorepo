// src/dashboard/theme/tokens.ts
// Design tokens aligned to the DVNT web design family (the marketing / legal /
// faq pages): deviant near-black base, magenta + cyan brand accents, glass
// surfaces with backdrop blur. Keep these in lockstep with apps/web's
// legal-page styling so the admin reads as the same product.
export const color = {
  bg: '#02030A',
  // Glass surfaces (use with backdropFilter where supported).
  surface: 'rgba(8,10,20,0.72)',
  surfaceSolid: '#0b0e1a',
  surfaceHover: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.12)',
  text: '#FAFAF9',
  textDim: 'rgba(245,245,244,0.78)',
  textFaint: 'rgba(245,245,244,0.5)',
  brand: '#FF5BFC', // DVNT magenta-pink (accents, primary)
  cyan: '#3FDCFF', // kicker / secondary accent
  brandAlt: '#8A40CF', // deviant purple
  danger: '#fca5a5',
  success: '#86efac',
  // Deviant gradient wash + brand gradient, matching apps/web.
  gradient:
    'radial-gradient(70% 42% at 50% 0%, rgba(138,64,207,0.30) 0%, rgba(124,58,237,0.12) 38%, rgba(2,3,10,0) 78%), #02030A',
  deviantCss: 'linear-gradient(135deg, #8A40CF 0%, #FF5BFC 100%)',
  glassBlur: 'saturate(160%) blur(18px)',
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 40 }
export const radius = { sm: 8, md: 12, lg: 16, xl: 22 }
export const font = { xs: 12, sm: 14, md: 16, lg: 24, xl: 34 }

export const SANS =
  'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

// Status pill colors keyed by member moderation status.
export const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  active: { bg: 'rgba(134,239,172,0.14)', fg: '#86efac' },
  under_review: { bg: 'rgba(63,220,255,0.14)', fg: '#3FDCFF' },
  warned: { bg: 'rgba(251,146,60,0.16)', fg: '#fb923c' },
  suspended: { bg: 'rgba(248,113,113,0.16)', fg: '#f87171' },
  shadow_banned: { bg: 'rgba(138,64,207,0.20)', fg: '#c084fc' },
  banned: { bg: 'rgba(255,91,252,0.16)', fg: '#FF5BFC' },
}
