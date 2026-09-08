# Story Creation — Phase 0 Ground Truth

**Method:** read-only audit. No source file was modified. Every claim below carries a `file:line`
from the working tree at the time of the audit.

**Branch:** `ws3b-lynk-moq-product-screens`, HEAD `a3f0a84`, working tree dirty (~75 modified files).
The spec says the work sits on `master`. It does not. The "master" claim traces to
`docs/story-editor-v2-baseline.md:3` — *"**Date:** 2026-08-08. **Branch:** master (no commits;
changes left in tree)"* — which was true for that pass and has not been true since.

**Scope note:** D1 (RightIslandMenu drag jump) and D2 (AnimatedToolPanel unmount-before-close) are
already confirmed and owned by another agent. They are excluded here.

---

## 1 · What matched the spec, and what did not

### Documents

| Spec claim | Reality |
|---|---|
| `DVNT_Stories_Rebuild_Brief.md` exists | Does not exist anywhere in the repo. |
| `DVNT_Stories_Experience_Blueprint.md` exists | Does not exist anywhere in the repo. |
| Work is on `master` | Branch is `ws3b-lynk-moq-product-screens`. |
| `docs/stories/` holds the story docs | Did not exist before this file. |

Three story docs *do* exist and are the real governing set:

- `packages/app/features/stories-editor/REGRESSION_LOCK.md` (172 lines) — invariants, "ACTIVE".
- `packages/app/features/stories-editor/STORY_EDITOR_AUDIT.md` — defect list.
- `packages/app/features/stories-editor/EDITOR_REDESIGN.md` — UX acceptance criteria.
- `docs/story-editor-v2-baseline.md` (110 lines) — the canvas-kit fit audit. This is the "baseline
  §1/§4/§5/§6" cited by `packages/app/features/stories-editor/canvas-kit/index.ts:5-8`.

`REGRESSION_LOCK.md:152` points at a test suite that does not exist: *"See `tests/stories/` for
automated test scripts."* There is no `tests/` directory at the repo root; `find` returns only
`scripts/tests` and a CocoaPods vendor directory.

### Structural claims

| Spec claim | Reality |
|---|---|
| `react-native-canvas-kit@1.1.0` is a live dependency | True — `packages/app/package.json:319`. |
| It is reached through one adapter directory | True — `packages/app/features/stories-editor/canvas-kit/` is the only importer of the package (5 files; grep across `packages/` + `apps/` finds no other import site). |
| Two canvas stacks run side by side | **False.** Only one canvas mounts. See §2. |
| `utils/export.ts` is dead code | True. See §5. |

---

## 2 · Canvas kit vs Skia — which one actually renders

**One canvas renders: the raw Skia `EditorCanvas`. The canvas-kit layer is compile-only scaffold
that nothing imports.**

Evidence:

1. `<Stage>` — canvas-kit's root — appears exactly once in the repo, inside the adapter itself:
   `packages/app/features/stories-editor/canvas-kit/CanvasKitElementLayer.tsx:171`.
2. `CanvasKitElementLayer` is exported from `canvas-kit/index.ts:53` and imported by **nothing**.
   It is absent from `stories-editor/index.ts` (13 lines, exports only `EditorScreen`, the store,
   and types) and from `components/index.ts` (26 lines).
3. The adapter says so itself — `CanvasKitElementLayer.tsx:20-23`:

   ```
   // NOT yet wired into the live EditorScreen: the transform/gesture behavior is
   // REGRESSION_LOCK-governed and needs on-device verification (INV-PERF-2,
   // INV-RENDER-6, cancel/back matrices) that is impossible in this environment.
   // This module compiles and is import-ready for that swap.
   ```

4. `EditorScreen.tsx:880-897` mounts `EditorCanvas` and nothing else, passing it `canvasRef` from
   `useCanvasRef()` (`EditorScreen.tsx:13,280`).
5. `EditorCanvas.tsx:247` is the only `<Canvas>` in the editor path. It draws media through
   `SkiaImage` (`:285-291` for video, `:210-218` for image), video frames through
   `useVideo(mediaUri, { paused: !isPlaying })` (`EditorCanvas.tsx:173-177`), filters through a
   `ColorMatrix` layer paint, text through `Skia.ParagraphBuilder` (`:730`), and drawing through
   `Skia.Path.MakeFromSVGString` (`:407,:526`).

So the spec's "two canvas stacks" prohibition is not currently violated at runtime. What exists is
a **second, unmounted renderer implementation** kept alive by tsc.

### Why the swap stalled

`docs/story-editor-v2-baseline.md:69` names the blocker directly:

> **Export snapshot (blocker for a *full* swap).** `Stage` gives no image-snapshot handle
> (`Stage.tsx:131-183`). The WYSIWYG guarantee … depends on `makeImageSnapshot`.

The whole photo export path is `canvas.makeImageSnapshot()` on the raw Skia canvas ref
(`EditorScreen.tsx:447-531`). canvas-kit's `Stage` forwards no ref. Two further hard gaps are
recorded at `story-editor-v2-baseline.md:70-71`: kit `Text` is single-line, so the eight text
presets and the emoji/CJK `Paragraph` fallback cannot be reproduced; and there is no kit brush for
`neon` or `arrow`.

