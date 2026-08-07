# Events & Ticketing Premium Bar — Phase 0 Gap Matrix

**Audited tree:** branch `sneaky-lynk-web-capture-hardening` @ `c917661` (2026-08-05). The prompt referenced `master`; this branch is ahead of it and was treated as ground truth — reconcile before branching workstream PRs.
**Method:** six parallel audit lanes (payments/payouts, schema-from-migrations, feature surfaces, media/background, offline/state, auth/sign-up), 2026-08-06. Migrations at `apps/mobile/supabase/migrations/` are the schema authority. Edge functions confirmed at `apps/mobile/supabase/functions/` (`stripe-webhook/index.ts` = 1,874 lines).
**Required docs:** all six exist and were read. `prompts/ROSTER.md` does not exist (roster is embedded in the prompt). `TASKS.md` contains **no events sections** — it tracks membership/webhook hardening; the events roadmap doc is `docs/event-creation-audit.md` (Phases 0–2 signed off 2026-06-20).

---

## 1 · Stop-and-report findings (spec vs. reality)

These contradict §2 of the prompt and require sign-off on the reconciled reality before workstream code:

1. **Lifecycles are 5-state, not 16/15.** `events.status` CHECK = `('draft','active','cancelled','postponed','suspended')` (`20260519153920` / `20260519181000`); `tickets.status` CHECK = `('active','scanned','refunded','void','transfer_pending')` (`20260328_ticket_transfers.sql`). Payment-pending lives on `ticket_holds ('active','converted','expired')` and `carts ('draft','holding','paying','completed','abandoned')`, and `orders.status` has 7 states — the "16-state event / 15-state ticket lifecycle" from the earlier prompt suite does not exist in this schema. **Proposal: extend the real machines, do not invent the fictional ones.**
2. **Event cohosts already exist.** `event_co_organizers.role` CHECK `('viewer','scanner','editor','admin')`; the `admin` role is labeled "Co-host" in `packages/app/features/events/staff.web.tsx:60-64` with owner-only grant and server-side `callerRole` enforcement via `lib/api/privileged/index.ts`. The spec's "only Sneaky Lynk has cohost code" is wrong (Sneaky Lynk's cohost is a live co-broadcaster — unrelated concept). WS-1 is an extension (promoter role, ownership transfer, logged-out invite links), not a build.
3. **CRITICAL — identity bridge is inconsistent, and two functions trust the client.** Three mechanisms coexist: `_shared/verify-session.ts` (~56 fns), the same lookup duplicated inline (~52 fns), and `mint-supabase-jwt` (1h HS256 JWT, `sub` = BetterAuth id) for PostgREST RLS. **`bootstrap-feed/index.ts:211` and `get-post-likers/index.ts:37-76` verify nothing — client-supplied identity with service-role reads.** WS-1 permissions and WS-5 money paths sit on this bridge; consolidation is a prerequisite (see §4).
4. **Apple guideline renumbered.** Current **3.1.3(e)** (verified 2026-08-06, developer.apple.com/app-store/review/guidelines): apps selling physical goods/services consumed outside the app **"must use purchase methods other than in-app purchase."** Stripe-in-app for tickets is not merely allowed — IAP is prohibited for them. 3.1.5 is now "Cryptocurrencies"; cite 3.1.3(e) only.
5. **I5 is partial, and the payments audit doc is stale.** The monotonic guard exists on the sub-created/updated path (`stripe-webhook/index.ts:1330-1353` → `upsert_membership_subscription`, SQL guard `20260630120000:151-152`) but `customer.subscription.deleted` (:1468-1476) and `invoice.payment_failed` (:1517-1537) update `membership_subscriptions` directly with no guard, and the legacy `sneaky_subscriptions` upsert (:1391-1413) is unguarded. `doc/existing-payment-audit.md:19` still says "I5 GAP" (pre-fix snapshot); its "`dispute.*`" is really only `charge.dispute.created|closed`. Webhook is 1,874 lines, not 1,866.
6. **Capacity-below-sold guard triggers were never applied to production.** `20260613001000_capacity_below_sold_guards.sql` header: "NOT YET APPLIED TO PRODUCTION — awaiting Wave-2 authorization." Also: `20260614234005` (promo BOGO) was applied out-of-band and back-recovered; `20260805130000_reconcile_prod_function_drift.sql` exists — prod/migration drift is a live phenomenon here.
7. **`apps/web-vite` has no auth** — it is a Payload CMS shell (`src/` = `payload.config.ts` + `environment.d.ts`). WS-13's "all three clients" e2e scope is really two clients (Next web + native).
8. **Client passkey plugin has no server counterpart.** `passkeyClient()` registered in `packages/auth/src/client.web.ts:46` and `client.native.ts:42`, but the server config (`functions/auth/index.ts:245-271`) mounts only `expo(), username(), magicLink()` — passkey routes 404.
9. **Event hard-delete has no refund logic.** `event-action-sheet.tsx:318-326` → `lib/api/events.ts:992-1124` client-side cascade delete; nothing refunds paid orders on delete. The only refund path on cancel is manual bulk (`refund-confirm-modal.tsx`). Hazard until WS-9 lands.

