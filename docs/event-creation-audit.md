# Event Creation — Audit, Diagnosis & Proposal (PROMPT 20)

**Status:** Phase 0 (audit) + Phase 1 (proposal) complete — **awaiting sign-off before Phase 2 build.**
**Date:** 2026-06-20
**Scope:** Unified event-creation flow across mobile (Expo) + web (Next).

> The ask: *"make creating events easy."* The owner is unsure exactly what's wrong — it may be design, there may be missing fields. So this is **audit → diagnose with evidence → propose → sign off → build**, not a blind redesign.

---

## 0. TL;DR

There are **two different create flows that share only the draft store and the final `createEvent` mutation**:

- **Mobile** (`packages/app/features/routes/screens/(protected)/events/create.tsx`, 2676 lines) — a polished **6-step wizard** (Info · Media · Venue · Details · Terms · Review) capturing ~30 fields, with draft autosave, multi-tier ticketing, co-organizers, a Stripe-Connect gate and a $2 price floor.
- **Web** (`packages/app/features/events/event-create.web.tsx`, 314 lines) — a **single-page "lite" form** capturing ~10 fields. It is missing most enrichment fields **and has two correctness bugs that make it not actually work for real events** (blob-URL cover images that don't resolve server-side; no ticket-type rows created for paid events).

The data model is **far richer than either form** — the `events` table has ~45 columns and a full tiered-ticket + add-on + promo model already exists. The shared draft store already *defines* most of the rich fields (co-organizers, tiers, age, dress code, etc.); the **web form just never wires them up**. So the gap is overwhelmingly in the **create FORM**, not the data layer.

**Headline problems:** (1) web is non-functional for real events (media + tickets), (2) mobile silently drops 3 fields it collects (`category`/tags, `event_type`, `location_address`), (3) the two platforms diverge massively (parity), (4) a few UX dead-ends (virtual-event location, silent "Next", step not restored).

---

## 1. As-Is Flow — Mobile (the reference implementation)

Wizard order from `WIZARD_STEPS` (create.tsx:129): **Info · Media · Venue · Details · Terms · Review** (6 steps, `totalSteps=6`).

| Step | Fields / controls | Required to advance |
|---|---|---|
| **0 Info** | Title (≤200), Description (≤2000), Date, Time, *optional* End date/time (hidden behind "Add End Date & Time", defaults start+3h), Event Type (26-option chip grid) | **Title only** (`title.trim().length>0`) |
| **1 Media** | YouTube URL + live embed, up to 4 Event Images (first = Cover), Flyer (image **or** video, 3:5 portrait, ≤60s) | nothing |
| **2 Venue** | `LocationAutocompleteV3` + inline `DvntMap` preview, Virtual toggle (`isOnline`), Spicy/18+ (`isNsfw`), Visibility (public/private/link_only), Age Restriction (none/18+/21+) | **Location** unless Virtual |
| **3 Details** | Suggested+custom Tags, Dress Code, Door Policy, Lineup, Perks, Co-Organizers (debounced user search), **Ticketing** (enable toggle → simple single-tier or multi-tier editor + standalone Price + Max attendees), Disclaimers (≤500) | nothing (ticketing not validated here) |
| **4 Terms** | Fee breakdown, non-refundable notice, payout schedule, **Accept** checkbox. **Skipped for non-ticketed events.** | Accept if ticketed |
| **5 Review** | Read-only summary cards. No inline editing. | — |

- **Draft autosave:** ✅ MMKV-persisted store `create-event-draft`, writes on every keystroke. Survives leaving the screen and app restart. Cleared **only on successful publish**. No "you have a draft" prompt, no explicit Save/Discard.
- **Publish:** `handleSubmit` → Stripe + $2-floor guards → upload media to Bunny CDN → build payload → `useCreateEvent` (optimistic) → `eventsApi.createEvent` (bridges Better Auth → Supabase JWT via `ensureSupabaseJwt()`, the fix for the prior *permission denied for table events*). Then creates ticket types per tier + invites co-organizers as `"editor"`.
- **Columns written** (events.ts:687-728): `host_id, title, description, start_date, location, cover_image_url, image, images, youtube_video_url, price, max_attendees, is_online` + conditionally `location_lat/lng/name/address/type, visibility, category, age_restriction, end_date, ticketing_enabled, dress_code, door_policy, lineup, perks, flyer_image_url, nsfw`.

## 2. As-Is Flow — Web

Single scrolling page (`event-create.web.tsx`), four `<Section>` cards + a sticky desktop live-preview, one **Publish** button:
1. **Details** — title, description
2. **When & Where** — start (`datetime-local`), end (`datetime-local`), Online toggle, **venue search** (`VenueSearchInput` → `usePlacesAutocomplete`, real lat/lng, *working*)
3. **Cover** — single image/video
4. **Tickets & Visibility** — sell-tickets toggle, single flat price, capacity, visibility chips

- **Gate:** `canPublish = title.trim() && (location.trim() || isOnline)` — same two-field minimum as mobile.
- **Draft:** same shared persisted store (localStorage-backed on web).
- **Publish:** same `useCreateEvent` → `createEvent`. Sends only `title, description, date, endDate, location, price, maxAttendees, visibility, isOnline, image, locationLat/Lng/Name/Type`. **No** ticket-type creation, **no** co-organizers, **no** Stripe check.

## 3. Data Model (what the form *could* capture)

- **`public.events`** ~45 columns. Beyond the basics: `visibility` (public/private/link_only), `category`, `location_type/name/address/lat/lng`, `vibes_media`, `disclaimers`, `nsfw`, `age_restriction`, `ticketing_enabled`, `payout_status`, `share_slug`, `youtube_video_url`, `images` (jsonb), `city_id`, `dress_code`, `door_policy`, `entry_window`, `lineup`, `perks`, `flyer_image_url/meta`, `status` (draft/active/cancelled/postponed/suspended), `cancelled_at/cancel_reason`, `video_flyer_url/poster_url`, `dominant_color`. Registry-declared (canonical SoT `packages/app/lib/contracts/event-edit-fields.ts`): `refund_policy`, `refund_days_before`, `attendee_name_requirement`, `fee_mode`.
- **Tickets:** `ticket_types` (tiers: `tier_type` ga/vip/early_bird/table_service/group_bundle/comp/donation, `price_cents`, `quantity_total`, `max_per_user/order`, `sale_start/end`, `status`, `glow_color`, `perks`…), `tickets` (qr, status, attendee_name, wallet), `ticket_addons` + variants, `promo_codes` (BOGO/promo in checkout).
- **State machines:** the "16-state / 15-state" machines are **aspirational** — no xstate file exists. Real enforced enums: events `draft|active|cancelled|postponed|suspended`; tickets `active|scanned|refunded|void|transfer_pending`; tiers `draft|scheduled|on_sale|paused|sold_out|ended`. Create must only ever produce `draft` or `active`.
- **Recurring events:** genuinely **unmodeled** — no column, no store field, anywhere.

---

## 4. Diagnosed Problems (evidence-based)

### (A) DESIGN / UX
- **A1 — Two-field minimum hides everything that matters.** Only Title (+location) gate publish; date, type, media, tickets are all skippable, so it's easy to publish a hollow event. *(create.tsx:412; web :49)*
- **A2 — Virtual-event location dead-end.** Step 2 lets a virtual event proceed with no location, but `handleSubmit`/`isValid` require `location.trim()` regardless of `isOnline` → Review shows a permanently-dimmed "Create Event" with only a toast. *(create.tsx:412,425 vs store:381)*
- **A3 — Silent "Next."** Blocked Next just dims with no message; step dots can't jump forward → user stuck with no explanation of the missing required field. *(create.tsx:2585,837)*
- **A4 — Draft resumes at step 0.** `current_step` isn't persisted, so a fully-restored draft reopens at Info every time. *(store omits it from persistence)*
- **A5 — No draft awareness.** `hasDraft()` exists but is never used; no "Resume draft / Start fresh" prompt, no explicit save/discard. *(store:393)*
- **A6 — Web has no review/confirm and no terms step**; one giant form, no progressive disclosure.

### (B) DATA gaps (model/store supports it, form drops or omits it)
- **B1 — `category` never persists (silent drop).** Form builds `category: tags[0]`, but `createEvent` reads the non-existent `eventData.eventCategory` → category column never written **and tags never stored anywhere**. *(create.tsx:619 vs events.ts:714)*
- **B2 — `event_type` never persists.** Form sends `event_type`, but the insert payload has no mapping → the 26-option picker writes nothing to the DB. *(create.tsx:630; no key in events.ts:687-728)*
- **B3 — `location_address` never populated.** Column + insert path exist; `LocationData` only carries name/lat/lng/placeId → structured street address dropped. *(events.ts:709; store:44)*
- **B4 — Ticket `saleEnd` has no UI** (type + API send it, always empty). *(store:67; create.tsx:663)*
- **B5 — `isNsfw` & `flyerMediaType` lost on restart** — omitted from `partialize` → Spicy flag clears, video flyer downgrades to image. *(store:407-432)*
- **B6 — Genuinely-missing model fields:** **recurring** (unmodeled), **door time** (separate from start), **refund policy** (`refund_policy`/`refund_days_before` registry-only, no UI), **fee mode** (pass/absorb), **attendee-name requirement**, explicit **RSVP-vs-ticketed mode** (only the `ticketing_enabled` boolean today), **co-host role** (always hard-coded `"editor"`).

### (C) PARITY (web ≠ mobile)
Web is missing, vs mobile: separate **time**, **event type**, **multiple images**, **flyer (photo/video)**, **YouTube**, **tags/category**, **age restriction**, **spicy/NSFW**, **dress code**, **door policy**, **lineup**, **perks**, **co-organizers**, **multi-tier ticketing**, **single-tier name/max-per-person**, **disclaimers**, **map preview**, **terms/agreement step**, **Stripe gate**, **$2 floor**. ~10 of ~30 fields. *(full table in agent findings; event-create.web.tsx vs create.tsx)*

### (D) BUGS (correctness)
- **D1 — Web cover images don't work.** Web sets `flyerImage = URL.createObjectURL(file)` and sends that blob URL as `image` — it never uploads to the CDN, so the URL won't resolve server-side. Web events get broken/transient covers. *(event-create.web.tsx:82)*
- **D2 — Web paid events have no buyable ticket.** Web never calls `ticketTypesApi.create`; it only writes a flat `price` on the event. A "paid" web event has no ticket type to purchase. *(web publish path; vs create.tsx:650-689)*
- **D3 — Web skips Stripe + $2 floor** → a web host can "publish" a priced event with no payout account and sub-$2 tiers. *(no guards in web path)*
- **D4 — End can precede start.** End-time picker has no minimum vs start; no validation blocks it before insert. *(create.tsx:1073)*
- **D5 — `max_attendees` can insert `undefined`** (only always-set field not null-guarded). *(events.ts:698)*
- **D6 — JWT-bridge failure swallowed** → silently falls back to `anon` and re-hits the RLS permission error at publish. *(events.ts:679-684)*
- **D7 — Triple image columns** (`cover_image_url` + `image` + `images[]`) hand-synced; brittle. *(events.ts:693-695)*

---

## 5. Proposal — Unified Flow (Phase 2 plan, pending sign-off)

**Principle:** one schema + validation in `packages/app`, **two layouts** (mobile = stepped wizard, web = the same sections as a multi-section form/wizard in the organizer area). Never two diverging forms. Reuse the existing mutations, state enums and ticket model — **upgrade in place**, drop nothing (tiers/add-ons/BOGO/spicy/flyer all stay).

### 5.1 Single source of truth
- Extract the form schema + validation + the publish payload builder into a shared module (e.g. `packages/app/features/events/create/event-form-schema.ts` + a `useEventCreateForm` hook over the existing `create-event-store`). Both platforms render the **same fields, same validation, same payload**. Web stops being a separate code path.

### 5.2 Proposed step / section order (same on both; web shows 2–3 per screen)
1. **Basics** — Title*, Event Type*, Description, Date*, Start time*, optional End, optional Door time
2. **Location** — Venue search (lat/lng + **address** captured) / Virtual toggle; map preview on both
3. **Media** — Cover/images, Flyer (photo/video), YouTube — **real CDN upload on web**
4. **Tickets** — RSVP-vs-Ticketed mode selector; tiers (name/price/qty/max/sale window incl. **saleEnd**); Stripe gate + $2 floor **on both**; advanced (add-ons) collapsed
5. **Details** (progressive disclosure, collapsed) — Tags, Age, Spicy, Visibility, Dress code, Door policy, Lineup, Perks, Co-organizers (+ **role picker**), Disclaimers, **Refund policy**
6. **Review & Publish** — summary + inline jump-to-edit; explicit **Save Draft** vs **Publish**

### 5.3 Friction reduction
Sensible defaults; only truly-required fields gate (Title, Type, Date, Start, Location-or-Virtual, accepted-terms-if-paid); progressive disclosure for advanced; **inline validation with messages** (kills A3); **draft autosave + a "Resume draft?" prompt** and restored step (fixes A4/A5); review-before-publish on both.

### 5.4 Fixes folded in
All of §4: B1/B2/B3 wiring, B5 persistence, A2 virtual-location logic, D1/D2/D3 web upload+tickets+guards, D4 date validation, D5/D6/D7 payload hardening.

### 5.5 New data (only where the audit shows it's needed)
- Wire existing-but-unwired: `category`/tags, `event_type`, `location_address`, `saleEnd`, refund policy, fee mode, attendee-name requirement, co-host role.
- **Recurring events** are the one genuinely-unmodeled field → **needs a migration** (e.g. `recurrence_rule`/RRULE + materialization strategy). *Flagged as a decision below — it's the largest net-new piece.*

### 5.6 Verification (Phase 2 exit)
Create a full event on **mobile and web** through the new flow: every field saves, drafts persist + resume, validation guides without blocking, illegal states impossible (only draft/active), lat/lng + address captured, new fields work, publish succeeds and renders correctly. `verify:parity` clean, typecheck 12/12, committed + pushed per phase.

---

## 6. Decisions needed before Phase 2

1. **Web layout** — stepped wizard mirroring mobile, **or** a richer single-page multi-section organizer form (sticky preview)? (Both share the schema; this is purely the web *shell*.)
2. **Recurring events** — in scope now (needs a migration + materialization design), or defer to a follow-up so the rest can ship first?
3. **Scope of "easy"** — minimal required set to publish = **Title, Type, Date, Start, Location/Virtual** (everything else optional/advanced). Confirm that's the right required set.
