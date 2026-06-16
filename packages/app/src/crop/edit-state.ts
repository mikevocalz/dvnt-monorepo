/**
 * Non-destructive Edit State — stores params, not bitmaps.
 *
 * All pixel operations happen ONLY on export ("Done").
 * Preview uses these params as visual transforms (Reanimated).
 *
 * Undo/redo via snapshot history.
 */

// ── Types ────────────────────────────────────────────────────────────

export type AspectPreset =
  | "original"
  | "1:1"
  | "4:5"
  | "16:9"
  | "9:16"
  | "free";

export type Rotate90 = 0 | 90 | 180 | 270;

export type OutputFormat = "jpeg" | "png" | "webp";

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export interface OutputSettings {
  maxEdge?: number;
  quality: number; // 0..1
  format: OutputFormat;
}

export interface EditStateSnapshot {
  view: ViewTransform;
  aspect: AspectPreset;
  rotate90: Rotate90;
  straighten: number; // -45..45
  flipX: boolean;
  output: OutputSettings;
}

export interface EditState extends EditStateSnapshot {
  sourceUri: string;
  sourceSize: { w: number; h: number };
  history: {
    undo: EditStateSnapshot[];
    redo: EditStateSnapshot[];
  };
}

// ── Aspect ratio numeric values ──────────────────────────────────────

/** Returns height/width ratio for a given preset, or null for 'free'/'original' */
export function getAspectRatioValue(
  preset: AspectPreset,
  originalW: number,
  originalH: number,
): number | null {
  switch (preset) {
    case "original":
      return originalH / originalW;
    case "1:1":
      return 1;
    case "4:5":
      return 5 / 4;
    case "16:9":
      return 9 / 16;
    case "9:16":
      return 16 / 9;
    case "free":
      return null;
    default:
      return null;
  }
}

// ── Defaults ─────────────────────────────────────────────────────────

export function createInitialEditState(
  sourceUri: string,
  sourceW: number,
  sourceH: number,
): EditState {
  return {
    sourceUri,
    sourceSize: { w: sourceW, h: sourceH },
    view: { scale: 1, tx: 0, ty: 0 },
    aspect: "original",
    rotate90: 0,
    straighten: 0,
    flipX: false,
    output: { quality: 0.9, format: "jpeg" },
    history: { undo: [], redo: [] },
  };
}

// ── Snapshot helpers ─────────────────────────────────────────────────

function takeSnapshot(state: EditState): EditStateSnapshot {
  return {
    view: { ...state.view },
    aspect: state.aspect,
    rotate90: state.rotate90,
    straighten: state.straighten,
    flipX: state.flipX,
    output: { ...state.output },
  };
}

function applySnapshot(state: EditState, snap: EditStateSnapshot): EditState {
  return {
    ...state,
    view: { ...snap.view },
    aspect: snap.aspect,
    rotate90: snap.rotate90,
    straighten: snap.straighten,
    flipX: snap.flipX,
    output: { ...snap.output },
  };
}

// ── Reducer actions ──────────────────────────────────────────────────

export type EditAction =
  | { type: "SET_VIEW"; view: ViewTransform }
  | { type: "SET_ASPECT"; aspect: AspectPreset }
  | { type: "ROTATE_CW" }
  | { type: "SET_STRAIGHTEN"; degrees: number }
  | { type: "FLIP_X" }
  | { type: "SET_OUTPUT"; output: Partial<OutputSettings> }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET" };

const MAX_HISTORY = 50;

function pushUndo(state: EditState): EditState {
  const snap = takeSnapshot(state);
  const undo = [...state.history.undo, snap].slice(-MAX_HISTORY);
  return {
    ...state,
    history: { undo, redo: [] }, // redo cleared on new action
  };
}

export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case "SET_VIEW":
      // View changes are frequent (gestures) — NO undo push to avoid flooding
      return { ...state, view: action.view };

    case "SET_ASPECT": {
      const s = pushUndo(state);
      return { ...s, aspect: action.aspect };
    }

    case "ROTATE_CW": {
      const s = pushUndo(state);
      const next = ((s.rotate90 + 90) % 360) as Rotate90;
      // Reset view on rotate to avoid disorienting pan state
      return { ...s, rotate90: next, view: { scale: 1, tx: 0, ty: 0 } };
    }

    case "SET_STRAIGHTEN": {
      const s = pushUndo(state);
      const clamped = Math.max(-45, Math.min(45, action.degrees));
      return { ...s, straighten: clamped };
    }

    case "FLIP_X": {
      const s = pushUndo(state);
      return { ...s, flipX: !s.flipX };
    }

    case "SET_OUTPUT": {
      const s = pushUndo(state);
      return { ...s, output: { ...s.output, ...action.output } };
    }

    case "UNDO": {
      if (state.history.undo.length === 0) return state;
      const currentSnap = takeSnapshot(state);
      const undo = [...state.history.undo];
      const prev = undo.pop()!;
      const redo = [...state.history.redo, currentSnap];
      const restored = applySnapshot(state, prev);
      return { ...restored, history: { undo, redo } };
    }

    case "REDO": {
      if (state.history.redo.length === 0) return state;
      const currentSnap = takeSnapshot(state);
      const redo = [...state.history.redo];
      const next = redo.pop()!;
      const undo = [...state.history.undo, currentSnap];
      const restored = applySnapshot(state, next);
      return { ...restored, history: { undo, redo } };
    }

    case "RESET": {
      const s = pushUndo(state);
      return {
        ...s,
        view: { scale: 1, tx: 0, ty: 0 },
        aspect: "original",
        rotate90: 0,
        straighten: 0,
        flipX: false,
        output: { quality: 0.9, format: "jpeg" },
      };
    }

    default:
      return state;
  }
}
