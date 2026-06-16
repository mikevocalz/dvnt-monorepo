import { create } from "zustand";
import type { StoryOverlay } from "@dvnt/app/lib/types";
import type { TextPostThemeKey } from "@dvnt/app/lib/types";

/**
 * Web-only transient state for the story composer.
 *
 * The portable `useCreateStoryStore` owns the actual media assets, visibility,
 * tags and `isSharing` flag (and persists `storyOverlays` onto each asset on
 * publish). This store only holds the *web editing* scaffolding the native
 * Skia editor would otherwise own: the active text-overlay draft, the dragging
 * pointer state, and the text-story theme selection.
 */

export interface DraftTextOverlay {
  id: string;
  content: string;
  /** normalized 0..1 center position on the 9:16 stage */
  x: number;
  y: number;
  color: string;
  /** theme key when this overlay is a standalone text story background */
  theme: TextPostThemeKey;
}

interface StoryCreateWebState {
  overlays: DraftTextOverlay[];
  editingId: string | null;
  draggingId: string | null;
  textTheme: TextPostThemeKey;

  addTextOverlay: () => void;
  updateOverlayContent: (id: string, content: string) => void;
  updateOverlayPosition: (id: string, x: number, y: number) => void;
  updateOverlayColor: (id: string, color: string) => void;
  removeOverlay: (id: string) => void;
  setEditingId: (id: string | null) => void;
  setDraggingId: (id: string | null) => void;
  setTextTheme: (theme: TextPostThemeKey) => void;
  /** serialize the web overlays into the portable StoryOverlay shape */
  toStoryOverlays: () => StoryOverlay[];
  reset: () => void;
}

const TEXT_COLORS = ["#FFFFFF", "#3FDCFF", "#FF5BFC", "#FDBA74", "#86EFAC"];

const initialState = {
  overlays: [] as DraftTextOverlay[],
  editingId: null as string | null,
  draggingId: null as string | null,
  textTheme: "graphite" as TextPostThemeKey,
};

export const useStoryCreateWebStore = create<StoryCreateWebState>(
  (set, get) => ({
    ...initialState,

    addTextOverlay: () => {
      const id = `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      set((s) => ({
        overlays: [
          ...s.overlays,
          {
            id,
            content: "Tap to edit",
            x: 0.5,
            y: 0.5,
            color: TEXT_COLORS[0],
            theme: s.textTheme,
          },
        ],
        editingId: id,
      }));
    },

    updateOverlayContent: (id, content) =>
      set((s) => ({
        overlays: s.overlays.map((o) =>
          o.id === id ? { ...o, content } : o,
        ),
      })),

    updateOverlayPosition: (id, x, y) =>
      set((s) => ({
        overlays: s.overlays.map((o) =>
          o.id === id
            ? { ...o, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
            : o,
        ),
      })),

    updateOverlayColor: (id, color) =>
      set((s) => ({
        overlays: s.overlays.map((o) =>
          o.id === id ? { ...o, color } : o,
        ),
      })),

    removeOverlay: (id) =>
      set((s) => ({
        overlays: s.overlays.filter((o) => o.id !== id),
        editingId: s.editingId === id ? null : s.editingId,
      })),

    setEditingId: (id) => set({ editingId: id }),
    setDraggingId: (id) => set({ draggingId: id }),
    setTextTheme: (theme) => set({ textTheme: theme }),

    toStoryOverlays: () =>
      get().overlays.map((o) => ({
        id: o.id,
        type: "text" as const,
        content: o.content,
        x: o.x,
        y: o.y,
        scale: 1,
        rotation: 0,
        color: o.color,
        fontSizeRatio: 0.07,
        maxWidthRatio: 0.9,
        textAlign: "center" as const,
      })),

    reset: () => set(initialState),
  }),
);

export const STORY_TEXT_COLORS = TEXT_COLORS;
