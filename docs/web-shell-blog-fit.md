# Web Shell · Blog · Comments · Payload — As-Is Fit (PROMPT 13/13B)

> Architecture audit BEFORE building, per the prompt mandate. Anchors to
> `docs/design-language.md`. Written 2026-06-17. The web + blog + Payload setup
> evolved heavily during the Payload-into-Next migration — this is the real
> current shape, not older snapshots.

## TL;DR — the real state differs from the prompt's assumptions

- **Web app = Next.js 16 App Router** (`apps/web`), NOT Vite/TanStack. All
  user routes live under `app/(frontend)/`; Payload admin under `(payload)`,
  internal console under `(console)`. Marketing-flash guard + chrome routing
  live in `apps/web/src/components/site-chrome.tsx`.
- **Blog is largely BUILT** (Payload-backed, in-process Local API). Posts
  collection is complete (Lexical w/ 13 custom blocks, draft→publish, SEO/OG,
  JSON-LD Article schema, read-time); `/posts/[slug]` renders byline,
  contributors, TOC, comments, related, structured data. Gaps: sitemap/robots,
  author-from-user bridge.
- **TWO comments systems exist** — reconcile, don't fork further.
- **Roles are Payload-only** (AdminUsers super_admin/admin/moderator); the app's
  `public.users` has only a `verified` boolean, no role the app reads.
- **The 3-column AppShell is the big NEW build.** Today web uses floating
  top-pill header + bottom-pill tab bar; no left rail / right aside.

---

## 1. Web app shell (§1) — what exists

- Chrome root: `apps/web/src/components/site-chrome.tsx` (mounted once in
  `app/(frontend)/layout.tsx`, never unmounts). Branches by pathname + auth:
  - `/auth/*` → bare (no chrome)
  - app surfaces (`/feed /events /profile /notifications /settings /video`) +
    authed + hydrated → `WebAppHeader` (floating top pill) + children +
    `WebTabBar` (floating bottom pill: Home·Events·[+]·Activity·Profile)
  - else → marketing `GlassHeader` + Footer
- Per-route layouts wrap children in `WebAppShell`
  (`packages/app/components/web-app-shell.web.tsx`) — auth gate + top padding.
- Responsive: `useIsLargeScreen()` (768px) +
  `useResponsiveMedia()`. Native reference for a side rail:
  `packages/app/components/tab-bar/TabletTabBar.tsx` (72px RIGHT rail).
- `@dvnt/ui` has primitives (Button/Card/Avatar/Badge/Skeleton…) but **no
  AppShell/NavRail/Sidebar** — to build.

**Plan**: new `AppShell` (web) — `grid: [nav | content | aside]`. Desktop
(≥1024) rail(~240 expanded / 72 collapsed at md) + center (`max-w-2xl`
reading) + right aside (~300, empty-safe slot `aside` prop). <768 → center +
existing `WebTabBar` (add Blog to its overflow). Glass-on-near-black,
gradient wordmark, hairline borders — the brief, not a Twitter clone. Slot API
`<AppShell nav children aside>`. Reuse `WebTabBar`/`CenterButton`/breakpoint
hooks; preserve `site-chrome` marketing-vs-app branching.

## 2. Blog (§2) — what exists vs gaps

- Collection `packages/cms/src/collections/Posts.ts`: title, slug, excerpt,
  eyebrow, heroImage/Video/caption, **content (Lexical + 13 blocks: pullQuote,
  imageGallery, videoEmbed, statBlock, eventCallout, appCta, newsletterCta,
  relatedPostsBlock, timeline, faq, divider, sideNote, sponsoredDisclosure)**,
  categories, tags, authors, contributors, featured/editorsPick/trending,
  readTime (auto), publishedAt, **seo group (title/desc/ogImage/canonical/
  noIndex/structuredData)**, relatedPosts. Drafts+autosave on.
- Render: `apps/web/src/components/RichText` uses Payload's official
  `@payloadcms/richtext-lexical/react` converter (all node types) + internal
  link resolver. `/posts/[slug]/page.tsx` = full detail w/ JSON-LD + OG.
- Index/taxonomy: `/blog` + `/posts`, category filter; data via
  `apps/web/src/lib/posts.ts` (Local API) + `blog-api.ts`.
- **GAPS**: no `app/sitemap.ts` / `robots.ts`; blog index has no CollectionPage
  schema; Blog not yet reachable from app nav rail (build in §1).

## 3. Comments (§3) — TWO systems (reconcile)

- **App threaded comments** (`packages/app`): Supabase `public.comments`,
  **2-level** (depth 0–2, trigger-enforced), `post_id` → `public.posts` only
  (**NOT polymorphic**). Hooks `use-comments.ts`, API via edge fns
  (`add-comment` etc.), `threaded-comment.tsx` UI, optimistic. No tier badge
  rendered. Powers feed/text posts.
- **Payload blog comments** (`packages/cms/src/collections/Comments.ts`):
  separate `payload`-schema table, relationship→Posts + authorMember→Members,
  parent/threadRoot/depth, status visible|removed, **shadowed** flag. Moderation
  via `commentGuards.ts` (banned→block, shadow_banned→create+flag), Reports,
  BanList, ModerationActions. Blog `/posts/[slug]` already renders comments via
  THIS (createComment endpoint, service token).
