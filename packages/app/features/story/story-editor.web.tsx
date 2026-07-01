"use client";

/**
 * Story overlay editor — WEB variant.
 *
 * Native source of truth: app/(protected)/story/editor.tsx + src/stories-editor
 * (Skia canvas + gesture-handler + reanimated). Those native-graphics libs can't
 * run on web, so this is a SEPARATE CSS implementation that drives the SAME
 * Zustand stores the native editor uses:
 *   - useEditorStore  (src/stories-editor/stores/editor-store) — media + elements
 *   - useStoryFlowStore — the story-creation state machine
 *   - useStoryEditorResultStore — the hand-off back to story/create
 *
 * The Skia canvas (1080×1920 canvas-space coordinates) becomes a portrait 9:16
 * CSS stage. Text overlays are absolutely-positioned, pointer-draggable <div>s;
 * their position is stored back into the editor store's TextElement.transform in
 * canvas coordinates (so the data model stays identical to native). "Done"
 * converts the elements to StoryOverlay[] and writes the result store, then
 * navigates back to story/create exactly as native does.
 *
 * HARD CONVENTIONS: NativeWind interop OFF — raw semantic HTML + Tailwind only,
 * no <View>/<Text>, no Skia / gesture-handler / reanimated. State = Zustand.
 */

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "solito/navigation";
import { X, Type, Check, Trash2 } from "lucide-react";
import {
  useEditorStore,
  useSelectedElement,
} from "@dvnt/app/src/stories-editor/stores/editor-store";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "@dvnt/app/src/stories-editor/constants";
import type {
  TextElement,
  StickerElement,
} from "@dvnt/app/src/stories-editor/types";
import { useStoryFlowStore } from "@dvnt/app/lib/stores/story-flow-store";
import { useStoryEditorResultStore } from "@dvnt/app/lib/stores/story-editor-result-store";
import type {
  StoryOverlay,
  StoryAnimatedGifOverlay,
} from "@dvnt/app/lib/types";

const ACCENT = "#3FDCFF";

// Text color palette — mirrors the native color tab options. No pill shapes;
// rounded-square swatches only.
const TEXT_COLORS = [
  "#FFFFFF",
  "#000000",
  ACCENT,
  "#FF5BFC",
  "#FFD43B",
  "#22C55E",
  "#FF6B6B",
  "#8A40CF",
];

// Convert a TextElement (canvas coords, 1080×1920) to a `text` StoryOverlay,
// matching the native export shape (ratios are 0..1 of the canvas).
function textElementToOverlay(el: TextElement): StoryOverlay {
  return {
    id: el.id,
    type: "text",
    content: el.content,
    x: el.transform.translateX / CANVAS_WIDTH,
    y: el.transform.translateY / CANVAS_HEIGHT,
    scale: el.transform.scale,
    rotation: el.transform.rotation,
    opacity: el.opacity,
    color: el.color,
    backgroundColor: el.backgroundColor,
    fontFamily: el.fontFamily,
    fontSizeRatio: el.fontSize / CANVAS_WIDTH,
    maxWidthRatio: el.maxWidth / CANVAS_WIDTH,
    textAlign: el.textAlign,
  };
}

function stickerElementToOverlay(el: StickerElement): StoryOverlay {
  return {
    id: el.id,
    type: "sticker",
    x: el.transform.translateX / CANVAS_WIDTH,
    y: el.transform.translateY / CANVAS_HEIGHT,
    sizeRatio: el.size / CANVAS_WIDTH,
    scale: el.transform.scale,
    rotation: el.transform.rotation,
    opacity: el.opacity,
    source: el.assetId ? "asset" : "url",
    assetId: el.assetId,
    url: typeof el.source === "string" ? el.source : undefined,
  };
}