### Converging on one canvas

Two viable ends. Both are cheap; the expensive option is leaving it as-is.

**Option A — keep raw Skia, delete the scaffold.** Remove
`packages/app/features/stories-editor/canvas-kit/` (5 files) and drop
`react-native-canvas-kit` from `packages/app/package.json:319`. Nothing at runtime changes.
Cost: near zero. Loses the `Transformer`/`SnapGrid`/`BrushLayer` upside catalogued in
`story-editor-v2-baseline.md:53-58`, and abandons the on-UI-thread stroke capture that would delete
the `forceRender()` churn at `EditorScreen.tsx:283-287,311-336`.

**Option B — finish the hybrid.** Wire `CanvasKitElementLayer` in for the element + brush layer
only, leaving media/filters/vignette/grain/export in `EditorCanvas` (the shape
`story-editor-v2-baseline.md:61-63` already designed). Then delete the four files it replaces:
`components/gestures/ElementGestureOverlay.tsx`, `components/gestures/shared-element-transforms.ts`,
`hooks/useElementTransform.ts`, `hooks/useGestures.ts`. Blocked on device verification, and
`useElementTransform` is also consumed by `components/canvas/AnimatedGifStickerLayer.tsx:57`, so
that import has to move first.

Note this is not the only extra renderer. `packages/app/features/story/story-editor.web.tsx` is a
third one — a CSS/DOM renderer driving the same `useEditorStore`
(`story-editor-v2-baseline.md:81`). It is deliberate and out of scope for a native one-canvas rule,
but any change to the store's element shape lands on it too.

**Do not remove `react-native-canvas-kit` casually.** If Option A is chosen, the removal is a
deliberate decision to abandon the WS-1 direction, not cleanup.

---

## 3 · Publish / upload path

```
create.tsx:720  handleShare
  ├─ :739  setIsSharing(true)
  ├─ :740  Haptics.notificationAsync(Success)          ← fires HERE (see D10)
  ├─ :752  uploadMultiple(mediaFiles)
  │        use-media-upload.ts:128 uploadMultiple
  │          → server-upload.ts:181 uploadToServer
  │            ├─ native  :305-323  FileSystem.uploadAsync(MEDIA_UPLOAD_URL, …) multipart
  │            └─ web     :252-256  supabase.functions.invoke("media-upload", { body: FormData })
  │               MEDIA_UPLOAD_URL = `${SUPABASE_URL}/functions/v1/media-upload`  (:21)
  │
  │        EDGE FN media-upload  (apps/mobile/supabase/functions/media-upload/index.ts)
  │          :113-120  generateKey()  → `${kind}/${userId}/${year}/${month}/${crypto.randomUUID()}.${ext}`
  │          :394-396  uploadUrl = https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${key}
  │                    publicUrl = ${BUNNY_PULLZONE_BASE_URL}/${key}
  │          :409-411  PUT with header AccessKey: BUNNY_ACCESS_KEY
  │          Bunny credentials never reach the client (server-upload.ts:5).
  │
  └─ :784  createStoryMutate({ items, visibility })
           use-stories.ts:94-98  useCreateStory → storiesApiClient.createStory
             api/stories.ts:319  createStory
               :348   for (const item of storyData.items)          ← one call PER item
               :359   supabase.functions.invoke("create-story", { body: { … } })

           EDGE FN create-story  (apps/mobile/supabase/functions/create-story/index.ts)
             :112   verifySessionDetailed  (Better Auth session)
             :154   resolveOrProvisionUser
             :173-179  media  .upsert({...}, { onConflict: "filename" })   ← only dedupe in the path
             :240-244  stories .insert(storyInsert)                        ← plain insert
             :367-369  stories_stickers .insert(stickerRows)
             :376      on sticker failure: DELETE the story row (compensating undo)
```

Named functions: **`media-upload`** and **`create-story`**. Deletion goes through
**`delete-story`** which also clears `stories_stickers` by `_parent_id`
(`delete-story/index.ts:154`).

### Server-side idempotency: **none.**

- `create-story` inserts the story with `supabaseAdmin.from("stories").insert(storyInsert)`
  (`:240-244`). No idempotency key is accepted in `CreateStoryBody` (`:41-80`), no request ID, no
  unique constraint tied to a client-generated token.
- The only conflict handling is on the **media** row: `.upsert(mediaPayload, { onConflict: "filename" })`
  (`:176`), justified in the comment at `:164-166` as retry protection against orphan media rows.
  That dedupes the media record; it does **not** dedupe the story. Two `create-story` calls with the
  same `mediaKey` produce **two `stories` rows pointing at one `media` row**.
- `media-upload` mints a fresh `crypto.randomUUID()` key per request
  (`media-upload/index.ts:113-120`), so a retried upload can never collide with itself — it just
  writes a second Bunny object.
