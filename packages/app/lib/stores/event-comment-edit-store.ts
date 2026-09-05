import { create } from "zustand";

/**
 * Inline edit/delete state for ONE event comment at a time.
 *
 * Per project rule, input state lives in Zustand, not React useState — the same
 * reason `comment-draft-store` exists next to it. Singular by design: two
 * comments cannot be open for editing at once, and a single row keyed by id is
 * cheaper and less error-prone than a map that has to be pruned as the
 * virtualized list recycles rows.
 *
 * `confirmingDeleteId` is separate from `editingId` because deleting is not a
 * mode you type in — it is a two-tap confirmation, since a deleted comment is
 * not recoverable.
 */
interface EventCommentEditState {
  editingId: string | null;
  draft: string;
  confirmingDeleteId: string | null;
  startEdit: (commentId: string, current: string) => void;
  setDraft: (draft: string) => void;
  cancelEdit: () => void;
  askDelete: (commentId: string) => void;
  cancelDelete: () => void;
  reset: () => void;
}

const initial = {
  editingId: null as string | null,
  draft: "",
  confirmingDeleteId: null as string | null,
};

export const useEventCommentEditStore = create<EventCommentEditState>((set) => ({
  ...initial,
  // Opening an editor closes any pending delete confirmation: they are two
  // answers to the same question and showing both is how you tap the wrong one.
  startEdit: (editingId, current) =>
    set({ editingId, draft: current, confirmingDeleteId: null }),
  setDraft: (draft) => set({ draft }),
  cancelEdit: () => set({ editingId: null, draft: "" }),
  askDelete: (confirmingDeleteId) =>
    set({ confirmingDeleteId, editingId: null, draft: "" }),
  cancelDelete: () => set({ confirmingDeleteId: null }),
  reset: () => set({ ...initial }),
}));