export function StoryEditorScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const uriParam = searchParams?.get("uri") ?? "";
  const typeParam = searchParams?.get("type") ?? "image";
  const initialMode = searchParams?.get("initialMode") ?? undefined;
  const indexParam = searchParams?.get("index") ?? "0";

  const mediaUri = uriParam ? decodeURIComponent(uriParam) : "";
  const mediaType: "image" | "video" =
    typeParam === "video" ? "video" : "image";

  // Editor store (the EXACT zustand store native uses).
  const elements = useEditorStore((s) => s.elements);
  const mode = useEditorStore((s) => s.mode);
  const storeMediaUri = useEditorStore((s) => s.mediaUri);
  const selected = useSelectedElement();

  const stageRef = useRef<HTMLDivElement>(null);

  // [REGRESSION LOCK parity] Reset editor on mount, then seed media — clean
  // slate every session, same guarantee the native useLayoutEffect provides.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    const editor = useEditorStore.getState();
    editor.resetEditor();
    if (mediaUri) editor.setMedia(mediaUri, mediaType);
    if (initialMode === "text") editor.setTextOnlyMode(true);
  }, [mediaUri, mediaType, initialMode]);

  // Drive the story-flow state machine to the right editing state, mirroring
  // native (HUB → EDIT_IMAGE / EDIT_VIDEO / TEXT_ONLY).
  useEffect(() => {
    const targetState =
      initialMode === "text"
        ? "TEXT_ONLY"
        : mediaType === "video"
          ? "EDIT_VIDEO"
          : "EDIT_IMAGE";
    const flow = useStoryFlowStore.getState();
    if (flow.state === targetState) return;
    if (flow.state !== "HUB") {
      flow.forceIdle();
      useStoryFlowStore.getState().transitionTo("HUB");
    }
    useStoryFlowStore.getState().transitionTo(targetState);
  }, [initialMode, mediaType]);

  const handleClose = () => {
    useStoryFlowStore.getState().transitionTo("HUB");
    router.back();
    setTimeout(() => useEditorStore.getState().resetEditor(), 350);
  };

  const handleDone = () => {
    const editor = useEditorStore.getState();
    const storyOverlays: StoryOverlay[] = editor.elements
      .map((el) =>
        el.type === "text"
          ? textElementToOverlay(el)
          : el.type === "sticker"
            ? stickerElementToOverlay(el)
            : null,
      )
      .filter((o): o is StoryOverlay => o !== null);

    const animatedGifOverlays: StoryAnimatedGifOverlay[] = [];

    useStoryEditorResultStore.getState().setResult({
      uri: editor.mediaUri ?? mediaUri,
      index: Number.parseInt(indexParam, 10) || 0,
      mediaType,
      storyOverlays,
      animatedGifOverlays,
    });
    useStoryFlowStore.getState().transitionTo("HUB");
    router.push("/feed/story/create");
    setTimeout(() => useEditorStore.getState().resetEditor(), 300);
  };

  const addText = () => {
    const editor = useEditorStore.getState();
    const id = editor.addTextElement({ content: "Tap to edit" });
    editor.selectElement(id);
    editor.setMode("text");
  };

  const resolvedMedia = storeMediaUri || mediaUri;

  return (
    <div className="min-h-[100dvh] w-full bg-black text-white flex flex-col">
      {/* Sticky header — close / title / done */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={handleClose}
          aria-label="Close editor"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
        <h1 className="text-[17px] font-semibold">Edit story</h1>
        <button
          onClick={handleDone}
          aria-label="Done"
          className="h-9 px-4 rounded-xl flex items-center gap-1.5 font-semibold text-black active:scale-95"
          style={{ background: ACCENT }}
        >
          <Check size={16} color="#06070d" strokeWidth={3} />
          Done
        </button>
      </header>

      {/* Stage + tools */}
      <main className="flex-1 flex flex-col items-center justify-center gap-5 px-4 py-6">
        <EditorStage
          stageRef={stageRef}
          mediaUri={resolvedMedia}
          mediaType={mediaType}
          textOnly={initialMode === "text"}
        />

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <button
            onClick={addText}
            aria-label="Add text"
            className="h-11 px-4 rounded-xl flex items-center gap-2 bg-white/8 border border-white/12 active:scale-95"
          >
            <Type size={18} color="#fff" />
            <span className="text-sm font-medium">Add text</span>
          </button>
          {selected ? (
            <button
              onClick={() => useEditorStore.getState().removeElement(selected.id)}
              aria-label="Delete selected"
              className="h-11 w-11 rounded-xl flex items-center justify-center bg-white/8 border border-white/12 active:scale-95"
            >
              <Trash2 size={18} color="#FF6B6B" />
            </button>
          ) : null}
        </div>

        {/* Text editing panel — content + color, wired straight to the element */}
        {selected && selected.type === "text" ? (
          <TextEditPanel element={selected} />
        ) : null}

        <p className="text-white/40 text-xs text-center max-w-xs">
          {elements.length === 0
            ? "Add text overlays, then tap Done to continue."
            : `${elements.length} overlay${elements.length === 1 ? "" : "s"} · drag to reposition`}
          {mode === "text" ? " · editing text" : ""}
        </p>
      </main>
    </div>
  );
}

