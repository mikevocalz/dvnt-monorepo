# DVNT Blog — Award-Polish Pass

Editorial polish for the public blog at **blog.dvntapp.live** (Next.js App Router
→ Payload Lexical). Every effect ties to comprehension or hierarchy, not
decoration, and every motion effect has a `prefers-reduced-motion: reduce`
static fallback (WCAG).

## Brand

Locked teal→blue + purple ramp on a near-black canvas, defined once as tokens in
[`../styles/dvnt-theme.css`](../styles/dvnt-theme.css). **No new hues** — every
accent, glow, gradient and motion colour derives from those ramp stops.

| Token | Value | Role |
| --- | --- | --- |
| `--dvnt-bg` / `--dvnt-surface` | `#07090c` / `#0e1318` | Canvas / glass surface |
| `--dvnt-b1…b8` | `#0f4961` → `#379ed8` | Teal→blue ramp |
| `--dvnt-p1…p5` | `#874e9f` → `#5b2c81` | Purple ramp |
| `--dvnt-accent` | `#379ed8` (b8) | Primary interactive (AA on canvas) |
| `--dvnt-accent-2` | `#b07ec9` | Eyebrows/labels — lightened p1, AA at small sizes |
| `--dvnt-grad` | `135deg, #5b2c81→#743f92→#2981af→#379ed8` | The one signature gradient |

The re-skin is **scoped to the blog** via a `.dvnt-blog` root class so the rest
of the app keeps its own magenta/cyan identity. Only smooth-scroll (`:has()`)
and the `@view-transition` opt-in are document-level, and both are
motion-gated.

## Signature

Boldness is spent in one place: the **brand gradient**, expressed three ways —
the cinematic hero hairline, the animated article **spine** down the card edge,
and a **gradient drop-cap** opening the prose. Everything around it stays quiet.

## Effects

| # | Effect | Where | Reduced-motion fallback |
| --- | --- | --- | --- |
| 1 | **Reading-progress bar** (brand gradient, glow) | `components/ArticleProgress.tsx` | `[data-progress]{display:none}` + the rAF loop never starts |
| 2 | **Reading time** | post header byline (`post.readTime`) | static text — n/a |
| 3 | **Sticky TOC + scroll-spy** (IntersectionObserver; mobile drawer) | `components/ArticleStickyTools.tsx`; anchors wired by `ScrollReveal` | TOC is plain anchor links; keyboard-navigable buttons |
| 4 | **Scroll-reveal** content blocks (staggered IO fade/translate) | `components/ScrollReveal.tsx` → `.dvnt-sr` | JS adds the hidden class, so no-JS / reduced-motion = fully visible (no FOUC) |
| 5 | **Cinematic hero** (full-bleed, scrim, oversized title, gradient hairline) | both pages; `data-hero` entrance | entrance keyframe disabled; hero static |
| 6 | **Animated gradient rule** (hero hairline, article spine, section dividers) | `.dvnt-rule` / `.dvnt-rule--spine` | drift animation off → static centred gradient |
| 7 | **Enhanced prose** (gradient drop-cap, pull-quotes, figcaptions, code, ~68ch measure) | page CSS + `.dvnt-dropcap` | all static; drop-cap unaffected by motion |
| 8 | **Magnetic / tilt cards** (pointer-follow 3D + lift; featured = larger hero card) | `components/MagneticCards.tsx` → `.dvnt-tilt` | disabled (fine-pointer only); CSS hover-lift remains |
| 9 | **Staggered card entrance** | index `.dvnt-reveal` | `opacity:1; transform:none` |
| 10 | **View Transitions** (cross-fade + `post-hero` shared-element) | `@view-transition` + `view-transition-name` | no-op on unsupported browsers → instant nav |
| 11 | **Focus rings + smooth scroll** (teal `:focus-visible`, `html:has(.dvnt-blog)`) | `dvnt-theme.css` | `scroll-behavior:auto`; focus ring always on (a11y) |

### View Transitions — scope note (honest)

The CSS `@view-transition { navigation: auto }` opt-in drives cross-fades on
**cross-document / back-forward** navigations in supporting browsers, with the
hero morphing via the shared `post-hero` name. Next App Router client-side
`<Link>` navigations are same-document, so for those it is a graceful no-op
(instant nav) until the project adopts Next's experimental `ViewTransition` — a
deliberately dependency-free, build-safe choice for this pass.

## Performance budget

- **Dependency-free.** No GSAP / animation libs added; effects are CSS + two
  tiny IntersectionObserver/pointer components. Net JS for motion ≈ a few KB.
- **LCP** = hero image, kept as `next/image`/Solito `priority` with reserved
  `aspect-ratio` boxes → **CLS ≈ 0** (nothing reflows; reveal only animates
  opacity/transform).
- **Compositor-friendly:** reveals/tilt animate `transform`/`opacity` only; the
  progress bar is a single `scaleX` on a fixed element; the gradient rule is a
  1–3px element. rAF loop is cancelled on unmount and skipped under
  reduced-motion.
- Target **Lighthouse perf ≥ 90** with effects on.

## Images & content

- Images render through **`next/image`** (semantic `<img>` with responsive
  `sizes`/`srcset`) on real Payload Media. Hero images use `priority` (LCP);
  cards/avatars are lazy.
- **Dev note:** Next's optimizer refuses upstream images that resolve to a
  private IP (SSRF guard), and the local Payload CMS is `localhost:5173`. So
  `next.config.ts` sets `images.unoptimized` in development only — production
  media (CDN / `*.dvntapp.live`) stays fully optimized.
- Demo content is seeded idempotently via
  [`web-vite/scripts/seed-posts.ts`](../../../../web-vite/scripts/seed-posts.ts)
  (`pnpm --filter web-vite seed:posts`): 2 categories, 2 authors, 3 published
  posts, and 5 Media uploads (heroes + avatars).

## Markup

- The pages use **plain semantic HTML** (`main/section/article/h1/h2/p/ul/li/nav/header`),
  not `@expo/html-elements`. The latter renders through react-native-web, which
  **ignores CSS Grid** (forces flexbox) — so the responsive `minmax()` card grids
  and `.dvnt-prose` styling only apply with real DOM tags. Blog-only exception to
  the app's usual @expo/html-elements convention.

## Responsiveness

- Cinematic hero height/padding/title are fluid (`clamp()`); the asymmetric
  "Latest stories" row stacks under 760px with wide-card images moving on top;
  the article hero goes 21:9 → 16:10 on phones; all grids use `auto-fill`
  `minmax()`. Verified at 390px and 1440px.

## Accessibility & mobile

- Every animation respects `prefers-reduced-motion` (single block at the foot of
  `dvnt-theme.css` plus per-component guards).
- TOC collapses to a ≥44px touch dropdown; tilt is fine-pointer-only; focus
  order intact; accent colours clear AA on `#07090c`.
- The `Comments` component is untouched in behaviour and inherits the new
  prose/spacing rhythm.