- Client-side there is a disabled button (`create.tsx:903`) and an `isSharing || isCreateStoryPending`
  early return (`create.tsx:727-733`). Per the brief, that does not count. There is also a durable
  upload-watchdog registry (`server-upload.ts:187-195`, `beginUpload`/`settleUpload`), but its
  docstring at `:173-180` is explicit that it only records a trace — *"Recording never affects the
  upload result"*. It is observability, not deduplication.
- Grep for `idempot` across `create-story`, `media-upload`, `server-upload.ts`, `api/stories.ts`
  returns one hit, and it is about story **views**: `api/stories.ts:608`.

**Consequence:** a network retry, a double-tap that beats the React state flush, or an app resume
mid-flight can publish the same story twice with no server-side defense.

---

## 4 · The overlay schema actually persisted

`stories_stickers` rows are written at `create-story/index.ts:308-365` in a Payload-style shape:

```
{ _order, _parent_id, id, type, data }
```

`type` ∈ `animated_gif | emoji | text | sticker` (`:315`). The `data` blob per type (`:316-364`):

| type | persisted `data` keys |
|---|---|
| `animated_gif` | `url, x, y, sizeRatio, scale, rotation, opacity` |
| `emoji` | `emoji, x, y, sizeRatio, scale, rotation, opacity` |
| `text` | `content, x, y, scale, rotation, opacity, color, backgroundColor, fontFamily, fontSizeRatio, maxWidthRatio, textAlign, textStyle` |
| `sticker` | `source, assetId, url, x, y, sizeRatio, scale, rotation, opacity` |

Read back at `api/stories.ts:20-113` (`parseStoryOverlayRow`), selected with
`.select("id, _parent_id, type, data").order("_order")` (`api/stories.ts:191-194`).

**Both renderers handle all four types.** Viewer: `story/[id].tsx:519-666` (`StoryOverlayLayer`) —
`animated_gif` `:534`, `emoji` `:562`, `text` `:587`, `sticker` fall-through `:632`. Composer
preview: `story/create.tsx:132-259` (`StoryOverlayPreview`) — same four branches at `:146`, `:171`,
`:193`, `:227`. Both apply the same legacy fallback (promote `animatedGifOverlays` to
`storyOverlays` when the latter is empty): viewer `story/[id].tsx:926-936`, composer
`story/create.tsx:858-864`.

Type coverage matches. **Layout constants do not**, and neither reads `textStyle`:

| | Viewer `[id].tsx:591-624` | Composer `create.tsx:196-219` |
|---|---|---|
| min font size | `18` | `16` |
| lineHeight | `fontSize * 1.14` | `fontSize * 1.12` |
| fontWeight | `getSystemFontWeight(fontFamily)` when `shouldUseSystemFontFallback(content)`, else `"700"` | always `"700"` |
| fontFamily | dropped when the system-font fallback triggers | always `overlay.fontFamily` |
| `textStyle` | never read | never read |

Three fields exist in the type and survive the DB but are never written by the editor and never
read by any renderer — `textStyle`, `stickerKind`, `metadata` (`lib/types/index.ts:117-125`), plus
`category`/`label` on the sticker variant (`:139-142`). `parseStoryOverlayRow` does not even parse
`stickerKind`, `metadata`, `category`, or `label` (`api/stories.ts:91-110`). They are declared,
persistable, and inert.

---

## 5 · `utils/export.ts` — confirmed dead

`grep` for `utils/export`, `exportVideo`, `exportAsImage`, `captureCanvasAsImage`,
`buildExportConfig`, `renderFrame`, `saveToGallery`, `shareToInstagramStory` across `packages/` and
`apps/` returns **only the definition lines inside `export.ts` itself**. Zero callers for all eight
exports. The file is 311 lines.

`exportVideo` returns `null` where encoding belongs (`utils/export.ts:160-177`):

```ts
    // The actual encoding would be done by a native module
    // This is the interface point for integration
    // See integration notes below

    onProgress({ progress: 0.95, status: "saving", message: "Saving to camera roll..." });

    // Return the output path
    onProgress({ progress: 1, status: "done", message: "Export complete!" });

    return null; // Would return actual file path
```

It renders every frame into an in-memory `SkImage[]` (`:136-152`), then discards the array, reports
`status: "done"`, and returns `null`. A caller would see a success progress event and no file.

`renderFrame` (`:76-109`) is likewise a stub — it saves/translates/rotates/scales the canvas and
restores without drawing anything, per its own comment at `:104-105`: *"Element-specific rendering
is handled by the Skia components / This is a simplified version for the export pipeline."*

The live export is `EditorScreen.captureCanvas` (`:447-531`) → `renderFinalArtifact` (`:537-565`),
which never touches this file.

**Verdict: CONFIRMED, both halves.**

---

## 6 · Defect verdicts D3–D12