---

## 2 · Decisive Phase 0 answers

| Question (from prompt §2) | Answer |
|---|---|
| `promotion-types.ts` — boosts or promoters? | **Boosts.** `SpotlightCampaign` paid placement (spotlight/feed, $9.99–$39.99) paid via Stripe PaymentSheet. Zero promoter-economy code (only a comp-ticket display string `"Guest of @{ticket.promoter}"`). WS-4 builds promoters **alongside** boosts with distinct naming. |
| Guest identity model | **Email-keyed on the order row** (`orders.user_id` nullable + `guest_email` + `orders_user_or_guest` CHECK, `20260423`) plus unguessable per-ticket tokens (`guest_lookup_token`, public route `(public)/tickets/guest/[token]` → `get-guest-ticket`, `requireAuth:false`). Free RSVP = email OTP (`rsvp-verify` → `rsvp-issue-guest`). No anonymous user rows. **Guest→account claim does not exist** (nudge-only, `guest-ticket.web.tsx:359-368`). |
| Bunny Stream provisioned? | **No.** Edge Storage + `dvnt.b-cdn.net` pull zone only; zero TUS/`video.bunnycdn` hits; Bunny Optimizer verified off (c917661). Provisioning Stream is an account action prerequisite for WS-10 video. |
| netinfo vs `expo-network` | **`expo-network` ~57.0.0**, sole consumer `lib/stores/connectivity-store.ts` (flap-debounced), already bridged to TanStack `onlineManager` (`_layout.tsx:150-163`). netinfo not installed. Web has **no** connectivity detection. |
| MMKV vs SQLite vs AsyncStorage | **MMKV** (`react-native-mmkv` 4.3.1) via `lib/mmkv-zustand.ts` ("NEVER AsyncStorage"). SQLite and AsyncStorage not installed. |
| TanStack Query installed? | **Yes, v5** (~5.99–5.101 across packages) with `PersistQueryClientProvider` on native (MMKV) and web (localStorage), `onlineManager` + `focusManager` wired. **Mutations deliberately not persisted** (`query-persistence.ts:79-81`); no paused-mutation machinery. |
| `expo-file-system` API surface (SDK 57) | 57.0.0 installed; **legacy API at ~25 call sites** (`expo-file-system/legacy`: `uploadAsync`, `getInfoAsync`…); new `File`/`Paths` API only in `stories-editor/screens/EditorScreen.tsx:512-513`. No background upload sessions anywhere. |
| Ticket-rail law | Encoded per finding §1.4 — Stripe on every platform for tickets/add-ons, per Apple 3.1.3(e) + `doc/processor-risk.md`. |
| Scanner queue → outbox? | **Recommendation: keep `offline-checkin-store` dedicated** (it's shaped for scan reconciliation) but drive it from the same shared auto-drain subscriber the new outbox uses (connectivity-store phase→online + AppState foreground). Today drain is **manual-only** (organizer button → `ticketsApi.syncOfflineScans`). |

---

## 3 · Workstream gap matrix

Verdicts: ✅ EXISTS · ◐ PARTIAL · ✗ MISSING. Citations are `packages/app/...` canonical (mirrored in `apps/mobile`).

### WS-1 Hosts, cohosts & staff
| Item | Verdict | Evidence |
|---|---|---|
| Role model + permission matrix | ◐ | `event_co_organizers ('viewer','scanner','editor','admin')`; server-enforced via privileged wrappers (`privileged/index.ts:315,522`); UI `staff.web.tsx:50-92`. `scanner` ≈ door_staff (keep the name). |
| BetterAuth org/role plugin | ✗ | Server plugins are only `expo(), username(), magicLink()` (`functions/auth/index.ts:245-271`). Decision needed: add BetterAuth org plugin vs. keep `event_co_organizers` as the grant store fronted by BetterAuth sessions (recommended — smaller blast radius, already server-enforced). |
| Promoter role | ✗ | No enum value, no tables (see WS-4). |
| Cohost invite deep link (logged-out → auth → accept) | ✗ | `event_invites` table exists (pending/accepted/declined) but no deep-link accept flow; `returnTo` is web-only and unused by invite flows (`lib/auth/return-to.ts`). |
| Ownership transfer | ✗ | Owner = `events.host_id`; no transfer path. |
| Server-side deny tests | ✗ | None found for permission matrix. |

### WS-2 Ticket architecture
| Item | Verdict | Evidence |
|---|---|---|
| Tiers: capacity/price/windows | ✅ | Schema `20260301`+v2 `20260613000000`; UI `TicketTiersEditor` (`event-create.web.tsx:1092`), full CRUD in edit (`event-edit.web.tsx:141-159`). |
| Early-bird auto-rollover | ◐ | **Schema exists** (`price_schedule` jsonb time-gated + `sub_allocations` quantity bands + `ticket_type_current_price_cents()`), mirrored in `pricing.ts:73-93`. No create/edit UI. |
| Hidden/code-unlocked tiers | ◐ | **Schema exists** (`visibility ('public','hidden','locked')` + `unlock_code` + `unlocks_after_tier_id`). No UI, no checkout unlock path. |
| Group bundles | ◐ | `tier_type 'group_bundle'` enum + named/group order cols (`20260613002000`: `order_index/order_count/attendee_name/claimed_by`). No UI. |
| Ticket transfer | ✅ | `initiateTransfer` 24h expiry (`ticket-detail.web.tsx:409-435`), accept/decline (`my-tickets.web.tsx:188-227`), `transfer_pending` status. |
| Waitlist + auto-offer | ◐ | `event_waitlist` (`20260422`, per-tier, user-or-guest, `notified_at`) + join/leave UI (`use-event-waitlist.ts`, sold-out CTA). **Capacity-release auto-offer + expiry/re-offer: missing.** |
| Oversell impossibility | ◐ | `cart_create_hold`/`cart_complete_issuance` RPCs use `FOR UPDATE` row locks; but capacity-below-sold triggers unapplied to prod (§1.6) and **no race test exists**. |

### WS-3 Add-ons & upgrades
| Item | Verdict | Evidence |
|---|---|---|
| Add-on catalog schema | ✅ | `ticket_addons` (`20260613000100`): 7 addon_types, `binding_mode`, inventory, `requires_tier_id`, `is_redeemable`; `ticket_addon_variants`; `order_addons` with own `qr_token`/`redeemed_at`; `FOR UPDATE` hold/issuance RPCs (`20260613000200/300`). |
| Add-on UI (host catalog mgmt, checkout upsell, post-purchase) | ✗ | `ticket-upgrade.web.tsx` is tier-change-pay-difference only; `category 'product'` labeled "Add-on" in `lib/api/ticket-types.ts:35-55` but no catalog surface. **WS-3 is UI + checkout wiring on an existing backend.** |
| Add-ons validate at door | ◐ | `order_addons.qr_token/redeemed_at` exist; scanner has no add-on resolution UI. |

### WS-4 Promoter economy
Everything ✗ — no attribution tables, no rev-share ledger, no tracked links, no leaderboard (`analytics.web.tsx` has promo-code performance only). Boosts (`event_spotlight_campaigns`, 8-status) stay as-is; promoters are net-new schema + edge fns + UI (see §4 migrations).

### WS-5 Payments
| Item | Verdict | Evidence |
|---|---|---|
| Destination charges + application fee | ✅ | `ticket-checkout:416,430-434`, `guest-checkout:167,189-190`, `cart-checkout:348-350`, `create-payment-intent:388-396`; fee math `_shared/fee-calculator.ts` (invariant check :78-84). Server recomputes price from DB rows everywhere. |
| Refunds | ◐ | Buyer `ticket-refund`; host `organizer-refund` (**whole-PI only**, :18-20); line-level partial `cart-line-refund` (idempotency-keyed, :227-251); `bulk-refund-tickets`; webhook allocation-failure auto-refund (:152-175). No host-configurable policy windows, no cohost-permission gating. |
| Dispute UI | ✅ | `features/settings/host-disputes.web.tsx` + native, fed by `host-disputes` fn; webhook handles created/closed. |
| Radar surfacing | ◐ | `order_timeline` fraud rows + organizer push (:1811-1871); no host-facing list; no guest-order weighting. |
| Absorb-vs-pass | ◐ | `fee_mode 'absorb'` implemented **only on guest-checkout rail** (:158-161,198); no host toggle; buyer display shows single "DVNT service fee", processor fee not itemized (`checkout-review.web.tsx:235-263`). |
| ACH / bank-wire | ✗ | No `us_bank_account`, no `customer_balance` anywhere. **No `payment_intent.processing` handler.** ⚠️ Risk: `create-payment-intent` enables `automatic_payment_methods` — a dashboard-toggled delayed method would strand orders in `payment_pending` today. |
| Async-settlement hold state | ✗ | `orders.payment_pending` is the synchronous pre-confirmation window only; `ticket_holds` expiry is minutes-scale. Multi-day bank-transfer hold = new lifecycle work on the **real** machines (holds/carts/orders), not tickets. |
| Free RSVP off Stripe | ✅ | `issue_rsvp_ticket` / `issue_guest_rsvp_tickets` RPCs. |

### WS-6 Payouts
| Item | Verdict | Evidence |
|---|---|---|
| Connect onboarding states | ◐ | `organizer-setup.web.tsx:178-213,331-335` renders checklist + restricted + pending-verification; but `account.updated` persists only 3 booleans (:1294-1301) — `requirements.currently_due`/deadlines come from live `organizer-connect` lookups, not stored. |
| Balance / history | ◐ | `host-payouts.web.tsx` renders 6 payout statuses + bank last4; `event_financials` table. |
| Instant payouts | ✗ | `payouts-release/index.ts:222` = `/v1/transfers` on cron; standard schedule only. |
| `payout.failed` recovery | ✗ | Webhook notifies (:1768-1809); UI shows "Failed" chip, no recovery flow. |
| Split ledger (cohost/promoter) | ✗ | 100% of `organizer_transfer_amount` to one `stripe_account_id` (`payouts-release:204-231`). |

### WS-7 Guest delight
| Item | Verdict | Evidence |
|---|---|---|
| OG share cards | ✗ | No satori/@vercel/og anywhere; static site-wide `opengraph-image.jpg`; **no `generateMetadata` on event pages**. |
| Email blasts / reminders | ◐ | Push blast exists (`broadcast-modal.tsx`, rate-limited); **no email blasts**; Resend used only for auth/ticket mail. SMS = stop-and-ask (none installed). |
| RSVP social proof | ◐ | Attendee counts on detail; no mutuals surface. |
| .ics / calendar | ✅ | Native expo-calendar (`src/ticket/helpers/add-to-calendar.ts`); web .ics download (`ticket-detail.web.tsx:~400`). |
| Wallet passes | ✅ | Apple signed `.pkpass` + Google Save via edge fns (`src/ticket/helpers/add-to-wallet.ts:1-11`); `wallet_serial_number` etc. on tickets (`20260335`). Guests get nudged to create an account instead of a pass — gap. |
| Ticket reveal motion | ✗ | No Reanimated reveal moment. |
| Guest email delivery | ◐ | Webhook emails QR + lookup link (`guest-checkout` header comment); no Wallet-pass link, no `.ics`, **no magic-link claim** in that mail; guest re-request by email lookup missing. |
| Guest→account claim | ✗ | §2 answer; magic-link claim is net-new (BetterAuth magic-link plugin exists as the primitive). |

### WS-8 Door ops
| Item | Verdict | Evidence |
|---|---|---|
| Scanner surfaces | ✅ | Web html5-qrcode via `@dvnt/ui QrScanner`; native VisionCamera lazy-loaded (`(protected)/events/[id]/scanner.tsx:45-53`). |
| Offline scan queue | ◐ | `offline-checkin-store.ts` (token-hash allowlist download + queued scans, MMKV-persisted); **drain is manual-only** (`organizer.web.tsx:301-306` → sequential `ticket-scan` invokes). Duplicative older util `lib/utils/offline-scanner.ts` (own MMKV id) should be folded in. |
| Double-scan | ◐ | Client cooldown + server `already_scanned` branch + `checkins` audit table (`result` enum, `offline` flag). **No DB-level constraint** — application-level only. |
| Per-tier + add-on door validation | ◐/✗ | Tier name displayed on result; no gate/entrance rules; no add-on redemption UI. |
| Live door counts | ✅ | `event-live.web.tsx` "War Room": realtime PG subscription + 30s poll fallback, scans/min chart, role-gated. |
| Holder QR offline | ✗ | Query-persistence whitelist includes `"events"` **not** `"tickets"` (`query-persistence.ts:42-53`); no persist on `ticket-store.ts` — a holder's QR is not available cold/offline. WS-11 prefetch job fixes this. |

### WS-9 Manage & polish
Drafts ✅ (MMKV `create-event-draft`, `create-event-store.ts:413-425`; also post/comment/review draft stores). Duplicate-event ✗. Postpone UI ✗ (statuses exist in schema). Cancel-with-auto-refund ✗ — **hard delete with zero refund logic is the current destructive path** (§1.9). Edit parity ◐ (no UI for hidden tiers/schedules/add-ons since none exists anywhere).

### WS-10 Media
| Item | Verdict | Evidence |
|---|---|---|
| Crop / stories-editor / gpu modules | ✅ | `src/crop` (pure EditState → expo-image-manipulator export), `src/stories-editor` (exports `EditorScreen`/`useEditorStore`), `src/gpu` (singleton WebGPU runtime). Extend, don't fork. |
| Client compression | ✅ | `lib/video-compression.ts` (react-native-compressor H.264 720p ~1.8Mbps), `lib/media/image-processor.ts` (WebP); "RAW VIDEO MUST NEVER BE UPLOADED" (`use-media-upload.ts:1-17`). |
| Upload path | ◐ | Single multipart POST → `media-upload` edge fn → Bunny Edge Storage; caps 12–50MB, 60s max (`media-upload/index.ts:57-81`); no TUS/chunking/resumable. ⚠️ Bug: `folderToKind` (`server-upload.ts:84-95`) has no events video entry → **flyer videos upload as `post-video` (25MB cap)** instead of event-moment (50MB). |
| Video flyers | ◐ | Upload + playback exist (native `create.tsx:1498-1568` "image or video, 3:5, 60 sec"; web two-slot flyer+poster `event-create.web.tsx:192-218`; autoplay-muted-loop `event-detail.web.tsx:492-506`). No HLS, progressive MP4 only. |
| Bunny Stream / HLS / transcode / poster | ✗ | Not provisioned (§2). Server generates zero thumbnails (no ffmpeg in Deno); `backfill-thumbnails` is report-only; blurhash NULL on all 1,350 prod rows; ~97 HEIC/QuickTime assets browser-undecodable; `resolve-renderable.ts` (single resolver, "posterUrl NEVER a video URL") has **zero production consumers wired**. |
| Background upload sessions | ✗ | No `createUploadTask`/background session anywhere; legacy FS API at ~25 sites. |
| Web media delivery | ◐ | Raw `<img>`/`<video>`, no srcSet (moot: Optimizer off); CLS decent via fixed aspect boxes. |

### WS-11 Background tasks
✗ across the board — no `expo-background-task`, `expo-task-manager`, `expo-background-fetch`, or `react-native-background-*` installed; zero `defineTask`/`registerTaskAsync` hits. Greenfield; the four jobs (scan flush, ticket prefetch, upload watchdog, outbox drain) all have their foreground counterparts identified above.

### WS-12 Offline & outbox
| Item | Verdict | Evidence |
|---|---|---|
| Connectivity primitive | ◐ | `connectivity-store.ts` (native, debounced, `onlineManager`-bridged). Web: nothing. |
| Durable queue | ✗ | Only the scan queue; no general outbox. |
| Optimistic precedents | ✅ | `use-events.ts:306+` onMutate/rollback; chat `MessageStatus sending/sent/failed` + retry (`chat-store.ts:104,424-437`); bookmarks. |
| Idempotency | ◐ | Client-minted UUID on carts only (`cart.ts:52` → Stripe `Idempotency-Key`); other fns rely on natural idempotency (ON CONFLICT). No general scheme, no server dedupe table for mutations. |
| Drafts | ✅ | See WS-9. |
| Read-side offline | ◐ | Persisted query cache (30-min maxAge, whitelisted prefixes, OTA buster) — but no `"tickets"` prefix (WS-8 gap). |
| **Build recommendation** | — | MMKV-persisted Zustand outbox store (clone `offline-checkin-store` + `mmkv-zustand` pattern, own MMKV id); drain on connectivity-store→online + AppState foreground; per-entity FIFO, retained-on-failure; UUID idempotency key per entry (extend `cart.ts:52` precedent) + server dedupe table modeled on `stripe_events`. **Do not adopt TanStack paused mutations** — persister strips mutations by design; keep onMutate as UI layer, outbox as durability layer. First consumers: auto-drain `pendingScans`, then like/RSVP/bookmark. |

### WS-13 Sign-up & auth wiring
| Item | Verdict | Evidence |
|---|---|---|
| Server + plugins | ✅ | Single server `functions/auth/index.ts` (better-auth 1.5.5, raw pg.Pool); plugins `expo(), username(), magicLink(15min)`; google+apple social; beta-gate allowlist hook. Next mounts via rewrite proxy (`next.config.ts:139`, same-origin cookies). |
| Identity bridge | ◐/⚠️ | Three mechanisms; two unauthenticated fns (§1.3). Consolidation onto `verifySession` + documented JWT bridge is prerequisite work. |
| Clients | ◐ | Web cookie client; native expoClient + SecureStore (30d/1d refresh). Duplicate legacy `auth-client.ts` copies. web-vite: none (§1.7). Passkey mismatch (§1.8). |
| Sign-up steps | ✅ | Step1 personal (18+ gate) → Step2 `signUp.email` + Didit ID-scan DOB compare → Step3 terms. Didit gate = `"Approved" → "passed"` (`didit-webhook:70-71`) — matches standing knowledge. |
| Progressive profile completion | ✗ | Static step dots only; no completion score. (Mechanism is Mike's — coordinate, don't redesign.) |
| Magic-link native cold-open | ◐ | `scheme:"dvnt"` + `applinks:dvntapp.live` configured, but verify URL is on the supabase.co host → browser bounce → scheme hand-off, not direct universal link; `route-registry.ts:212` registers magic-link routes only for guest tickets. |
| Deliverability | ✗ | `docs/branded-email-fit.md:193`: no SPF/DKIM/DMARC under a DVNT domain. Resend button has no cooldown (`VerifyEmailScreen.web.tsx:81,95`). |
| returnTo | ◐ | `lib/auth/return-to.ts` exists (open-redirect-safe) but web-only and unused by checkout/invite flows. |

---

## 4 · Proposed migrations & schema-adjacent work (approval requested)

New migrations (all through single-write-path security-definer fns, RLS-denied cross-host, per Law 1):

1. **Promoters (WS-4):** `event_promoters` (event_id, user_id nullable for external, code UNIQUE per event, rev_share_bps, status), `promoter_attributions` (order_id UNIQUE, promoter_id, locked at order time), `promoter_ledger_entries` (earning/reversal rows, transfer refs, reconciled against `transfer.reversed`). Distinct naming from boosts.
2. **Roles (WS-1):** add `'promoter'` to `event_co_organizers.role` CHECK **or** keep promoters solely in `event_promoters` (recommended — promoters aren't staff); ownership-transfer function (audited `events.host_id` swap); keep `scanner` as the door role (no rename migration).
3. **Async settlement (WS-5):** long-expiry hold variant on `ticket_holds`/`carts` for `bank_transfer`/`us_bank_account` (days-scale `expires_at`, released by cron + webhook); add `payment_intent.processing` handling writing `orders.payment_pending` provenance; add monotonic guard column (`last_event_at`) + guarded upsert for orders money-state (closes the orders-side I5 analog).
4. **I5 completion (code, not schema):** route `customer.subscription.deleted` / `invoice.payment_failed` / `sneaky_subscriptions` writes through the guarded upsert.
5. **Door integrity (WS-8):** DB-level single-check-in enforcement (compare-and-swap `UPDATE tickets SET status='scanned' WHERE status='active'` returning row, or trigger) so double-scan protection stops being app-only.
6. **Capacity guards:** apply `20260613001000` triggers to prod (needs the "Wave-2 authorization" — explicit approval item).
7. **Guest claim (WS-7/13):** security-definer `claim_guest_orders(user_id)` matching verified email → re-parent orders/tickets; invoked from BetterAuth magic-link callback.
8. **Outbox dedupe (WS-12):** `client_mutations` dedupe table (idempotency_key UNIQUE, entity ref, result ref) modeled on `stripe_events`.
9. **Fee mode (WS-5):** `events.fee_mode ('absorb','pass')` host toggle, honored by `fee-calculator.ts` on all rails (today guest-checkout only).
10. **No lifecycle-count migrations** — extend the real 5-state machines (postpone/cancel flows use existing statuses).

No-migration workstreams (schema already there): add-ons UI/checkout (WS-3), hidden/locked tiers UI + unlock path, early-bird schedule UI, group-bundle UI, waitlist auto-offer (needs `notified_at`-driven offer expiry — possibly one `offer_expires_at` column), Wallet-link + `.ics` + claim-link in guest email.

## 5 · Non-code prerequisites / stop-and-ask items

- **Bunny Stream provisioning** (account action) — blocks WS-10 video pipeline.
- **SPF/DKIM/DMARC on a DVNT sending domain** (Resend dashboard + DNS) — blocks WS-7 guest email trust and WS-13 deliverability.
- **SMS provider** — per prompt: stop-and-ask (nothing installed).
- **Wave-2 authorization** for capacity guard triggers (§4.6).
- **ID-scan placement** — product decision; options to be surfaced with funnel data, not moved unilaterally.
- **Unauthenticated edge fns** (`bootstrap-feed`, `get-post-likers`) — security fix should land ahead of, or with, WS-1.

---
*Phase 0 halt: per prompt §4, workstreams begin only after approval of this matrix and the §4 migration list.*