- **Reconciliation (decision)**: blog comments ALREADY run on the Payload
  Comments collection with full shadow-ban/moderation — that IS "the existing
  system" for blog. The prompt's "reuse packages/app threaded system" can't
  apply literally (that system is `public.posts`-bound, not polymorphic, and has
  no moderation/shadow-ban wired — moderation lives in Payload). **Recommend:
  keep blog on Payload Comments (moderation-integrated), and bring the app's
  threaded-comment UX/polish (2-level, optimistic, tier badge) to the blog
  comment components** — one comment *experience*, the right backend per surface.
  Document this so we don't fork a third stack.
- Logged-in only composer; signed-out sees comments + "Log in to comment".

## 4. Auth-gated event UI (§4 / 13B) — the leak

- `event-detail.web.tsx`: like/checkout/RSVP correctly branch on auth + guest
  (free public → `openGuestRsvp`, paid public → `openGuestCheckout`, else
  `/auth/login`). "Who's going" + comments are `MembersOnly` (blurred). **Good.**
- **LEAK**: the **SPICY toggle** (`events-list.web.tsx` ~L240, mobile too)
  renders for everyone — no `isAuthenticated` check. Must be hidden when
  signed-out (member-only affordance). Quick fix.
- Ticket buttons follow guest-checkout branching — do NOT blanket-gate them;
  only hide the SPICY toggle + ensure signed-out paid/free still reach the guest
  CTA (already true).

## 5. Roles (§5) — Payload-only today

- `packages/cms/src/access/roles.ts`: super_admin/admin/moderator on
  **AdminUsers** (separate from app users); super-admins pinned by email.
  `isSuperAdmin/isAdminPlus/canModerate`.
- App `public.users`: only `verified` boolean — **no role the app reads**.
  Members collection mirrors users (status enum for moderation) via `appUserId`.
- **GAP (§5)**: add a `role` (`user|moderator|super_admin`) settable in Payload
  on the user-backed collection (Members, keyed to `public.users`), AND a
  `public.users.role` column the APP reads for moderation powers — one source of
  truth. Wire Payload access + app moderation to it.

## 6. Events/tickets in Payload (§6) — exist but enum-misaligned

- `Events.ts`/`Tickets.ts` map to the live Supabase tables via
  `appEventId`/`appTicketId` (sync upsert, edits preserved). **GOOD** (same-table
  intent already there).
- **BLOCKER**: status enums drift from the live state machines:
  - Events: Payload `[draft,published,cancelled,ended]` vs app
    `[draft,active,cancelled,postponed,suspended]`.
  - Tickets: Payload `[valid,checked_in,cancelled,refunded,transferred,pending]`
    vs app `[active,scanned,refunded,void,transfer_pending]`.
- **Plan**: align enums to the app machines; restrict CMS to safe-to-edit fields
  + surface state transitions as controlled actions (don't let CMS push illegal
  states). Gate write access on §5 roles (super-admin; host for own events).

## 7. Author-from-user (§7) — needs a bridge

- Posts `authors` → **Authors** collection (editorial: name, role label, bio,
  avatar, socials {ig/x/tiktok/website}, profileUrl). Separate from app users.
- App `public.users` already has `bio`, `website`, `links` (jsonb), `pronouns`.
- **GAP**: §7 wants the About-the-author block to pull LIVE from the user
  record. Bridge: add `linkedUserProfile` (relationship→Members, optional) +
  keep editorial `role` title on Authors; render byline from the linked user's
  name/avatar/bio/socials, falling back to the editorial Author fields. Editable
  in Payload + the app profile; never a frozen per-post copy.

## 13B — auth routing matrix (as-is)

- Auth: Better Auth (`packages/auth`) + `useAuthStore` (Zustand+persist);
  same-origin `/api/auth/*` proxy for first-party cookies; `loadAuthState()`
  silent refresh on init. Hydration gated by `_hasHydrated`.
- Web: NO middleware auth guard (middleware only does blog-subdomain rewrite).
  `RedirectIfAuthed` on `/` + `/auth/*`. Post-login **hardcoded `/feed`** — no
  `returnTo`. `site-chrome` waits for hydration (mitigates flash).
- **GAPS**: `returnTo` capture+consume (internal-only, reject external);
  logged-in `/login`→feed (have via RedirectIfAuthed); onboarding-incomplete
  routing; logout cache-clear + no back-button protected flash; redirect-loop
  guard; resolve auth before first paint (neutral splash). Guest-checkout must
  stay un-gated.

---

## Build order (this initiative, multi-pass)

1. **AppShell** (§1) — foundational; everything sits in it. *(this pass)*
2. **SPICY toggle auth-gate** (§4 leak) + **sitemap/robots** (§2). *(this pass)*
3. `returnTo` after login (13B) + Blog in nav.
4. Author→user bridge (§7) + render.
5. Events/Tickets enum alignment + CMS access (§6).
6. `role` on Members + `public.users.role` the app reads (§5); wire moderation.
7. Comment UX polish on blog (tier badge, 2-level parity) (§3).
8. `docs/auth-routing.md` finalized with the full matrix.

One comments experience, one auth/session, one role source. Right aside =
reserved empty-safe slot. Mobile keeps its tab bar; rail is web-only.