| # | Claim | Verdict |
|---|---|---|
| D3 | Camera captures auto-forward to the editor on a timer; gallery picks stop in the hub | **CONFIRMED** |
| D4 | Editor resets on route mount; receives a URI, not a scene document; photo completion returns a flattened image | **CONFIRMED** |
| D5 | Video "Done" returns the original URI + overlay metadata; hub Save writes the raw source URI | **CONFIRMED** |
| D6 | TextEditor supports lineHeight/letterSpacing/stroke/shadow; serializer drops them; preview has its own defaults; no shared TextStyle type | **CONFIRMED** |
| D7 | `updateElement` does not push undo history | **CONFIRMED** |
| D8 | Emoji search with a non-empty query returns the full collection | **CONFIRMED** |
| D9 | GIF fallback copy leaks the API key or HTTP status into user-visible text | **PARTIALLY TRUE** — status and key-configuration state leak; the key value never does |
| D10 | Success haptic fires before upload starts, not on server ack | **CONFIRMED** |
| D11 | Delayed global store resets can overlap a new session | **PARTIALLY TRUE** — the hazard is real; the three named stores are the wrong ones |
| D12 | REGRESSION_LOCK mandates immediate panel removal and hub-first flow | **CONFIRMED** |

---

### D3 — CONFIRMED

Camera path, `story/create.tsx:529-558`:

```ts
        // Auto-open editor for images (skip the redundant canvas-tap step)
        if (result.type === "image") {
          setTimeout(() => {
            router.push({
              pathname: "/(protected)/story/editor",
              params: { uri: encodeURIComponent(result.uri), type: result.type },
            });
          }, 300);
        }
```

Gallery path, `story/create.tsx:505-525` → `handleMediaSelected` (`:447-503`). It appends to
`mediaAssets`, sets `currentIndex`, and returns. No `router.push`. The user stays in the hub and
must tap the canvas (`create.tsx:1003-1013`) or a creative tool (`:1071`) to reach the editor.

Two additional facts the claim does not state:

- The 300ms `setTimeout` is uncancelled. `useFocusEffect` returns no cleanup (`create.tsx:557`),
  so a user who backs out inside 300ms still gets pushed into the editor.
- The **camera screen's own gallery button** writes to the same `camera-result-store`
  (`routes/screens/(protected)/camera.tsx:49-67`), so an image picked from inside the camera
  auto-forwards while the same image picked from the hub's Gallery button does not. Same user
  intent, two different outcomes.

Video captures do not auto-forward — the branch is `result.type === "image"` only.

### D4 — CONFIRMED

**Reset on mount** — `story/editor.tsx:56-62`:

```ts
  const didMount = useRef(false);
  useLayoutEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      useEditorStore.getState().resetEditor();
    }
  }, []);
```

**URI, not a scene document** — the route reads seven flat string params
(`editor.tsx:41-49`: `uri, type, initialMode, index, autoDoneTextOnly, demoTextSeed,
demoTextOpenColor`) and hands one string down: `mediaUri={uri ? decodeURIComponent(uri) : ""}`
(`editor.tsx:148`). `EditorScreen` then calls `setMedia(mediaUri, mediaType)`
(`EditorScreen.tsx:290-295`). There is no document — no element list, no scene version, nothing to
re-open. Re-entering the editor on the same asset starts from an empty store every time.

**Photo completion returns a flattened image** — `EditorScreen.tsx:659-676`:

```ts
    const rendered = await renderFinalArtifact();
    …
    onSave?.({
      editedUri: rendered.uri,
      mediaType: "image",
      storyOverlays: allSerializableOverlays.filter(
        (overlay) => overlay.type === "animated_gif",
      ),
      animatedGifOverlays,
    });
```

`rendered.uri` is a PNG on disk: `captureCanvas` (`:447-531`) calls
`canvas.makeImageSnapshot()` (`:468`), `image.encodeToBase64(ImageFormat.PNG, 100)` (`:499`), and
writes `story_${Date.now()}.png` to the cache directory (`:512-516`). The `.filter(type ===
"animated_gif")` on line 672 is the giveaway: text, emoji and static stickers are deliberately
dropped from the metadata because they are already baked into the pixels. Only GIFs survive as
data, because they animate.

The result store carries exactly that (`story-editor-result-store.ts:4-10`):
`{ uri, index, mediaType, storyOverlays, animatedGifOverlays }`. No elements, no drawing paths, no
filter, no adjustments. Once "Done" is tapped on a photo, every edit is irreversible.

### D5 — CONFIRMED

Video "Done" — `EditorScreen.tsx:649-657`:

```ts
    if (storeMediaType === "video") {
      onSave?.({
        editedUri: storeMediaUri || mediaUri,
        mediaType: "video",
        storyOverlays: allSerializableOverlays,
        animatedGifOverlays,
      });
      return true;
    }
```

`storeMediaUri` was set from the route param (`EditorScreen.tsx:291`), so `editedUri` **is** the
input video URI. Video edits live entirely as overlay metadata; nothing is composited. The screen
enforces this by rejecting the edits it cannot express (`EditorScreen.tsx:634-647`): drawing,
filters, or non-zero adjustments on a video produce a "Video Editing Limit" toast and `return false`.

Hub Save — `story/create.tsx:1033-1063`:

```ts
                              const asset = mediaAssets[currentIndex];
                              if (asset) {
                                await MediaLibrary.saveToLibraryAsync(asset.uri);
                                showToast(
                                  "success", "Saved",
                                  `${asset.type === "video" ? "Video" : "Image"} saved to gallery`,
                                );
```

