# Dominant-color extraction — fit & write-back authorization

## As-is (canonical: the edge function)

- **`flyer-color` edge fn** decodes an event's **still** flyer (`imagescript`), averages
  non-transparent pixels → `#rrggbb`, writes `events.dominant_color` (service role).
- `createEvent` / `updateEvent` fire it (fire-and-forget) when a flyer/cover is set/changed.
- `<EventFlyer>` (`packages/app/components/event/EventFlyer.web.tsx`) consumes
  `media.dominantColor` for the **skeleton background** and the **generated fallback
  gradient**. Callers build the `media` object from `event.dominant_color`.
- **Gap:** video-only events get no color — frame extraction needs a transcode
  service (no ffmpeg in the Deno edge runtime; Bunny is storage-only, not Stream).

## Write-back authorization decision → **narrow edge fn (`set-event-color`)**

A first-viewer client must persist an extracted color. Options considered:

1. **Column-scoped RLS policy** (let anon/authed `UPDATE` only `dominant_color` when null).
   ✗ Rejected: `events` already has host/co-org-only `UPDATE` RLS **and** a
   `BEFORE UPDATE` trigger (`enforce_event_owner_write`) that rejects non-host
   writes. A column exception would require column GRANTs *and* exempting the
   trigger for dominant-color-only diffs — fragile, and it weakens the event-write
   security model we just hardened.
2. **Narrow `set-event-color` edge fn** (chosen). `verify_jwt:false`, service-role
   internally. Accepts `{ event_id, color }`, validates `color` is `#rrggbb` and the
   event exists, then `UPDATE events SET dominant_color = $color WHERE id = $id AND
   dominant_color IS NULL` — **idempotent, first-writer-wins, only-ever sets the one
   cosmetic column, never anything else.** No broad event-update permission, no
   policy/trigger conflict. Worst case for an attacker: set a color once on a
   not-yet-colored event (negligible, and unforgeable beyond that).

## Client fallback (this change)

- `useEventDominantColor(event)` → `{ color, source: 'db'|'extracted'|'fallback', isLoading }`.
- `dominant_color` set → return it (`db`), **no work, no refetch**.
- else extract on-device (still flyer → direct; video → thumbnail frame first), return
  `extracted` immediately for UI, and `set-event-color` write-back (debounced, one
  in-flight per eventId — guards a viewer stampede).
- failure → brand fallback gradient (`fallback`), never crash, never block render.
- Universal: `extractDominantColor.web.ts` / `.native.ts` behind one hook.
  - **Web** averages the non-transparent pixels on a `<canvas>` — the *same algorithm
    the edge fn uses* — for both stills and video frames. We deliberately did **not**
    use a swatch palette (node-vibrant): a swatch returns a vivid cluster that diverges
    from the pixel mean (a flyer the edge fn read as `#321e14` gave a light-tan vibrant
    swatch), which would make db-sourced and client-extracted colors look incoherent.
  - **Native** uses `react-native-image-colors` (video frame via `expo-video-thumbnails`).
    It only exposes swatches; `normalizeColor.fromImageColors` picks the field closest to
    the average — Android's real `average`, iOS `background`. Closest achievable parity
    without a raw-pixel API on native.

## Boundaries

- `flyer-color` stays canonical for stills + backfill — not removed/duplicated.
- This delivers the **color** for video events (extracted + persisted on first view),
  **not** a stored poster-frame image (still a transcode-service job).
- `react-native-image-colors` is a native module → the native path needs a dev-client
  rebuild; until then the native extractor degrades to the fallback gradient (guarded
  import). Web works immediately (node-vibrant, JS).