export default StoryEditorScreen;

// ---- Stage (the 9:16 canvas) ----

function EditorStage({
  stageRef,
  mediaUri,
  mediaType,
  textOnly,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  mediaUri: string;
  mediaType: "image" | "video";
  textOnly: boolean;
}) {
  const elements = useEditorStore((s) => s.elements);
  const selectedId = useEditorStore((s) => s.selectedElementId);

  return (
    <div
      ref={stageRef}
      className="relative overflow-hidden rounded-2xl bg-[#06070d] border border-white/10 select-none"
      style={{
        aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
        width: "min(86vw, 420px)",
        maxHeight: "70dvh",
        touchAction: "none",
        containerType: "inline-size",
      }}
      onPointerDown={(e) => {
        // Tapping the bare stage deselects.
        if (e.target === e.currentTarget) {
          useEditorStore.getState().selectElement(null);
        }
      }}
    >
      {/* Base media */}
      {!textOnly && mediaUri ? (
        mediaType === "video" ? (
          <video
            src={mediaUri}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUri}
            alt="Story media"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        )
      ) : (
        // Text-only background — gradient stage like the native background picker.
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(150deg, #1A0A2E, #8A40CF, #34A2DF)",
          }}
        />
      )}

      {/* Overlays */}
      {elements
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((el) => {
          if (el.type === "text") {
            return (
              <TextOverlay
                key={el.id}
                element={el}
                stageRef={stageRef}
                selected={el.id === selectedId}
              />
            );
          }
          if (el.type === "sticker") {
            return (
              <StickerOverlay
                key={el.id}
                element={el}
                stageRef={stageRef}
                selected={el.id === selectedId}
              />
            );
          }
          return null;
        })}
    </div>
  );
}

// ---- Draggable text overlay (CSS-positioned, pointer drag → store) ----

function TextOverlay({
  element,
  stageRef,
  selected,
}: {
  element: TextElement;
  stageRef: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
}) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    useEditorStore.getState().selectElement(element.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: element.transform.translateX,
      originY: element.transform.translateY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    // Map pixel delta → canvas-space delta (1080×1920).
    const dx = ((e.clientX - drag.startX) / rect.width) * CANVAS_WIDTH;
    const dy = ((e.clientY - drag.startY) / rect.height) * CANVAS_HEIGHT;
    const nextX = Math.max(0, Math.min(CANVAS_WIDTH, drag.originX + dx));
    const nextY = Math.max(0, Math.min(CANVAS_HEIGHT, drag.originY + dy));
    useEditorStore.getState().updateElement(element.id, {
      transform: { ...element.transform, translateX: nextX, translateY: nextY },
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  // Canvas coords → percentage of stage. fontSize is in canvas units; convert
  // to a viewport-relative size (cqw of the stage width keeps it proportional).
  const leftPct = (element.transform.translateX / CANVAS_WIDTH) * 100;
  const topPct = (element.transform.translateY / CANVAS_HEIGHT) * 100;
  const fontSizeRatio = element.fontSize / CANVAS_WIDTH; // 0..~0.13

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute cursor-grab active:cursor-grabbing"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: `translate(-50%, -50%) scale(${element.transform.scale}) rotate(${element.transform.rotation}deg)`,
        maxWidth: `${(element.maxWidth / CANVAS_WIDTH) * 100}%`,
        outline: selected ? `1.5px solid ${ACCENT}` : "none",
        outlineOffset: 4,
        borderRadius: 8,
        padding: "2px 6px",
        backgroundColor: element.backgroundColor ?? "transparent",
      }}
    >
      <span
        dir="ltr"
        className="whitespace-pre-wrap break-words font-bold leading-tight"
        style={{
          color: element.color,
          fontSize: `${fontSizeRatio * 100}cqw`,
          textAlign: element.textAlign,
          display: "block",
          letterSpacing: element.letterSpacing ?? 0,
          // Force logical-left → logical-right; some browser/OS locale
          // combinations were rendering the overlay backwards when
          // inheriting a right-to-left context from an ancestor.
          direction: "ltr",
          unicodeBidi: "plaintext",
        }}
      >
        {element.content || " "}
      </span>
    </div>
  );
}