`asset.uri` came from `applyEditedResult` (`create.tsx:387-401`), which assigns
`uri: editorResult.uri`. For a video that is the untouched source file. The user adds text and
stickers, taps Save, gets **"Video saved to gallery"**, and lands a file with none of their overlays.

Images are fine — `asset.uri` is the flattened PNG. The defect is video-only, and it is masked by a
success toast that names the media type.

The editor's *own* save button already handles this correctly — `EditorScreen.tsx:572-580`:

```ts
    if (storeMediaType === "video") {
      showToast("warning", "Video Save Unavailable",
        "Saving edited video stories to the library is not available yet.");
      return;
    }
```

So the codebase has two save affordances with contradictory behavior on the same asset: one refuses
honestly, one succeeds dishonestly.

### D6 — CONFIRMED

There is no shared `TextStyle` type. There are **four independent shapes** and three lossy hops.

**Hop 0 — editor element.** `types/index.ts:69-85` declares 15 fields on `TextElement`:
`content, fontFamily, fontSize, color, backgroundColor, textAlign, style, strokeColor, strokeWidth,
shadowColor, shadowBlur, letterSpacing, lineHeight, maxWidth`, plus the `BaseElement` bag.

`TextEditor.buildUpdates` (`components/text/TextEditor.tsx:137-151`) writes 13 of them:

```ts
    return {
      content: textEditContent,
      fontFamily: textEditFont,
      color: textEditColor,
      style: textEditStyle,
      textAlign: textEditAlign,
      fontSize: clampedFs,
      letterSpacing: textEditLetterSpacing,
      lineHeight: textEditLineHeight,
      backgroundColor: stylePreset?.defaultBackgroundColor,
      strokeColor: stylePreset?.defaultStrokeColor,
      strokeWidth: stylePreset?.defaultStrokeWidth,
      shadowColor: stylePreset?.defaultShadowColor,
      shadowBlur: stylePreset?.defaultShadowBlur,
    };
```

All 13 are user-reachable: line height slider `TextEditor.tsx:668-698` (0.80–2.50 step 0.05),
letter spacing slider `:732-762` (−5 to 20 step 0.5), stroke/shadow via the preset picker
(`TEXT_STYLE_PRESETS`, eight presets per `story-editor-v2-baseline.md:49`).

**Hop 1 — serializer.** `EditorScreen.extractStoryOverlays` (`EditorScreen.tsx:84-100`) emits 13
keys, of which only 10 are style-bearing:

```ts
        return {
          id: element.id,
          type: "text" as const,
          content: element.content,
          x: …, y: …, scale: …, rotation: …, opacity: …,
          color: element.color,
          backgroundColor: element.backgroundColor,
          fontFamily: element.fontFamily,
          fontSizeRatio: Number((element.fontSize / CANVAS_WIDTH).toFixed(6)),
          maxWidthRatio: Number((element.maxWidth / CANVAS_WIDTH).toFixed(6)),
          textAlign: element.textAlign,
        };
```

**Dropped here: `style`, `letterSpacing`, `lineHeight`, `strokeColor`, `strokeWidth`,
`shadowColor`, `shadowBlur` — seven of thirteen.** Note `lib/types/index.ts:120` declares an
optional `textStyle` field on the wire type for exactly this purpose, and the serializer never sets
it, so the eight presets are lost at the first hop even though the schema has a slot for them.

**Hop 2 — server.** `create-story/index.ts:337-352` persists 13 keys including `textStyle`. It
adds nothing and drops nothing that hop 1 sent. Not a lossy hop — but its defaults silently
substitute (`fontSizeRatio ?? 0.11`, `maxWidthRatio ?? 0.8`, `textAlign ?? "center"`).

**Hop 3 — read back.** `api/stories.ts:58-89` reconstructs the same 13 keys. Not lossy.

**Hop 4 — render.** Neither renderer consumes `textStyle`. Both hardcode what the editor made
adjustable:

- Viewer `story/[id].tsx:611-624`: `lineHeight: fontSize * 1.14`, `fontWeight: "700"` (or the system
  fallback weight), no `letterSpacing`, no stroke, no shadow. Font floor `18` at `:592-595`.
- Composer preview `story/create.tsx:210-219`: `lineHeight: fontSize * 1.12`, `fontWeight: "700"`,
  no `letterSpacing`, no stroke, no shadow. Font floor `16` at `:197`.

**Field survival across the whole chain:**

| Field | TextEditor | Serializer | DB | Read | Viewer | Preview |
|---|---|---|---|---|---|---|
| `content` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `color` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `backgroundColor` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `fontFamily` | ✔ | ✔ | ✔ | ✔ | ⚠ dropped on system-font fallback | ✔ |
| `fontSize` → `fontSizeRatio` | ✔ | ✔ | ✔ | ✔ | ⚠ floor 18 | ⚠ floor 16 |
| `maxWidth` → `maxWidthRatio` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `textAlign` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `style` (preset) | ✔ | ✘ | (`textStyle` slot unused) | (slot unused) | ✘ | ✘ |
| `lineHeight` | ✔ | ✘ | ✘ | ✘ | hardcoded ×1.14 | hardcoded ×1.12 |
| `letterSpacing` | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `strokeColor` | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `strokeWidth` | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `shadowColor` | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| `shadowBlur` | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |

