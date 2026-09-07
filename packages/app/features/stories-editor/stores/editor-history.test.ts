/** node --test packages/app/features/stories-editor/stores/editor-history.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMMIT_COALESCE_MS,
  applyRedo,
  applyUndo,
  beginInteraction,
  commitStep,
  endInteraction,
  recordStep,
  type HistoryState,
} from "./editor-history.ts";

type El = { id: string; x: number };
type Path = string;
type S = HistoryState<El, Path>;

function state(over: Partial<S> = {}): S {
  return {
    elements: [],
    drawingPaths: [],
    undoStack: [],
    redoStack: [],
    interactionSnapshot: null,
    lastCommit: null,
    ...over,
  };
}

/** The store's `set((s) => ({ ...patch, ...writes }))` shape, as one function. */
function apply(s: S, patch: Partial<S>): S {
  return { ...s, ...patch };
}

const A0: El[] = [{ id: "a", x: 0 }];
const A1: El[] = [{ id: "a", x: 1 }];
const A2: El[] = [{ id: "a", x: 2 }];

test("a drag records exactly one step and undo restores the pre-drag position", () => {
  let s = state({ elements: A0 });
  s = apply(s, { ...commitStep(s, "a", 1000), elements: A1 });

  assert.equal(s.undoStack.length, 1);
  s = apply(s, applyUndo(s));
  assert.deepEqual(s.elements, A0);
});

test("a second gesture on the same element inside the window coalesces", () => {
  let s = state({ elements: A0 });
  s = apply(s, { ...commitStep(s, "a", 1000), elements: A1 });
  // pan-end then pinch-end from the same two-finger move
  s = apply(s, { ...commitStep(s, "a", 1000 + COMMIT_COALESCE_MS), elements: A2 });

  assert.equal(s.undoStack.length, 1, "one gesture, one step");
  s = apply(s, applyUndo(s));
  assert.deepEqual(s.elements, A0);
});

test("past the window, or on another element, is a separate step", () => {
  let s = state({ elements: A0 });
  s = apply(s, { ...commitStep(s, "a", 1000), elements: A1 });
  s = apply(s, {
    ...commitStep(s, "a", 1001 + COMMIT_COALESCE_MS),
    elements: A2,
  });
  assert.equal(s.undoStack.length, 2);

  let t = state({ elements: A0 });
  t = apply(t, { ...commitStep(t, "a", 1000), elements: A1 });
  t = apply(t, { ...commitStep(t, "b", 1000), elements: A2 });
  assert.equal(t.undoStack.length, 2);
});

test("a whole typing session collapses to one step", () => {
  let s = state({ elements: A0 });
  s = apply(s, beginInteraction(s)); // setMode("text")
  // per-keystroke updateElement writes with no history patch at all
  s = apply(s, { elements: A1 });
  s = apply(s, { elements: A2 });
  // the Done-path commitElement must not record while the editor is open
  s = apply(s, { ...commitStep(s, "a", 2000), elements: A2 });
  assert.equal(s.undoStack.length, 0, "no step until the editor closes");

  s = apply(s, endInteraction(s)); // setMode(anything else)
  assert.equal(s.undoStack.length, 1);

  s = apply(s, applyUndo(s));
  assert.deepEqual(s.elements, A0, "undo steps over the whole session");
});

test("opening and closing the text editor without typing records nothing", () => {
  let s = state({ elements: A0 });
  s = apply(s, beginInteraction(s));
  s = apply(s, endInteraction(s));
  assert.equal(s.undoStack.length, 0);
  assert.equal(s.interactionSnapshot, null);
});

test("re-entering text mode does not clobber an open snapshot", () => {
  let s = state({ elements: A0 });
  s = apply(s, beginInteraction(s));
  s = apply(s, { elements: A1 });
  s = apply(s, beginInteraction(s)); // a second setMode("text")
  s = apply(s, endInteraction(s));

  s = apply(s, applyUndo(s));
  assert.deepEqual(s.elements, A0);
});

test("undo then redo round-trips, and a new edit drops the redo stack", () => {
  let s = state({ elements: A0 });
  s = apply(s, { ...recordStep(s), elements: A1 }); // addElement
  s = apply(s, applyUndo(s));
  assert.deepEqual(s.elements, A0);
  s = apply(s, applyRedo(s));
  assert.deepEqual(s.elements, A1);

  s = apply(s, applyUndo(s));
  assert.equal(s.redoStack.length, 1);
  s = apply(s, { ...commitStep(s, "a", 5000), elements: A2 });
  assert.equal(s.redoStack.length, 0, "branching drops the redo future");
});

test("undo on an empty stack is a no-op", () => {
  const s = state({ elements: A0 });
  assert.deepEqual(applyUndo(s), {});
  assert.deepEqual(applyRedo(s), {});
});