// ---- Sticker / emoji overlay (drag only; no resize on web) ----

function StickerOverlay({
  element,
  stageRef,
  selected,
}: {
  element: StickerElement;
  stageRef: React.RefObject<HTMLDivElement | null>;
  selected: boolean;
}) {
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    useEditorStore.getState().selectElement(element.id);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: element.transform.translateX,
      originY: element.transform.translateY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = ((e.clientX - drag.startX) / rect.width) * CANVAS_WIDTH;
    const dy = ((e.clientY - drag.startY) / rect.height) * CANVAS_HEIGHT;
    const nextX = Math.max(0, Math.min(CANVAS_WIDTH, drag.originX + dx));
    const nextY = Math.max(0, Math.min(CANVAS_HEIGHT, drag.originY + dy));
    useEditorStore.getState().updateElement(element.id, {
      transform: { ...element.transform, translateX: nextX, translateY: nextY },
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const leftPct = (element.transform.translateX / CANVAS_WIDTH) * 100;
  const topPct = (element.transform.translateY / CANVAS_HEIGHT) * 100;
  const sizeRatio = element.size / CANVAS_WIDTH;
  const isEmoji = typeof element.source === "string" && element.category === "emoji";
  const url = typeof element.source === "string" ? element.source : "";

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute cursor-grab active:cursor-grabbing"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${sizeRatio * 100}%`,
        transform: `translate(-50%, -50%) scale(${element.transform.scale}) rotate(${element.transform.rotation}deg)`,
        outline: selected ? `1.5px solid ${ACCENT}` : "none",
        outlineOffset: 4,
        borderRadius: 8,
        opacity: element.opacity,
      }}
    >
      {isEmoji ? (
        <span
          className="block text-center"
          style={{ fontSize: `${sizeRatio * 100}cqw` }}
        >
          {element.source as string}
        </span>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="sticker"
          className="w-full h-auto"
          draggable={false}
        />
      ) : null}
    </div>
  );
}

// ---- Text editing panel (content + color) ----

function TextEditPanel({ element }: { element: TextElement }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
      <textarea
        dir="ltr"
        value={element.content}
        onChange={(e) =>
          useEditorStore.getState().updateElement(element.id, {
            content: e.target.value,
          })
        }
        rows={2}
        placeholder="Type something…"
        style={{ direction: "ltr", unicodeBidi: "plaintext" }}
        className="w-full resize-none rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-[#3FDCFF]"
      />

      {/* Color swatches — rounded squares, never circles. */}
      <div className="flex items-center gap-2 flex-wrap">
        {TEXT_COLORS.map((color) => {
          const active = element.color.toUpperCase() === color.toUpperCase();
          return (
            <button
              key={color}
              onClick={() =>
                useEditorStore.getState().updateElement(element.id, { color })
              }
              aria-label={`Text color ${color}`}
              className="w-8 h-8 rounded-lg border active:scale-95"
              style={{
                backgroundColor: color,
                borderColor: active ? ACCENT : "rgba(255,255,255,0.2)",
                borderWidth: active ? 2 : 1,
              }}
            />
          );
        })}
      </div>

      {/* Alignment — mirrors native textAlign options. */}
      <div className="flex items-center gap-2">
        {(["left", "center", "right"] as const).map((align) => {
          const active = element.textAlign === align;
          return (
            <button
              key={align}
              onClick={() =>
                useEditorStore.getState().updateElement(element.id, {
                  textAlign: align,
                })
              }
              className="flex-1 h-9 rounded-xl text-xs font-medium capitalize border active:scale-95"
              style={{
                backgroundColor: active ? "rgba(63,220,255,0.15)" : "rgba(255,255,255,0.06)",
                borderColor: active ? ACCENT : "rgba(255,255,255,0.12)",
                color: active ? ACCENT : "#fff",
              }}
            >
              {align}
            </button>
          );
        })}
      </div>
    </div>
  );
}