For photos this loss is invisible — the text is flattened into the PNG at `EditorScreen.tsx:669`,
so the *pixels* are correct and the metadata is discarded anyway. For **videos** the loss is
visible: overlays are the only representation, so a neon-preset caption with 1.4 line height and
2pt tracking plays back as plain 700-weight text at 1.14 line height with default tracking.

### D7 — CONFIRMED

`stores/editor-store.ts:288-299`:

```ts
  updateElement: (id, updates) => {
    if (__DEV__ && (updates as any).content !== undefined) { … }
    set((s) => ({
      elements: s.elements.map((el) =>
        el.id === id ? ({ ...el, ...updates } as CanvasElement) : el,
      ),
    }));
  },
```

No `undoStack`, no `redoStack`. Compare its four siblings, which all push:
`addTextElement` (`:240-248`), `addStickerElement` (`:276-284`), `removeElement` (`:308-317`),
`addDrawingPath` (`:328-336`) — each writes
`undoStack: [...s.undoStack, { elements: s.elements, drawingPaths: s.drawingPaths }], redoStack: []`.

Blast radius. `updateElement` is the commit point for every mutation that is not create/delete:

- Every text edit — `TextEditor.tsx:161` (live sync on each keystroke/slider move) and `:190` (Done).
- Every gesture commit — `EditorScreen.handleElementTransformEnd`, which is the `onTransformEnd`
  handler for `ElementGestureOverlay` (`EditorScreen.tsx:925`).

So move, scale, rotate, retype, restyle, recolor, and every slider drag are all invisible to undo.
Undo after a 20-minute session skips straight past all of them to the last *add* or *delete*, which
is worse than no undo — it silently discards work the user cannot recover.

Bonus, same file: `undoLastPath` (`:338-341`) pops `drawingPaths` without touching the history
stacks either, so the drawing toolbar's undo button and the global undo button disagree about state.

### D8 — CONFIRMED

`components/stickers/StickerPicker.tsx:93-100`:

```ts
  const twemojiStickers = useMemo(() => {
    if (activeImagePack || activeTab === "gif") return [];
    const packKey = activeTab as PackKey;
    const items =
      activeTab === "all" ? ALL_TWEMOJI : (stickerPacks[packKey] ?? []);
    if (!searchQuery.trim()) return items;
    return ALL_TWEMOJI;
  }, [activeTab, searchQuery, activeImagePack]);
```

An empty query returns the active pack. A **non-empty** query returns `ALL_TWEMOJI` — every emoji in
every pack, unfiltered (`:54`: `const ALL_TWEMOJI = Object.values(stickerPacks).flat()`). Typing
narrows nothing; it *widens* the result set from one pack to all of them. The search box placeholder
reads "Search stickers…" (`:216`).

The correct behavior is right above it. The image-sticker branch (`:83-91`) does filter:

```ts
    const q = searchQuery.trim().toLowerCase();
    return activeImagePack.stickers.filter((sticker) =>
      sticker.label.toLowerCase().includes(q),
    );
```

The emoji entries carry no label field to match on, which is presumably why the filter was
abandoned — but the UI still offers the box.

### D9 — PARTIALLY TRUE

The **API key value never reaches the UI.** `KLIPY_API_KEY` (`features/stickers/api/klipy.ts:10`)
is used only in the `Authorization` header (`:102`) and in truthiness checks (`:330`, `:376`). No
render path interpolates it.

What *does* leak is the HTTP status and the key's configuration state.
`StickerPicker.tsx:119-130`:

```ts
  const gifFallbackCopy = useMemo(() => {
    switch (gifQuery.data?.fallbackReason) {
      case "restricted_key":
        return "Klipy is returning 204 with the current key, so this tab is showing bundled animated reactions instead.";
      case "missing_api_key":
        return "No Klipy key is configured in this build, so this tab is using bundled animated reactions.";
      case "request_failed":
        return "Klipy search is temporarily unavailable, so this tab is using bundled animated reactions.";
```

Rendered in the picker at `StickerPicker.tsx:247-256`, under the heading "Animated emoji fallback".

Two of the three strings are engineering diagnostics addressed to the wrong audience. `restricted_key`
tells the user a raw HTTP status code and that a vendor key is rate-limited; `missing_api_key` tells
them the build is misconfigured — which is also a soft disclosure that a paid vendor integration is
present but unprovisioned. `request_failed` is the only one written for a user.

The `fallbackReason` values are set at `klipy.ts:333` (`missing_api_key`), `:359` (`restricted_key`,
after `KlipyNoContentError` — `:76-83`, `.status = 204`), and `:364` (`request_failed`).

Verdict: **PARTIALLY TRUE**. Status-code and configuration-state leakage into user-visible copy is
real and reproducible. Key-value leakage is not.

