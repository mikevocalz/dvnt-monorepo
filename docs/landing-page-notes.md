# DVNT Landing Page — Scroll Architecture & Notes

The marketing landing page is authored as **React Native universal code** in
`packages/app/features/screens/landing/`, rendered on web through
react-native-web in `apps/web-vite` (route `/`, also `/landing`) and able to run
inside the Expo app. No GSAP/Lenis/DOM-Three — Reanimated is the scroll timeline.

## One offset, derived progresses

The whole page is driven by a **single scroll offset shared value** (the
GSAP-ScrollTrigger "scrollbar is a timeline" model, in Reanimated):

- **Native**: a single `Animated.ScrollView` owns the page; its offset comes from
  `useScrollViewOffset(scrollRef)`.
- **Web**: the page scrolls the **window** (`ScreenScrollView useWindowScrolling`
  renders a plain View), and a `window` `scroll` listener syncs `window.scrollY`
  into the same shared value.

Both feed `LandingScrollContext` (`packages/app/features/screens/landing/hooks/useScrollProgress.ts`):

```ts
{ scrollOffset: SharedValue<number>, viewportH: SharedValue<number>, reduceMotion: SharedValue<boolean> }
```

Every section derives its own progress from that one offset + its measured layout,
entirely in worklets (no setState / runOnJS in the scroll path):

```ts
const { onLayout, progress, enter } = useSectionProgress();
// progress: 0 below viewport → 0.5 centered → 1 fully passed (CLAMP)
//   = interpolate(scrollOffset, [top - vh, top, top + height], [0, 0.5, 1])
// enter:    0 → 1 as the section's top rises one viewport into view
```

`top`/`height` are measured via `onLayout` into shared values — no hardcoded px.
Parallax = layering `progress`-driven `translateY` at different rates; section
entrances = `enter`-driven opacity. To add a section: render it inside `<Main>`,
call `useSectionProgress()`, and interpolate off `progress`/`enter`.

## Header turn-to-glass (hysteresis)

`sections/GlassHeader.tsx`. A `useAnimatedReaction` on `scrollOffset` flips a
discrete `isGlass` state with **hysteresis** so a jittery scroll can't flicker it:

- engage when `scrollOffset > 48` (`HEADER.engageY`)
- release when `scrollOffset < 24` (`HEADER.releaseY`)

It animates a `glass` 0→1 value with `withTiming(…, { duration: 400, easing:
EASE_SETTLE })` where `EASE_SETTLE = Easing.bezier(0.22, 1, 0.36, 1)`. The glass
*amount* animates (scrim alpha, border color, scale) — not a binary swap. On web
the header/footer live in `apps/web-vite/src/components/WebShell.tsx` (the route
`__root`); the landing screen itself renders Hero → Pillars → PhoneStage.

## Capability ladder + reduced motion

`hooks/useCapabilityTier.ts` probes once at mount and logs the chosen tier
(`[Landing] graphics tier="…"`):

- `webgpu` → reserved for Phase 2 (3D phone)
- `skia` → native ambient field (`AmbientField.native.tsx`, Skia `RuntimeEffect`)
- `gradient` → web ambient field (`AmbientField.web.tsx`, pointer-reactive
  animated gradient — the always-safe tier; Skia-on-web is deferred)

`AccessibilityInfo.isReduceMotionEnabled` / web `prefers-reduced-motion` sets the
`reduceMotion` shared value, which collapses parallax to fades and freezes the
ambient drift.

## Platform splits (resolved by bundler extension)

- `sections/Hero.{web,native}.tsx` — web uses a raw DOM `<video>` + **hls.js** off
  the stable Squarespace **master `playlist.m3u8`** (HLS); native uses
  `expo-video`. (We don't use expo-video on web — it depends on the shimmed
  `expo-modules-core`.)
- `sections/AmbientField.{web,native}.tsx` — gradient (web) / Skia (native).
- `components/GlassSurface.{web,native}.tsx` — CSS `backdrop-filter` (web) /
  `expo-blur` (native).

Each split has a `.d.ts` for the type-checker (Vite/Metro pick `.web`/`.native`).

## web-vite config fixes this required (`apps/web-vite/vite.config.ts`)

The landing page is the first heavy **react-native-web** consumer in web-vite, which
surfaced several Vite ESM/CJS-interop issues. All fixes live in `vite.config.ts`:

1. **`react-native` alias → bare `react-native-web`** (not an absolute path). An
   absolute-path alias makes Vite serve RNW raw, bypassing dep pre-bundling, so
   its CJS subtree fails default/named imports.
2. **`optimizeDeps.include`** force-pre-bundles RNW and the exact CJS modules it
   imports (styleq, `@react-native/normalize-colors`, inline-style-prefixer's deep
   `lib/plugins/*`, postcss-value-parser) so esbuild gives each proper interop.
3. **Reanimated `webUtils` ESM shim** (`load` hook): reanimated's `webUtils.web.js`
   fetches RNW's `createReactDOMStyle` via `require()` — a no-op in Vite's raw ESM
   serving — leaving it undefined and crashing animated-style updates
   (`Cannot convert undefined or null to object`). The hook replaces that module
   with an ESM equivalent.
4. **Reanimated `validate-worklets-version` / is-edge-to-edge** shims/includes
   (pre-existing reanimated CJS issues).
5. **`EXPO_PUBLIC_*` env injection** via `loadEnv` → `define` (the shared code reads
   `process.env.EXPO_PUBLIC_*`; Vite only substitutes `define`d keys). See
   `apps/web-vite/.env`.

## Reanimated without the Babel plugin

web-vite's `@vitejs/plugin-react` does **not** run the reanimated/worklets Babel
plugin over `@dvnt/app`, so every worklet hook (`useAnimatedStyle`,
`useDerivedValue`, `useAnimatedReaction`) passes an **explicit dependency array**.
When adding worklets to the landing, include the deps array or they'll throw at
runtime on web.

## Known follow-ups

- Hero video on web relies on hls.js for Chrome/Firefox (Safari plays HLS
  natively) — autoplay may be gated until interaction; the dark scrim covers it.
- A few RN style deprecation warnings remain (`shadow*` / `textShadow*` /
  `props.pointerEvents`) and the benign `useScrollOffset` "animatedRef not
  initialized" warning on web (web uses the window-scroll path, so the native
  scrollRef is intentionally unattached).
- **Phase 2** (deferred): the pinned WebGPU + three.js 3D phone with a live RN-view
  projected onto the screen plane (`three` + `typegpu` are approved). `PhoneStage.tsx`
  is the Phase-1 placeholder and the only file that swap touches.
