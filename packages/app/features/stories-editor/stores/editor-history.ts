// ============================================================
// Stories Editor - Transactional undo history (pure logic)
// ============================================================
// One history entry per finished interaction, never per frame: a drag, a
// pinch/rotate burst and a whole text-edit session each collapse to a single
// undo step holding the state captured before the interaction started.
// ============================================================

export interface HistorySnapshot<E, P> {
  elements: E[];
  drawingPaths: P[];
}

export interface HistoryState<E, P> {
  elements: E[];
  drawingPaths: P[];
  undoStack: HistorySnapshot<E, P>[];
  redoStack: HistorySnapshot<E, P>[];
  interactionSnapshot: HistorySnapshot<E, P> | null;
  lastCommit: { elementId: string; at: number } | null;
}

export type HistoryPatch<E, P> = Partial<HistoryState<E, P>>;

// Pan, pinch and rotate run simultaneously and each fires its own end commit
// when the fingers lift, so commits for one element inside this window are
// treated as the tail of a single gesture rather than separate edits.
export const COMMIT_COALESCE_MS = 300;

function snapshot<E, P>(state: HistoryState<E, P>): HistorySnapshot<E, P> {
  return { elements: state.elements, drawingPaths: state.drawingPaths };
}

/** Records the current state as one undo step. For discrete edits (add/remove). */
export function recordStep<E, P>(state: HistoryState<E, P>): HistoryPatch<E, P> {
  return {
    undoStack: [...state.undoStack, snapshot(state)],
    redoStack: [],
    lastCommit: null,
  };
}

/** Opens an interaction: everything until `endInteraction` collapses to one step. */
export function beginInteraction<E, P>(
  state: HistoryState<E, P>,
): HistoryPatch<E, P> {
  if (state.interactionSnapshot) return {};
  return { interactionSnapshot: snapshot(state), lastCommit: null };
}

/** Closes an interaction, recording one step only if it actually changed something. */
export function endInteraction<E, P>(
  state: HistoryState<E, P>,
): HistoryPatch<E, P> {
  const open = state.interactionSnapshot;
  if (!open) return {};
  const unchanged =
    open.elements === state.elements &&
    open.drawingPaths === state.drawingPaths;
  // An add during the session already recorded this exact pre-state, so
  // recording it again would cost the user two undos for one interaction.
  const top = state.undoStack[state.undoStack.length - 1];
  const alreadyRecorded =
    !!top &&
    top.elements === open.elements &&
    top.drawingPaths === open.drawingPaths;
  if (unchanged || alreadyRecorded) return { interactionSnapshot: null };
  return {
    undoStack: [...state.undoStack, open],
    redoStack: [],
    interactionSnapshot: null,
    lastCommit: null,
  };
}

/** End-of-gesture commit for one element: records the pre-gesture state once. */
export function commitStep<E, P>(
  state: HistoryState<E, P>,
  elementId: string,
  now: number,
  coalesceMs: number = COMMIT_COALESCE_MS,
): HistoryPatch<E, P> {
  if (state.interactionSnapshot) return {};
  const last = state.lastCommit;
  if (
    last &&
    last.elementId === elementId &&
    now - last.at >= 0 &&
    now - last.at <= coalesceMs
  ) {
    return {};
  }
  return {
    undoStack: [...state.undoStack, snapshot(state)],
    redoStack: [],
    lastCommit: { elementId, at: now },
  };
}

export function applyUndo<E, P>(state: HistoryState<E, P>): HistoryPatch<E, P> {
  const prev = state.undoStack[state.undoStack.length - 1];
  if (!prev) return {};
  return {
    elements: prev.elements,
    drawingPaths: prev.drawingPaths,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, snapshot(state)],
    interactionSnapshot: null,
    lastCommit: null,
  };
}

export function applyRedo<E, P>(state: HistoryState<E, P>): HistoryPatch<E, P> {
  const next = state.redoStack[state.redoStack.length - 1];
  if (!next) return {};
  return {
    elements: next.elements,
    drawingPaths: next.drawingPaths,
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, snapshot(state)],
    interactionSnapshot: null,
    lastCommit: null,
  };
}
