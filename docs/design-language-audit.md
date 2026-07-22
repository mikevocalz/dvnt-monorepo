# DVNT design-language audit (PROMPT NN · B0)

The sole source of visual truth for Onboarding v2. Every new screen composes
these tokens and primitives; anything not listed here is a stop-and-ask, not an
invention. Sources: `packages/app/theme/` (NAV_THEME + iOS system colors),
`packages/app/features/routes/global.css` (CSS variables / NativeWind),
`AuthScreens.shared.tsx`, and the most-polished screens (auth suite,
post-detail.web, settings-home.web, mobile onboarding slides, welcome flow).
`apps/web` consumes the same `@dvnt/app` token source through the RNW alias +
Tailwind variables — there is no separate web theme.

## Color roles

| Role | Value | Notes |
|---|---|---|
| Background | `#000` (tokens) / `#02030A` (auth + detail surfaces) / `#06070d` (settings chrome) | near-black blue family; never pure gray |
| Foreground | `#fff`; secondary `rgba(255,255,255,0.65)`; faint `…0.5`/`0.4` | |
| Primary / ring | `rgb(62,164,229)` (`--primary` 199 88% 54%) | buttons, focus, selected chips (auth suite uses `AUTH_PRIMARY_COLOR = P`) |
| Accent pink | `#FF5BFC` (`--accent` 304 100% 68%) | likes, progress dots, brand moments — sparingly |
| Accent cyan | `#3FDCFF` (`--accent-cyan`) | bookmarks, step icons, free tier |
| Purple | `#8A40CF` (`--purple`) | middle stop of the brand gradient |
| Brand gradient | `#34A2DF → #8A40CF → #FF5BFC` (blue→purple→pink) | onboarding slides, story rings, app-icon tile |
| Destructive | `rgb(240,82,82)`; web rose `#f43f5e` | delete, errors |
| Surfaces | card `rgba(255,255,255,0.04–0.06)` + border `rgba(255,255,255,0.10–0.12)` | glass-dark cards |

## Type

System font stack. Weights carry hierarchy, not typeface changes:
- Eyebrow: 11px, weight 900, letter-spacing 3, uppercase, white/50 (`DVNT.APP`)
- Display: 28–38px, weight 900, tight line-height; brand voice lowercase
  ("connect. gather. move.")
- Title row: 17px semibold (settings/nav headers)
- Body: 14–15px, white/65–75, line-height ~1.5
- Micro/labels: 11–13px, weight 700

## Spacing · radii · elevation

- Spacing: 4-grid; screen padding 16–24; card padding 16–28; control gaps 10–14
- Radii: pills 999; cards/sheets 12–24 (`rounded-xl`/`rounded-2xl`); buttons
  10–12; **avatars are rounded squares (`rounded-2xl`), never circles**
- Elevation: borders + backdrop-blur, not shadows. Blur orbs as ambient light
  (blue `rgba(62,164,229,0.18)` top-right, pink `rgba(255,109,193,0.10)`
  bottom-left, blur 54–56px) on auth/marketing surfaces only

## Motion

- Springs: `damping 18–20, stiffness 180–300` (Reanimated/Motion); timing exits ~180ms
- Motion orients (step transitions, slide crossfade `opacity 0→1, scale 1.05→1`);
  never decorates. Reduced-motion respected; no scroll-jacking

## Component primitives (reuse, never re-invent)

- `Button` (`components/ui/button`, variants default/secondary, `loading` prop)
- `FormInput` (@tanstack/react-form binding, top-aligned labels)
- Kit `Dialog` / `Drawer` (@dvnt/ui) — confirm dialogs, bottom sheets
- `FormField`, `StickySaveBar`, `useDirtyGuard` (@dvnt/ui) — settings/edit forms
- Selection chips: pill, border 1.5 white/18 → selected `P` border +
  `rgba(62,164,229,0.16)` fill + check icon (welcome flow); web edit-profile
  variant `bg-cyan-500` selected
- Progress dots: 6px, active stretches to 12–18px and turns `#FF5BFC`
- Avatar component (`ui/avatar`, roundedSquare)
- Toasts: sonner / sonner-native

## Copy rules (already in force)

Sentence case, plain verbs, lowercase brand voice for display lines. Buttons say
exactly what happens ("Enable location", "Delete", never "Submit"/"Continue"
when a verb exists). Errors say what happened + how to fix, no apologies.
Privacy microcopy pattern: "Private — used only to tune your events and feed."
One idea per screen; skippable steps say "Skip"/"Not now" in white/55.

## Accessibility floor

44pt touch targets, `accessibilityRole`/labels on pressables, visible keyboard
focus on web (`--ring`), dynamic type tolerated by flex layouts, masked
inputs/media in any capture surface.
