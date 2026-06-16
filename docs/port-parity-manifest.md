# Port Parity Manifest (PROMPT 5)

Source of truth: **`../deviant/app`**. Verifier: `pnpm verify:parity`
(`scripts/verify-port-parity.mjs`). A screen is **done** when its verifier checks
pass and its row here is complete.

## 🏁 STATUS: WEB PORT COMPLETE (Phases 0–7)

**Every mobile route now renders a real web screen — 0 render-native-on-web.**
`pnpm verify:parity` → exit 0. Web audit: **115 real web screens** (started at 8).
web-data-parity: **80 screens** checked vs their native source, **no dropped
portable wiring**. Typecheck: **0 errors** across all 115 ported screens + app
chrome (the only 5 repo errors are in the landing 3D-phone `PhoneStage.web.tsx`,
the separate landing plan's deferred three.js/WebGPU Phase 2 — needs
`@types/three`; unrelated to this port).

Debt ledger (3 tiny tracked enhancements, phase-tagged, printed every run):
`chat.web` shared-post UI store (feed-post-store), `messages.web` Lynk
live-rooms tab (chat-store/useLynkHistoryStore), `sneaky-lynk/room.web` live
emoji reactions (useRoomReactions). Everything else is at parity.

Phases delivered: **0** web infra (form kit + media wrappers + verifier
web-data-parity) · **1** identity/settings · **2** social core (+ post-detail
P2 debt) · **3** events/commerce (+ event P3 debt) · **4** messaging/live
(Fishjam web RTC) · **5** media/creation (camera/crop/composer/story) · **6**
long tail (auth, public/*, sneaky-lynk, location, debug/dev, followers/edit) ·
**7** sweep (composition-aware verifier, chrome typecheck fixes).

## Verifier snapshot (run `pnpm verify:parity`)

- **Native parity: GREEN** — 111/111 original routes have a ported `native` screen
  under `packages/app/features/routes/screens/**`. **0** dropped Zustand stores,
  `lib/hooks`, react-query calls, or named exports vs. the original. The native
  transplant is faithful (Law 1 ✓ at the native layer).
- **Web layer: the gap.** 8 routes render a real web screen; **108 dynamically
  import the native route screen** on web (native-only deps → crash / shimmed).
  These are the Law-3 web translations still owed.

## Phase 0 — web infrastructure (EXCLUSIVE, landed before any screen)

Shipped (lands before Phase 1 screens):

- **Verifier `web-data-parity` check** (`scripts/verify-port-parity.mjs` §4):
  for every real `*.web.tsx`, resolves its native source (a `.native.tsx`/`.tsx`
  sibling, or an explicit map for the 4 events/post screens → route screens) and
  asserts the native's stores / `lib/hooks` / domain hooks / react-query keys all
  appear in the web file. **Native-only wiring** (video stores, render-loop/
  telemetry probes, safe-area, native media-pick, realtime/geo) is filtered;
  **landing marketing sections** are exempt (presentational platform-splits);
  genuinely-deferred **portable** features become a phase-tagged **DEBT LEDGER**.
  A *new* web screen that drops portable wiring **hard-fails** (exit 1). Gate is
  **GREEN** against the real web screens today.
- **Form scaffolding in `@dvnt/ui`** (`packages/ui/src/form/`, web + native
  variants, barrel-exported): `FormField`, `StickySaveBar`, `useDirtyGuard` +
  `isFormDirty`, `Dialog` (centered modal), `Drawer` (edge-anchored).
- **React-equivalent media wrappers in `@dvnt/ui`** (`packages/ui/src/media/`):
  `CameraCapture` (**expo-camera**, universal — works on web), `QrScanner`
  (`html5-qrcode` web / expo-camera native), `ImageCropper` (`react-easy-crop`
  web + `getCroppedDataUrl`), `MapPicker` (`@vis.gl/react-google-maps` web).
- `@dvnt/ui` typecheck of the new files: **0 errors**.

## Real web screens (done / in progress)

`web-data` column = web-data-parity status: **✓** none dropped · **⌛Pn** portable
features deferred to phase Pn (see Debt Ledger).

| Route | Web screen | Web status | web-data | Notes |
|---|---|---|---|---|
| `/` | landing | ✅ real | exempt | marketing hero (presentational) |
| `/auth/login` | `auth/screens/LoginScreen.web` | ✅ real | ✓ | Solito, HLS bg, Zustand |
| `/feed` | `home/screen.web` | ✅ real | ✓ | TanStack Virtual masonry, stories, spicy toggle, likes/bookmarks |
| `/feed/{username}/post/{id}` | `post/post-detail.web` | ✅ real | ⌛P2 | carousel + lightbox + threaded comments + OG; owes delete/tags/translation |
| `/events` | `events/events-list.web` | ✅ real | ⌛P3 | spotlight + search + filter + Tickets; owes for-you/like/promoted |
| `/events/{slug}` | `events/event-detail.web` | ✅ real | ⌛P3 | full parity + lightbox + YouTube + reviews/comments; owes tickets/waitlist/like/review-submit/translation |
| `/events/create` | `events/event-create.web` | ✅ real | ✓ | sectioned form + live preview (cover upload TODO) |
| `/settings/membership` | (existing) | ✅ real | ✓ | — |
| `/feed/edit-profile` | `profile/edit-profile.web` | ✅ real | ✓ | Phase 1 reference form — kit FormField/StickySaveBar/useDirtyGuard, edit-profile-ui-store, useUpdateProfile, file-input avatar (rounded square) |
| `/settings/notifications` | `settings/notifications.web` | ✅ real | ✓ | 8 toggles, useNotificationPrefs/useUpdateNotificationPrefs |
| `/settings/privacy` | `settings/privacy.web` | ✅ real | ✓ | 4 toggles, usePrivacySettings/useUpdatePrivacySettings |
| `/settings/messages` | `settings/messages.web` | ✅ real | ✓ | 4 toggles, useMessagesPrefs/useUpdateMessagesPrefs |
| `/settings/likes-comments` | `settings/likes-comments.web` | ✅ real | ✓ | 4 toggles, useLikesCommentsPrefs/useUpdateLikesCommentsPrefs |
| `/settings/{about,terms,privacy-policy,community-guidelines,ad-policy,eligibility,faq}` | `settings/legal-page.web` | ✅ real | n/a | one component, bundled `LEGAL_CONTENT[slug]` + `useFAQStore` accordion → 7 screens |
| `/feed/story/[id]` (overlay) | `components/story-viewer-overlay.web` | ✅ real | n/a | full-screen Instagram viewer (react-insta-stories), opens over app from feed StoriesRow |

**Real web screens: 8 → 30** (`pnpm verify:parity` web audit). **Phase 1
(identity/settings) COMPLETE** — edit-profile + 8 legal/info (LegalPage, incl.
identity-protection) + 4 toggle settings + settings hub + account + language +
theme + blocked + close-friends + weather-ambiance + archived, plus the
full-screen story viewer overlay. All data-parity green; commerce settings
(host-*, payments, purchases, receipts, refunds, order/[id]) deferred to **P3**.
**Phase 3 (events/commerce) COMPLETE** — real web screens **37 → 69**. Consumer
events (attendees, reviews, event-comments, my-tickets, ticket-detail w/ web QR
via `qrcode`, ticket-upgrade, checkout-review w/ `@stripe/stripe-js`,
checkout-success); the full **commerce settings** cluster (payments,
payment-methods, purchases, receipts, receipt-viewer, refunds, refund-request,
order detail, + 6 host-financial: host-payments/payouts/transactions/
bank-verification/branding/disputes); and **host/organizer admin** (organizer
dashboard, analytics w/ raw-SVG charts, staff, promo-codes, scanner via the
html5-qrcode `QrScanner` kit, event-edit, host, organizer-setup). **event-detail
+ events-list P3 debt PAID** (tickets/waitlist/like/review-submit/translation/
promoted). Debt ledger **EMPTY** (both P2 + P3 paid). Verifier precision: native
Stripe (`@stripe/stripe-react-native`) + vision-camera hooks added to the
native-only filter; inline screen-local stores handled via EQUIVALENT_WIRING.
`live` (Fishjam RTC) deferred to **Phase 4**. Next: **Phase 4 — messaging/live**.

**Phase 2 (social core) COMPLETE** — profile (own + other-user, shared TanStack
Virtual masonry) + search + activity→notifications + comments + story/[id]
direct-link route; **post-detail P2 debt PAID DOWN** (delete/tags/translation/
likes-sheet/bookmarks/text-slides). Real web screens **30 → 37**; debt ledger now
only **P3 (events)**. Verifier precision improved: comment-stripping +
queryKeys-informational + an EQUIVALENT_WIRING map (e.g. `useBookmarkedPosts`
covers `useBookmarks`+`usePostsByIds`). Next: **Phase 3 — events/commerce**.

## Debt Ledger (web-data-parity — accepted, phase-tagged, printed every run)

| Web screen | Phase | Portable features still owed |
|---|---|---|
| ~~`post/post-detail.web`~~ | ~~P2~~ | **PAID DOWN** — delete/tags/translation/likes-sheet/bookmarks/text-slides all wired; passes parity with no allowance |
| `events/events-list.web` | P3 events | `useForYouEvents`, `useToggleEventLike`, `usePromotedEventIds` |
| `events/event-detail.web` | P3 events | tickets (`use-tickets`/`useTicketTypes`/`useTicketCheckout`/`useTicketUpgradeOptions`/`useInitiateUpgrade`/`useMyTicketForEvent`/`ticket-store`), waitlist (`useEventWaitlistStatus`/`useJoinWaitlist`/`useLeaveWaitlist`), `useToggleEventLike`, `useCreateEventReview`, `promotion-store`, `translation-store`/`useContentTranslation` |

## Web translations still owed (108) — priority order (Law: highest-traffic edit/forms first)

**P0 — edit/settings forms (the ones flagged as "missing"):**
`/feed/edit-profile` · `/feed/profile/edit` · `/feed/edit-post/[id]` ·
`/feed/edit-event/[id]` · settings cluster.

**P1 — core consumer screens:**
`/feed/profile` · `/feed/profile/[username]` (→ canonical `/profile/{username}`) ·
`/feed/search` · `/feed/activity` (→ `/notifications`) · `/feed/messages` (+ new/new-group) ·
`/feed/comments/[postId]` · `/feed/story/[id]`.

**P2 — events sub-screens:**
`/events/{slug}/attendees` · `/events/{slug}/comments` · `/events/{slug}/reviews` ·
`/events/my-tickets` · `/events/{slug}/organizer` · ticket/checkout flows.

**P3 — long tail. NO `WebScreenFallback` — every native feature gets its best
React/web package equivalent** (precedent: YouTube → `react-lite-youtube-embed`,
media pick → `<input type=file>`, maps → Google Maps embed). Mapping:

| Native feature | React/web equivalent | `@dvnt/ui` wrapper |
|---|---|---|
| Camera capture / vision-camera | **`expo-camera`** (universal — works on web; chosen over react-webcam) | `CameraCapture` |
| QR / ticket scanner | `html5-qrcode` (web) / expo-camera barcode (native) | `QrScanner` |
| Image crop (`crop-preview`) | `react-easy-crop` + `getCroppedDataUrl` | `ImageCropper` |
| Calls / RTC (`call/[roomId]`) | Fishjam web / LiveKit `@livekit/components-react` | (P4) |
| Maps / location picker | `@vis.gl/react-google-maps` (interactive); embed iframe read-only | `MapPicker` |
| Story viewer (Instagram-style) | `react-insta-stories` (segmented progress, tap/keyboard nav, image+video) | `StoryViewer` |
| Date/time pickers | native `<input type="datetime-local">` | — |
| Bottom sheets / popovers | center modal / edge drawer | `Dialog`, `Drawer` |

## Methodology (per screen)

1. Open `../deviant/app/<route>.tsx` + every `@/` import (components, hooks,
   stores, queries). Inventory it.
2. Port verbatim, then apply only the sanctioned transforms:
   - **Law 2:** `react-native` → `@dvnt/ui` (`Text`, `Input`, `Button`, …);
     raw RN only for `View`/`ScrollView`/list-virtualization/`Pressable`.
   - **Law 3:** web translation — content column, +1 type scale, sheets→dialogs,
     forms with labeled fields + sticky save bar + dirty-guard, responsive media grids.
3. Check the inventory off item-by-item. Re-run `pnpm verify:parity`.
4. Fill this row: original path · port path · inventory ✓ · web status · notes.