### D10 — CONFIRMED

`story/create.tsx:727-752`:

```ts
    if (isSharing || isCreateStoryPending) { … return; }
    if (mediaAssets.length === 0) { … return; }

    setIsSharing(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const mediaFiles = mediaAssets.map((m) => ({ … }));
      console.log("[Story] Uploading", mediaFiles.length, "files");

      const uploadResults = await uploadMultiple(mediaFiles);
```

The success haptic is line 740. The upload starts on line 752. The mutation fires on line 784. The
`onSuccess` callback (`:787-803`) has no haptic at all — it shows a toast (`:800`), resets, and
navigates back.

So the success buzz precedes the network call, and every failure path also fires it first:
upload failure (`:757-768`), mutation error (`:804-812`), and the outer catch (`:815-819`). The user
is told "done" by touch and "failed" by toast, in that order.

The pattern is right elsewhere in the same feature — `EditorScreen.tsx:602-603` fires
`notificationAsync(Success)` on the line *after* `await MediaLibrary.saveToLibraryAsync`.

### D11 — PARTIALLY TRUE

The named stores are wrong. `create-story-store.ts`, `story-flow-store.ts`, and
`story-editor-result-store.ts` contain **zero** `setTimeout` calls — all three reset synchronously
(`create-story-store.ts:101` `reset: () => set(initialState)`;
`story-flow-store.ts:89-96` `forceIdle`; `story-editor-result-store.ts:23-28` `consumeResult`).

The hazard is real, and it targets **`useEditorStore`**. Both delayed resets live in
`story/editor.tsx`.

Cancel path — `editor.tsx:100-126`:

```ts
  const handleClose = () => {
    // Navigate FIRST, then defer reset so the text-only BackgroundPicker
    // doesn't flash during the back animation. …
    useStoryFlowStore.getState().transitionTo("HUB");
    router.back();
    setTimeout(() => {
      useEditorStore.getState().resetEditor();
      …
    }, 350);
  };
```

Save path — `editor.tsx:143`:

```ts
    setTimeout(() => useEditorStore.getState().resetEditor(), 300);
```

Neither timer is stored in a ref, cleared on unmount, or guarded by a session token. Concretely:

1. `t=0` — user cancels. `router.back()` runs, a `resetEditor` is queued for `t=350`.
2. `t≈120` — user taps another asset in the hub. `handleOpenSkiaEditor` (`create.tsx:603-622`)
   pushes the editor route.
3. `t≈130` — new route mounts. `useLayoutEffect` calls `resetEditor()` (`editor.tsx:60`), then
   `EditorScreen`'s effect calls `setMedia(mediaUri, mediaType)` (`EditorScreen.tsx:291`).
4. `t=350` — the **stale** timer fires `resetEditor()`. `initialEditorData` sets `mediaUri: null`
   (per the dev assertion at `editor-store.ts:481`). The new session's media is wiped underneath a
   mounted editor.

The camera auto-forward compounds it: `create.tsx:546` pushes the editor on its own 300ms timer, so
a cancel-then-capture sequence puts two uncancelled timers in flight against one store.

This also violates the lock the file claims to obey. `REGRESSION_LOCK.md:54-56`:

> 1. **Cancel/Back from ANY editor state → HUB**
>    - Editor store MUST be fully reset before hub re-renders
>    - **No deferred/async reset — synchronous cleanup**

and `REGRESSION_LOCK.md:124-128` (RISK-1) prescribes the fix: *"Synchronous reset on close,
deferred only for visual transition smoothing."* The current code does the opposite, and the
comment at `editor.tsx:101-103` documents the tradeoff it chose (avoid a BackgroundPicker flash)
without covering the race.

Verdict: **PARTIALLY TRUE** — the mechanism, the risk, and the lock violation are all confirmed;
the store attribution in the claim is not.

### D12 — CONFIRMED

**Rules that conflict with a one-canvas / animated-panel direction — strike or amend:**

1. `REGRESSION_LOCK.md:86` — **INV-RENDER-2**: *"Tool panels use conditional render
   (`if (!visible) return null`)"*. This is the immediate-removal mandate. It is what D2 is: a
   panel cannot run a close spring if the invariant demands it return `null` the frame `visible`
   flips. Any exit animation violates it as written.

   This is already being amended in the working tree. `types/index.ts:175-179` now declares
   `export type Presence = "opening" | "open" | "closing" | "closed"` with the docstring *"'closing'
   keeps the panel mounted so its exit animation is visible"*, and `EditorState` gained
   `panelPresence: Record<string, Presence>` (`:190-195`). That is the D2 fix, and it is a direct,
   deliberate contradiction of INV-RENDER-2. The invariant must be rewritten to govern *presence
   transitions* rather than mount/unmount, or the lock and the code will disagree the moment D2
   lands.
2. `REGRESSION_LOCK.md:89` — **INV-RENDER-5**: *"Panel open/close is immediate (BottomSheet snap,
   no mount delay)"*. Same conflict, plus it names a component (`BottomSheet`) the editor no longer
   uses — `EditorScreen.tsx:1001-1045` mounts `AnimatedToolPanel`.
3. `REGRESSION_LOCK.md:57-58` — **Transition rule 2**: *"Done/Save from editor → HUB with
   editedUri / Editor store reset AFTER hub consumes editedUri"*, and the diagram node at `:33`,
   *"HUB (with editedUri)"*. This hardcodes the hub-first, URI-passing handoff that D4 identifies
   as the root problem. A one-canvas editor that owns a re-openable scene document cannot satisfy a
   rule that says the handoff payload is a URI.
4. `REGRESSION_LOCK.md:45-50` — the state table binds each state to a route
   (`HUB` → `story/create`, `EDIT_IMAGE`/`EDIT_VIDEO`/`TEXT_ONLY` → `story/editor`). Collapsing the
   hub and editor into one canvas surface invalidates the table and the
   `VALID_TRANSITIONS` map that encodes it (`lib/stores/story-flow-store.ts:22-39`).
5. `REGRESSION_LOCK.md:87-88` — **INV-RENDER-3/4** name *"Skia canvas"* explicitly. Not a conflict
   with one-canvas; it is the opposite — it is the lock choosing Skia by name. Keep it, and read it
   as further support for §2 Option A/B landing on Skia rather than canvas-kit.

**Rules worth keeping verbatim:**

- **No ghost state** — `REGRESSION_LOCK.md:71-75`, INV-NAV-3/4/5: after cancel,
  `mode === "idle"`, `elements === []`, `drawingPaths === []`. Enforced today by the dev assertions
  at `editor-store.ts:471-488` and `editor.tsx:108-124`. Both should survive any rebuild.
- **Correct back** — `REGRESSION_LOCK.md:69-70,74-75`, INV-NAV-1/2/6/7: cancel and the back gesture
  take the same path; the text-only editor never appears after cancelling an image/video flow and
  vice versa.
- **Safe area** — `REGRESSION_LOCK.md:97-101`, INV-UI-1/2/3/4: safe-area compliant, no clipped
  bottom bars, 44pt minimum hit area, no layout shift on keyboard open/dismiss.
- **Document isolation / single source of truth** — `REGRESSION_LOCK.md:82` (INV-STATE-5:
  `resetEditor()` returns the store to the exact `initialEditorData` shape) reinforced by
  `story-editor-v2-baseline.md:91`: *"The store stays the **single source of truth** — canvas-kit is
  a renderer, never a second store."* This is the load-bearing rule for §2: whichever renderer wins,
  it must not hold state.
- **One panel at a time** — `REGRESSION_LOCK.md:79`, INV-STATE-2. Orthogonal to how panels animate.
- **Synchronous reset** — `REGRESSION_LOCK.md:56` and RISK-1 at `:124-128`. Currently violated
  (see D11); keep the rule and fix the code.

Two structural caveats on the lock itself. It cites a test suite that does not exist
(`REGRESSION_LOCK.md:152` → `tests/stories/`), and RISK-1/RISK-2 (`:124-134`) describe code that has
since changed — RISK-1 points at `app/(protected)/story/editor.tsx:18-19` and a
`Debouncer({ wait: 200 })` that no longer exists (`apps/mobile/app/(protected)/story/editor.tsx` is
a 2-line re-export; the real file is
`packages/app/features/routes/screens/(protected)/story/editor.tsx` and uses raw `setTimeout`).
The lock is stale in its citations while still authoritative in its invariants.

---

## 7 · Additional findings not in the claim list

Recorded because they sit on the same code paths and would be found again during any rebuild.

1. **Conditional hook call.** `EditorCanvas.tsx:173-177` calls `useVideo` inside a ternary:

   ```ts
       const video =
         mediaType === "video" && mediaUri
           ? useVideo(mediaUri, { paused: !isPlaying })
           : null;
   ```

   `mediaType` is store-backed and mutable via `setMedia` (`editor-store.ts`), and
   `handlePickMedia` can swap media inside a live editor session (`EditorScreen.tsx:1060`). If the
   type ever changes without a remount, the hook order changes and React throws. Not observed
   failing; the ordering is currently protected only by the route always remounting.

2. **Duplicated package path.** `packages/app/packages/app/components/membership/TierBadge.tsx`
   exists alongside `packages/app/components/membership/TierBadge.tsx`. Unrelated to stories, but it
   is a real nested-workspace artifact that will confuse any repo-wide grep.

3. **Dev seeding in the production route.** `story/editor.tsx:12-30` (`seedDevTextEditor`) and
   `:88-98` fire on `demoTextSeed=1`. Guarded by `if (!__DEV__) return`, but the params are read
   unconditionally and the 320ms timer is scheduled before the guard runs (`:93-97`).

4. **One edge-function call per story item.** `api/stories.ts:348-386` loops and invokes
   `create-story` once per media item, keeping only `lastStory` (`:385`). A four-item story is four
   independent, non-transactional round trips; a failure on item 3 leaves items 1–2 published with
   no rollback. Combined with the missing idempotency key (§3), a retry after a partial failure
   duplicates the items that already succeeded.
